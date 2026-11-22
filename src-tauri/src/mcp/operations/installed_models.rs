use crate::{
    catalog::{self, Selection},
    error::Result,
    state::AppState,
    verification::ModelVerifier,
};
use serde_json::{json, Value};
use std::{collections::HashSet, path::Path};

/// Return complete local selections, including ACE-Step pairs assembled from independently installed assets.
pub(super) fn list(state: &AppState) -> Result<Value> {
    let settings = state.db.settings()?;
    let folder = Path::new(&settings.models_dir);
    let catalog = catalog::catalog();
    let verifier = ModelVerifier::open(&state.db.root);
    let verified: HashSet<_> = catalog
        .models
        .iter()
        .filter(|asset| verifier.is_verified(&folder.join(&asset.file), &asset.sha256))
        .map(|asset| (asset.provider.as_str(), asset.file.as_str()))
        .collect();
    let ace_assets = |role| {
        catalog
            .models
            .iter()
            .filter(move |asset| asset.provider == "ace-step" && asset.role == role)
            .filter(|asset| verified.contains(&("ace-step", asset.file.as_str())))
    };
    let mut candidates = catalog
        .profiles
        .iter()
        .map(|profile| profile.selection.clone())
        .collect::<Vec<_>>();
    for synthesis in ace_assets("synthesis") {
        for language in ace_assets("language") {
            candidates.push(Selection {
                provider: "ace-step".into(),
                synthesis: synthesis.file.clone(),
                language: language.file.clone(),
            });
        }
    }

    let mut profiles = Vec::new();
    let hardware = crate::hardware::inspect();
    for selection in candidates {
        let Ok(required) = catalog.required(&selection) else {
            continue;
        };
        if !required
            .iter()
            .all(|asset| verified.contains(&(asset.provider.as_str(), asset.file.as_str())))
        {
            continue;
        }
        let profile = catalog.profile(&selection);
        let availability = catalog
            .validate_activation(&settings, &selection, hardware)
            .and_then(|()| match profile {
                Some(profile) => profile.ensure_runtime(&state.resources, &state.db.root, hardware),
                None => catalog::ensure_runtime(&selection, &state.resources, &state.db.root),
            });
        profiles.push(json!({
            "name":profile.map_or(selection.synthesis.as_str(), |p| p.name.as_str()),
            "selection":selection, "available":availability.is_ok(),
            "unavailable_reason":availability.err().map(|error| error.to_string()),
            "output_kind":profile.map(|p| p.capabilities.output_kind).unwrap_or_default()
        }));
    }
    Ok(json!({"selection":Selection::from_settings(&settings),"profiles":profiles}))
}
