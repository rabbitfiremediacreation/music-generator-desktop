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
        catalog::ensure_runtime(&selection, &state.resources)?;
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

/// An alternative runtime may only execute the exact checkpoint and adapter accepted with the job.
pub(crate) fn validate_saved_profile(selection: &Selection, params: &Value) -> Result<()> {
    if selection.provider == "ace-step" {
        return Ok(());
    }
    let current = serde_json::to_value(catalog::generation_profile(selection)?)?;
    if params["generation_profile"] != current {
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
        catalog::ensure_runtime(&selection, &state.resources)?;
        validate_saved_profile(&selection, &song.params)?;
        if selection.provider != "ace-step" {
            let capabilities = catalog::capabilities(&selection)?;
            let mut request: GenerateRequest = serde_json::from_value(song.params)?;
            request.variants = 1;
            if !capabilities.prompt {
                // The library caption for a tag-based model is derived from its style tags.
                request.caption.clear();
            }
            crate::generation_limits::validate_request(&request, &capabilities)?;
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
    let mut policy = if capabilities.advanced {
        state
            .synthesis_probe
            .session_policy(&state.resources, selection, refresh, || {
                state.backend_status()
            })
    } else {
        let mut policy = synthesis_policy::policy(Backend::Unknown, selection);
        policy.legacy_inference_steps = 0;
        policy.recommended_steps = 0;
        policy.defaults.inference_steps = 0;
        policy.defaults.lm_temperature = 0.0;
        policy.defaults.duration = policy.defaults.duration.clamp(
            f64::from(capabilities.min_duration),
            f64::from(capabilities.max_duration),
        );
        policy.defaults.variants = policy.defaults.variants.min(capabilities.max_variants);
        policy
    };
    policy.available = catalog::ensure_runtime(selection, &state.resources).is_ok();
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
        && catalog::ensure_runtime(&selection, &state.resources).is_ok()
        && ensure_cached(state, &settings, &selection).is_ok();
    Ok(serde_json::json!({"selection": selection, "name": name,
        "capabilities": catalog::capabilities(&selection)?, "available": available}))
}

/// Validate before starting or modifying the analysis engine.
pub fn analysis_settings(state: &AppState, selection: Option<Selection>) -> Result<Settings> {
    let mut settings = state.db.settings()?;
    if let Some(selection) = selection {
        selection.apply(&mut settings)?;
    }
    let selection = Selection::from_settings(&settings);
    if !catalog::capabilities(&selection)?.analysis {
        return Err(message("This model does not support audio analysis"));
    }
    catalog::ensure_allowed(&selection, settings.expert_mode)?;
    Ok(settings)
}
