//! Agent operations share the desktop runtime, authorization and durable services.
mod files;
mod models;
mod schemas;
mod tasks;

#[cfg(all(test, unix))]
mod tests;

use crate::{
    error::{message, Result},
    state::AppState,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::{path::Path, sync::Arc};
use tauri::{AppHandle, Emitter, Manager};

pub fn tools() -> Vec<Value> {
    schemas::tools()
}

pub async fn call<R: tauri::Runtime>(
    name: &str,
    args: Value,
    state: Arc<AppState>,
    app: &AppHandle<R>,
) -> Option<Result<Value>> {
    Some(match name {
        "get_status" => status(state).await,
        "get_settings" => settings(&state),
        "update_settings" => save_settings(state, app, args).await,
        "get_generation_policy" => policy(state, args).await,
        "list_models" => crate::model_commands::catalog_data(&state),
        "select_models" => {
            selection(args).and_then(|selection| models::select(&state, app, selection))
        }
        "install_models" => {
            selection(args).and_then(|selection| models::install(state, app, selection))
        }
        "download_title_model" => models::title(state, app),
        "get_operation" => string(&args, "operation_id").and_then(|id| tasks::for_app(app).get(id)),
        "list_operations" => Ok(json!({"operations":tasks::for_app(app).list()})),
        "cancel_operation" => {
            string(&args, "operation_id").and_then(|id| tasks::for_app(app).cancel(id))
        }
        "analyze_audio" => files::analyze(state, app, args),
        "export_file" => files::export(state, app, args),
        "preview_import" => files::preview_import(state, args).await,
        "preview_library_move" => files::preview_move(state, args).await,
        "import_library" => files::import(state, app, args),
        _ => return None,
    })
}

pub(super) fn value(data: impl Serialize) -> Result<Value> {
    Ok(serde_json::to_value(data)?)
}

pub(super) fn string<'a>(args: &'a Value, name: &str) -> Result<&'a str> {
    args.get(name)
        .and_then(Value::as_str)
        .ok_or_else(|| message(format!("Missing string argument: {name}")))
}

fn selection(args: Value) -> Result<crate::catalog::Selection> {
    Ok(serde_json::from_value(
        args.get("selection")
            .cloned()
            .ok_or_else(|| message("Missing selection"))?,
    )?)
}

async fn status(state: Arc<AppState>) -> Result<Value> {
    let health = state.health().await;
    Ok(
        json!({"version":env!("CARGO_PKG_VERSION"),"ready":state.runtime.is_ready(),
        "busy":state.runtime.is_busy(),"health":health,"backend":state.backend_status(),
        "hardware":crate::hardware::inspect(),"queue":state.db.queue()?,
        "progress":state.runtime.progress(),"data_dir":state.db.root}),
    )
}

fn settings(state: &AppState) -> Result<Value> {
    Ok(
        json!({"settings":state.db.settings()?,"generation_preferences":state.db.generation_form_preferences()?,
        "mp3_available":crate::audio_export::codec_path(&state.resources).is_file(),
        "songs_dir_default":state.db.root.join("songs")}),
    )
}

async fn policy(state: Arc<AppState>, args: Value) -> Result<Value> {
    let selection = args
        .get("selection")
        .cloned()
        .map(serde_json::from_value::<crate::catalog::Selection>)
        .transpose()?;
    let refresh = args["refresh"].as_bool().unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        let settings = state.db.settings()?;
        let selection =
            selection.unwrap_or_else(|| crate::catalog::Selection::from_settings(&settings));
        crate::catalog::required(&selection)?;
        let mut policy =
            state
                .synthesis_probe
                .session_policy(&state.resources, &selection, refresh, || {
                    state.backend_status()
                });
        policy.cpu_iteration_behavior = settings.cpu_iteration_behavior;
        policy.lm_device = settings.lm_device;
        value(policy)
    })
    .await
    .map_err(|error| message(error.to_string()))?
}

async fn save_settings<R: tauri::Runtime>(
    state: Arc<AppState>,
    app: &AppHandle<R>,
    args: Value,
) -> Result<Value> {
    let values = serde_json::from_value(args)?;
    let events = app.clone();
    let settings = crate::configuration::save_with_progress(
        state.clone(),
        values,
        |songs| authorize(app, songs),
        move |progress| {
            let _ = events.emit("import-progress", progress);
        },
    )
    .await?;
    let _ = app.emit("settings-changed", ());
    state.changed(app);
    value(settings)
}

pub(super) fn authorize<R: tauri::Runtime>(app: &AppHandle<R>, path: &Path) -> Result<()> {
    crate::sandbox::remember(path)?;
    app.asset_protocol_scope()
        .allow_directory(path, false)
        .map_err(|error| message(error.to_string()))
}
