use crate::{
    catalog::{self, Selection},
    error::{message, Result},
    hardware::{self, Hardware},
    state::AppState,
    types::Settings,
    verification::ModelVerifier,
};
use std::path::Path;

/// Find a complete, locally verified ACE-Step profile without changing the selected model.
pub(super) fn installed_ace_step(
    state: &AppState,
    settings: &Settings,
    hardware: &Hardware,
) -> Option<Selection> {
    if !crate::engine::engine_path(&state.resources).is_file() {
        return None;
    }
    let catalog = catalog::catalog();
    let models = Path::new(&settings.models_dir);
    let verifier = ModelVerifier::open(&state.db.root);
    let current = Selection::from_settings(settings);
    let allowed = |selection: &Selection| {
        selection.provider == "ace-step"
            && catalog
                .ensure_allowed(selection, settings.expert_mode, Some(hardware))
                .is_ok()
            && catalog.required(selection).is_ok_and(|files| {
                catalog::memory_bytes(&files) <= hardware.ram_bytes
                    && files
                        .iter()
                        .all(|file| verifier.is_verified(&models.join(&file.file), &file.sha256))
            })
    };
    let preferred = std::iter::once(current)
        .chain(settings.model_profiles.get("ace-step").cloned())
        .chain(catalog.recommended_profiles(hardware));
    if let Some(selection) = preferred.into_iter().find(allowed) {
        return Some(selection);
    }
    if !settings.expert_mode {
        return None;
    }
    let verifier = &verifier;
    let local = |role| {
        catalog.models.iter().filter(move |file| {
            file.provider == "ace-step"
                && file.role == role
                && verifier.is_verified(&models.join(&file.file), &file.sha256)
        })
    };
    let languages: Vec<_> = local("language").collect();
    local("synthesis").find_map(|synthesis| {
        languages.iter().find_map(|language| {
            let selection = Selection {
                provider: "ace-step".into(),
                synthesis: synthesis.file.clone(),
                language: language.file.clone(),
            };
            allowed(&selection).then_some(selection)
        })
    })
}

/// Resolve the analysis engine for the request without saving over the studio selection.
pub fn analysis_settings(state: &AppState, selection: Option<Selection>) -> Result<Settings> {
    analysis_settings_for_hardware(state, selection, hardware::inspect())
}

fn analysis_settings_for_hardware(
    state: &AppState,
    selection: Option<Selection>,
    hardware: &Hardware,
) -> Result<Settings> {
    let mut settings = state.db.settings()?;
    let selection = selection.unwrap_or_else(|| Selection::from_settings(&settings));
    let yue2 = selection.provider == "yue2";
    if !yue2 && !catalog::capabilities(&selection)?.analysis {
        return Err(message("This model does not support audio analysis"));
    }
    catalog::catalog().ensure_allowed(
        &selection,
        settings.expert_mode,
        (!settings.expert_mode).then_some(hardware),
    )?;
    let engine = if yue2 {
        installed_ace_step(state, &settings, hardware)
            .ok_or_else(|| message("yue2_analysis_requires_ace_step"))?
    } else {
        selection
    };
    engine.apply(&mut settings)?;
    Ok(settings)
}

#[cfg(test)]
mod tests;
