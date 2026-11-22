//! New-work admission is separate from execution so accepted jobs survive preference changes.
use crate::{
    catalog::{self, Selection},
    error::{message, Result},
    state::AppState,
    synthesis_policy::{self, Backend, Policy},
    types::{GenerateRequest, Settings},
    verification::ModelVerifier,
};
use serde_json::Value;
use std::path::Path;

mod analysis;
pub use analysis::analysis_settings;

pub fn generate(state: &AppState, request: GenerateRequest) -> Result<Vec<String>> {
    enqueue(state, request, false)
}

/// Phone clients submit against the active desktop profile, including after a form has been opened.
pub(crate) fn generate_for_current_profile(
    state: &AppState,
    request: GenerateRequest,
) -> Result<Vec<String>> {
    enqueue(state, request, true)
}

fn enqueue(
    state: &AppState,
    mut request: GenerateRequest,
    current_only: bool,
) -> Result<Vec<String>> {
    let hardware = crate::hardware::inspect();
    state.runtime.enqueue(|| {
        let settings = state.db.settings()?;
        let current = Selection::from_settings(&settings);
        let selection = request
            .model_selection
            .take()
            .unwrap_or_else(|| current.clone());
        if current_only && selection != current {
            return Err(message(
                "The active model changed. Reopen the generation form and try again",
            ));
        }
        catalog::catalog().ensure_allowed(&selection, settings.expert_mode, Some(hardware))?;
        catalog::ensure_runtime(&selection, &state.resources, &state.db.root)?;
        ensure_cached(state, &settings, &selection)?;
        let profile = catalog::generation_profile(&selection)?;
        request.model_selection = Some(selection);
        state.db.enqueue_with_profile(&request, Some(&profile))
    })
}

fn ensure_cached(state: &AppState, settings: &Settings, selection: &Selection) -> Result<()> {
    if !catalog::cached(
        selection,
        Path::new(&settings.models_dir),
        &ModelVerifier::open(&state.db.root),
    )? {
        return Err(message(
            "Open the ModelPicker and download or verify the selected models first",
        ));
    }
    Ok(())
}

pub(crate) fn profile_for_song(settings: &Settings, params: &Value) -> Result<Selection> {
    match params
        .get("model_selection")
        .filter(|value| !value.is_null())
    {
        Some(selection) => Ok(serde_json::from_value(selection.clone())?),
        None => Ok(catalog::legacy_selection(settings)),
    }
}

/// Verify the model and runtime pins while accepting compatible older capability snapshots.
pub(crate) fn validate_saved_profile(selection: &Selection, params: &Value) -> Result<()> {
    if selection.provider == "ace-step" {
        return Ok(());
    }
    let mut current = serde_json::to_value(catalog::generation_profile(selection)?)?;
    let saved = &params["generation_profile"];
    let saved_capabilities = &saved["capabilities"];
    if selection.provider == "yue2"
        && saved_capabilities.get("yue2_options").is_none()
        && saved_capabilities["max_variants"] == 1
    {
        if let Some(capabilities) = current["capabilities"].as_object_mut() {
            capabilities.remove("yue2_options");
        }
        current["capabilities"]["max_variants"] = 1.into();
    }
    if selection.provider == "yue2"
        && params["instrumental"] != true
        && saved_capabilities["instrumental"] == false
    {
        current["capabilities"]["instrumental"] = Value::Bool(false);
    }
    let legacy_max_duration: Option<u32> = match selection.provider.as_str() {
        "yue2" => Some(60),
        "heartmula" => Some(30),
        _ => None,
    };
    if let Some(limit) = legacy_max_duration.filter(|&limit| {
        saved_capabilities["max_duration"] == limit
            && params["duration"]
                .as_f64()
                .is_some_and(|duration| duration <= f64::from(limit))
    }) {
        current["capabilities"]["max_duration"] = limit.into();
    }
    if *saved != current {
        return Err(message("The recorded model or runtime version is unavailable. Create a new job to use the current version"));
    }
    Ok(())
}

