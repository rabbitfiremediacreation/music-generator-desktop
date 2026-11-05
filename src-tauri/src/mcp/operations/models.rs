use super::{tasks, value};
use crate::{
    catalog::{self, Selection},
    error::{message, Result},
    runtime::OperationKind,
    state::AppState,
};
use serde_json::{json, Value};
use std::{path::Path, sync::Arc};
use tauri::{AppHandle, Emitter};

pub(super) fn select<R: tauri::Runtime>(
    state: &AppState,
    app: &AppHandle<R>,
    selection: Selection,
) -> Result<Value> {
    let _operation = state.runtime.try_begin(OperationKind::Models)?;
    catalog::activate_cached_profile(&state.db, &selection, crate::hardware::inspect())?;
    state.stop_engine();
    changed(state, app);
    value(selection)
}

pub(super) fn install<R: tauri::Runtime>(
    state: Arc<AppState>,
    app: &AppHandle<R>,
    selection: Selection,
) -> Result<Value> {
    let operation = state.runtime.try_begin(OperationKind::Models)?;
    catalog::validate_activation(
        &state.db.settings()?,
        &selection,
        crate::hardware::inspect(),
    )?;
    let cancel = operation.cancellation();
    let task = tasks::for_app(app).begin("install_models", cancel.clone())?;
    let result = task.accepted();
    let progress = task.clone();
    let app = app.clone();
    task.spawn(async move {
        let _operation = operation;
        state.stop_engine();
        let outcome = catalog::install_profile(
            &catalog::catalog(),
            &state.db,
            &selection,
            &cancel,
            |update| {
                progress.progress(&update);
                let _ = app.emit("model-download-progress", update);
            },
        )
        .await;
        changed(&state, &app);
        outcome?;
        Ok(json!({"selection":selection}))
    });
    Ok(result)
}

pub(super) fn title<R: tauri::Runtime>(state: Arc<AppState>, app: &AppHandle<R>) -> Result<Value> {
    let operation = state.runtime.try_begin(OperationKind::Models)?;
    let settings = state.db.settings()?;
    if !settings.setup_complete {
        return Err(message("Complete the first-run assistant first"));
    }
    let cancel = operation.cancellation();
    let task = tasks::for_app(app).begin("download_title_model", cancel.clone())?;
    let result = task.accepted();
    let progress = task.clone();
    let app = app.clone();
    task.spawn(async move {
        let _operation = operation;
        state.stop_engine();
        let outcome = crate::titles::install(
            &state.db.root,
            Path::new(&settings.models_dir),
            &cancel,
            |update| {
                progress.progress(&update);
                let _ = app.emit("model-download-progress", update);
            },
        )
        .await;
        changed(&state, &app);
        outcome?;
        Ok(json!({"installed":true}))
    });
    Ok(result)
}

fn changed<R: tauri::Runtime>(state: &AppState, app: &AppHandle<R>) {
    let _ = app.emit("models-changed", ());
    state.changed(app);
}
