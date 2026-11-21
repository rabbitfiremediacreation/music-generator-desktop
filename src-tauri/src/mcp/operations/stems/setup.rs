use super::super::{tasks, value};
use crate::{
    error::Result,
    runtime::OperationKind,
    state::AppState,
    stems::{engine, model, transfer::Transfer},
};
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

pub(crate) fn select<R: tauri::Runtime>(
    state: Arc<AppState>,
    app: &AppHandle<R>,
    args: Value,
) -> Result<Value> {
    let pin: model::Pin = serde_json::from_value(args["pin"].clone())?;
    model::get(&pin.model)?;
    if args["download_missing"] != true {
        state
            .runtime
            .update_preferences(|| model::activate(&state, &pin))?;
        let _ = app.emit("stem-models-changed", ());
        return value(pin);
    }
    let operation = state.runtime.try_begin(OperationKind::Models)?;
    let cancel = operation.cancellation();
    let transfer = Transfer::claim(state.clone(), &pin.model, cancel.clone())?;
    let task = tasks::for_app(app).begin("set_stem_model", cancel.clone())?;
    let result = task.accepted();
    let progress = task.clone();
    let app = app.clone();
    let _ = app.emit("stem-models-changed", ());
    task.spawn(async move {
        let outcome = async {
            let engine_events =
                crate::download::ProgressEvents::new(&app, "engine-download-progress");
            progress.progress(json!({"phase":"engine"}));
            engine::install(&state, &cancel, |update| {
                progress.progress(&update);
                engine_events.report(update);
            })
            .await?;
            drop(engine_events);
            let model_events = crate::download::ProgressEvents::new(&app, "stem-download-progress");
            model::install(&state, &pin, &cancel, |update| {
                progress.progress(&update);
                model_events.report(update);
            })
            .await
        }
        .await;
        drop(transfer);
        drop(operation);
        let _ = app.emit("stem-models-changed", ());
        let _ = app.emit("models-changed", ());
        state.changed(&app);
        outcome?;
        value(pin)
    });
    Ok(result)
}