pub fn retry(state: &AppState, id: &str) -> Result<()> {
    let hardware = crate::hardware::inspect();
    state.runtime.enqueue(|| {
        let settings = state.db.settings()?;
        let song = state.db.song(id)?;
        let selection = profile_for_song(&settings, &song.params)?;
        catalog::catalog().ensure_allowed(&selection, settings.expert_mode, Some(hardware))?;
        catalog::ensure_runtime(&selection, &state.resources, &state.db.root)?;
        validate_saved_profile(&selection, &song.params)?;
        if selection.provider != "ace-step" || !song.params["remix"].is_null() {
            let capabilities = catalog::capabilities(&selection)?;
            let mut request: GenerateRequest = serde_json::from_value(song.params)?;
            request.variants = 1;
            if !capabilities.prompt || capabilities.bars.is_some() {
                // These profiles store their composed library caption alongside the input.
                request.caption.clear();
            }
            crate::generation_limits::validate_request(&request, &capabilities)?;
            if let Some(reference) = &request.reference_audio {
                crate::reference_audio::resolve(&state.db.root, reference)?;
            }
            ensure_cached(state, &settings, &selection)?;
        }
        state.db.retry(id)
    })
}

pub(crate) fn generation_policy(
    state: &AppState,
    settings: &Settings,
    selection: &Selection,
    refresh: bool,
) -> Result<Policy> {
    let capabilities = catalog::capabilities(selection)?;
    let available = catalog::ensure_runtime(selection, &state.resources, &state.db.root).is_ok();
    let mut policy = if capabilities.advanced {
        state
            .synthesis_probe
            .session_policy(&state.ace_resources(), selection, refresh, || {
                state.backend_status()
            })
    } else {
        let metal_available = selection.provider == "yue2" && available;
        let backend = if metal_available {
            Backend::Gpu
        } else {
            Backend::Unknown
        };
        let mut policy = synthesis_policy::policy(backend, selection);
        if metal_available {
            policy.detected_backend = crate::engine::backend_status::Backend::Metal;
        }
        policy.legacy_inference_steps = 0;
        policy.recommended_steps = 0;
        policy.defaults.inference_steps = 0;
        policy.defaults.lm_temperature = 0.0;
        policy.defaults.duration = policy.defaults.duration.clamp(
            f64::from(capabilities.min_duration),
            f64::from(capabilities.max_duration),
        );
        policy.defaults.variants = 1;
        policy
    };
    policy.available = available;
    policy.analysis_available = (selection.provider == "yue2").then(|| {
        analysis::installed_ace_step(state, settings, crate::hardware::inspect()).is_some()
    });
    policy.capabilities = Some(capabilities);
    policy.cpu_iteration_behavior = settings.cpu_iteration_behavior;
    policy.lm_device = settings.lm_device.clone();
    Ok(policy)
}

pub(crate) fn active_profile(state: &AppState) -> Result<Value> {
    let settings = state.db.settings()?;
    let selection = Selection::from_settings(&settings);
    let catalog = catalog::catalog();
    let name = catalog
        .profile(&selection)
        .map(|profile| profile.name.as_str())
        .or_else(|| {
            catalog
                .providers
                .iter()
                .find(|p| p.id == selection.provider)
                .map(|p| p.name.as_str())
        })
        .unwrap_or(&selection.provider);
    let available = state.runtime.is_ready()
        && catalog
            .ensure_allowed(
                &selection,
                settings.expert_mode,
                Some(crate::hardware::inspect()),
            )
            .is_ok()
        && catalog::ensure_runtime(&selection, &state.resources, &state.db.root).is_ok()
        && ensure_cached(state, &settings, &selection).is_ok();
    let mut profile = serde_json::json!({"selection": selection, "name": name,
        "capabilities": catalog::capabilities(&selection)?, "available": available});
    if selection.provider == "yue2" {
        profile["analysis_available"] =
            analysis::installed_ace_step(state, &settings, crate::hardware::inspect())
                .is_some()
                .into();
    }
    Ok(profile)
}
