use crate::{
    catalog::{self, Selection},
    error::{message, Result},
    runtime::OperationKind,
    state::AppState,
    verification::ModelVerifier,
};
use serde_json::{json, Value};
use std::{path::Path, sync::Arc};
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub fn model_catalog(state: State<'_, Arc<AppState>>) -> Result<Value> {
    catalog_data(&state)
}

/// Share catalog discovery between the desktop interface and MCP without starting engines.
pub(crate) fn catalog_data(state: &AppState) -> Result<Value> {
    let settings = state.db.settings()?;
    let root = Path::new(&settings.models_dir);
    let verifier = ModelVerifier::open(&state.db.root);
    let catalog = catalog::catalog();
    let backend = crate::synthesis_policy::session_policy(
        state.synthesis_probe.cached(),
        &Selection::from_settings(&settings),
        &state.backend_status(),
    )
    .backend;
    let mut result = serde_json::to_value(&catalog)?;
    result["models"] = Value::Array(
        catalog
            .models
            .iter()
            .map(|model| {
                let mut value = serde_json::to_value(model).expect("model serialization");
                let path = root.join(&model.file);
                value["suggested_steps"] = json!(model
                    .recommended_steps
                    .map(|steps| { crate::synthesis_policy::recommended_steps(backend, steps) }));
                value["verified"] = json!(verifier.is_verified(&path, &model.sha256));
                value["present"] = json!(path.is_file());
                value["partial_bytes"] = json!(root
                    .join(format!("{}.part", model.file))
                    .metadata()
                    .map(|m| m.len())
                    .unwrap_or(0)
                    .min(model.estimated_bytes));
                value
            })
            .collect(),
    );
    result["title_model"] = crate::titles::status(root, &verifier);
    result["selection"] = json!(Selection::from_settings(&settings));
    result["expert_mode"] = json!(settings.expert_mode);
    let hardware = crate::hardware::inspect();
    result["recommended_profiles"] = json!(catalog.recommended_profiles(hardware));
    result["hardware"] = json!(hardware);
    result["free_bytes"] = json!(fs2::available_space(root).ok());
    result["models_dir"] = json!(settings.models_dir);
    result["busy"] = json!(state.runtime.is_busy());
    Ok(result)
}

/// Verify/download a complete profile before making it the default. The old profile
/// remains durable on errors, cancellation and shutdown. Queue rows are never rewritten.
#[tauri::command]
pub async fn use_models(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    selection: Selection,
) -> Result<Selection> {
    let operation = state.runtime.try_begin(OperationKind::Models)?;
    let settings = state.db.settings()?;
    catalog::validate_activation(&settings, &selection, crate::hardware::inspect())?;
    let cancel = operation.cancellation();
    // Stopping first releases resident model memory and refreshes the engine's file
    // registry on the next generation, including newly downloaded models.
    state.stop_engine();
    let outcome =
        catalog::install_profile(&catalog::catalog(), &state.db, &selection, &cancel, |p| {
            let _ = app.emit("model-download-progress", p);
        })
        .await
        .map(|()| selection);
    drop(operation);
    let _ = app.emit("models-changed", ());
    state.changed(&app);
    outcome
}

/// Creator drop-down: only activate an already verified local profile, without downloads.
#[tauri::command]
pub fn select_models(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    selection: Selection,
) -> Result<Selection> {
    let operation = state.runtime.try_begin(OperationKind::Models)?;
    catalog::activate_cached_profile(&state.db, &selection, crate::hardware::inspect())?;
    state.stop_engine();
    drop(operation);
    let _ = app.emit("models-changed", ());
    state.changed(&app);
    Ok(selection)
}

#[tauri::command]
pub fn cancel_model_download(state: State<'_, Arc<AppState>>) {
    state.runtime.cancel_configuration();
}

/// Shared auxiliary model; installing it never switches the active music profile.
#[tauri::command]
pub async fn download_title_model(state: State<'_, Arc<AppState>>, app: AppHandle) -> Result<()> {
    let operation = state.runtime.try_begin(OperationKind::Models)?;
    let settings = state.db.settings()?;
    if !settings.setup_complete {
        return Err(message("Complete the first-run assistant first"));
    }
    let cancel = operation.cancellation();
    state.stop_engine();
    let outcome = crate::titles::install(
        &state.db.root,
        Path::new(&settings.models_dir),
        &cancel,
        |p| {
            let _ = app.emit("model-download-progress", p);
        },
    )
    .await;
    drop(operation);
    let _ = app.emit("models-changed", ());
    outcome
}
