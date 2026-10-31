use super::{authorize, string, tasks, value};
use crate::{
    error::{message, Error, Result},
    runtime::OperationKind,
    state::AppState,
};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use tauri::{AppHandle, Emitter};

mod export_target;

pub(super) fn analyze<R: tauri::Runtime>(
    state: Arc<AppState>,
    app: &AppHandle<R>,
    args: Value,
) -> Result<Value> {
    let path = absolute(string(&args, "path")?)?;
    let selection = args
        .get("selection")
        .cloned()
        .map(serde_json::from_value)
        .transpose()?;
    let operation = state.runtime.try_begin(OperationKind::Analysis)?;
    if !state.runtime.is_ready() {
        return Err(message("Complete model setup first"));
    }
    let settings = crate::admission::analysis_settings(&state, selection)?;
    let cancel = operation.cancellation();
    let task = tasks::for_app(app).begin("analyze_audio", cancel.clone())?;
    let result = task.accepted();
    let progress = task.clone();
    task.spawn(async move {
        let _operation = operation;
        progress.progress(json!({"phase":"reading"}));
        let audio = tauri::async_runtime::spawn_blocking(move || {
            crate::audio_import::read_selection(&path)
        })
        .await
        .map_err(|error| message(error.to_string()))??;
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        progress.progress(json!({"phase":"analyzing"}));
        let engine = state.start_engine(&_operation, &settings).await?;
        let _awake = crate::power::KeepAwake::new();
        engine
            .analyze(
                audio.data,
                audio.name,
                &crate::catalog::Selection::from_settings(&settings),
                &cancel,
            )
            .await
    });
    Ok(result)
}

pub(super) fn export<R: tauri::Runtime>(
    state: Arc<AppState>,
    app: &AppHandle<R>,
    args: Value,
) -> Result<Value> {
    let operation = state.runtime.try_begin(OperationKind::Export)?;
    let kind = string(&args, "kind")?.to_string();
    let id = args["id"].as_str().map(str::to_string);
    let folder = args["folder"].as_str().map(str::to_string);
    if kind != "zip" && id.is_none() {
        return Err(message("Audio and lyrics exports require a song id"));
    }
    let destination = absolute(string(&args, "destination")?)?;
    let overwrite = args["overwrite"].as_bool().unwrap_or(false);
    let target = export_target::Target::new(&state, &kind, &destination, overwrite)?;
    let cancel = operation.cancellation();
    let task = tasks::for_app(app).begin("export_file", cancel.clone())?;
    let result = task.accepted();
    let progress = task.clone();
    task.spawn(async move {
        let _operation = operation;
        progress.progress(json!({"phase":"exporting"}));
        crate::exports::export_contents(
            state.db.clone(),
            state.resources.clone(),
            kind,
            id,
            folder,
            target.path().into(),
            cancel.clone(),
        )
        .await?;
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        target.commit()?;
        if let Some(parent) = destination.parent() {
            if let Err(error) = state.db.remember_export_directory(parent) {
                tracing::warn!(%error,"Could not remember MCP export directory");
            }
        }
        Ok(json!({"path":destination,"bytes":std::fs::metadata(&destination)?.len()}))
    });
    Ok(result)
}

pub(super) async fn preview_import(state: Arc<AppState>, args: Value) -> Result<Value> {
    let request = import_request(args)?;
    let operation = state.runtime.try_begin(OperationKind::Import)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        value(crate::import::preview(&state.db, &request)?)
    })
    .await
    .map_err(|error| message(error.to_string()))?
}

pub(super) async fn preview_move(state: Arc<AppState>, args: Value) -> Result<Value> {
    let destination = absolute(string(&args, "songs_dir")?)?;
    let operation = state.runtime.try_begin(OperationKind::Settings)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        value(crate::import::preview_move(
            &state.db,
            &destination.to_string_lossy(),
        )?)
    })
    .await
    .map_err(|error| message(error.to_string()))?
}

pub(super) fn import<R: tauri::Runtime>(
    state: Arc<AppState>,
    app: &AppHandle<R>,
    args: Value,
) -> Result<Value> {
    let request = import_request(args)?;
    let operation = state.runtime.try_begin(OperationKind::Import)?;
    authorize(app, Path::new(&request.songs_dir))?;
    let cancel = operation.cancellation();
    let task = tasks::for_app(app).begin("import_library", cancel.clone())?;
    let result = task.accepted();
    let progress = task.clone();
    let app = app.clone();
    task.spawn(async move {
        let events = app.clone();
        let database = state.db.clone();
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            let _operation = operation;
            crate::import::import_library(&database, &request, &cancel, |update| {
                progress.progress(&update);
                let _ = events.emit("import-progress", update);
            })
        })
        .await
        .map_err(|error| message(error.to_string()))??;
        let _ = app.emit("settings-changed", ());
        state.changed(&app);
        value(outcome)
    });
    Ok(result)
}

fn absolute(path: &str) -> Result<PathBuf> {
    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return Err(message(
            "Select an absolute path accessible to the desktop app",
        ));
    }
    Ok(path)
}

fn import_request(args: Value) -> Result<crate::import::ImportRequest> {
    let request: crate::import::ImportRequest = serde_json::from_value(args)?;
    absolute(&request.root)?;
    absolute(&request.songs_dir)?;
    if let Some(source) = &request.songs_source {
        absolute(source)?;
    }
    Ok(request)
}
