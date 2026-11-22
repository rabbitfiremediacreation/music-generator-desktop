use super::{engine, export, jobs, layer, mix, model, model_layer, removal, source, spectral};
use crate::{
    error::{message, Result},
    runtime::{JobProgress, OperationKind},
    state::AppState,
};
use std::{path::PathBuf, sync::Arc};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

type Desktop<'a> = State<'a, Arc<AppState>>;

#[tauri::command]
pub fn stem_models(state: Desktop<'_>) -> Result<model::Catalog> {
    model::catalog(&state)
}

#[tauri::command]
pub async fn stem_search(state: Desktop<'_>, query: String, limit: u8) -> Result<Vec<model::Hit>> {
    let cancel = state.runtime.cancellation();
    if let Some(previous) = state.stem_search.lock().unwrap().replace(cancel.clone()) {
        previous.cancel();
    }
    model::search(&state.db.root, query.trim(), limit, &cancel).await
}

#[tauri::command]
pub fn stem_cancel_search(state: Desktop<'_>) {
    if let Some(cancel) = state.stem_search.lock().unwrap().take() {
        cancel.cancel();
    }
}

#[tauri::command]
pub async fn stem_hf_check(state: Desktop<'_>) -> Result<()> {
    model::check_connection(&state.db.root, &state.runtime.cancellation()).await
}

#[tauri::command]
pub async fn stem_check_update(state: Desktop<'_>, id: String) -> Result<model::Hit> {
    model::update(&state, &id, &state.runtime.cancellation()).await
}

async fn transfer<T>(
    state: &Arc<AppState>,
    app: &AppHandle,
    key: &str,
    run: impl AsyncFnOnce(tokio_util::sync::CancellationToken) -> Result<T>,
) -> Result<T> {
    let transfer = state.runtime.transfer("stems", key)?;
    let _ = app.emit("stem-models-changed", ());
    run(transfer.cancellation()).await
}

#[tauri::command]
pub async fn stem_install_engine(state: Desktop<'_>, app: AppHandle) -> Result<()> {
    let result = transfer(&state, &app, "engine", async |cancel| {
        let events = crate::download::ProgressEvents::new(&app, "engine-download-progress");
        engine::install(&state, &cancel, |progress| events.report(progress)).await
    })
    .await;
    let _ = app.emit("stem-models-changed", ());
    let _ = app.emit("models-changed", ());
    result
}

#[tauri::command]
pub async fn stem_install_model(state: Desktop<'_>, app: AppHandle, pin: model::Pin) -> Result<()> {
    let result = transfer(&state, &app, &pin.model, async |cancel| {
        let events = crate::download::ProgressEvents::new(&app, "stem-download-progress");
        model::install(&state, &pin, &cancel, |progress| events.report(progress)).await
    })
    .await;
    let _ = app.emit("stem-models-changed", ());
    result
}

#[tauri::command]
pub fn stem_pause_transfer(state: Desktop<'_>, id: String) {
    state.runtime.cancel_transfer(Some("stems"), Some(&id));
}

#[tauri::command]
pub async fn stem_discard_partial(state: Desktop<'_>, app: AppHandle, id: String) -> Result<()> {
    let _operation = state.runtime.try_begin(OperationKind::Models)?;
    model::discard(&state, &id)?;
    let _ = app.emit("stem-models-changed", ());
    Ok(())
}

#[tauri::command]
pub fn stem_model_removal(state: Desktop<'_>, pin: model::Pin) -> Result<model::Removal> {
    model::removal(&state, &pin)
}

#[tauri::command]
pub async fn stem_remove_model(state: Desktop<'_>, app: AppHandle, pin: model::Pin) -> Result<()> {
    let _operation = state.runtime.try_begin(OperationKind::Models)?;
    model::remove(&state, &pin)?;
    let _ = app.emit("stem-models-changed", ());
    Ok(())
}

#[tauri::command]
pub fn stem_activate_model(state: Desktop<'_>, app: AppHandle, pin: model::Pin) -> Result<()> {
    state
        .runtime
        .update_preferences(|| model::activate(&state, &pin))?;
    let _ = app.emit("stem-models-changed", ());
    Ok(())
}

#[tauri::command]
pub async fn stem_song_source(state: Desktop<'_>, id: String) -> Result<source::Source> {
    source::song(&state, &id).await
}

#[derive(serde::Serialize)]
pub struct Import {
    name: String,
    source: Option<source::Source>,
    error: Option<String>,
}

#[tauri::command]
pub async fn stem_pick_sources(
    state: Desktop<'_>,
    app: AppHandle,
    title: String,
) -> Result<Vec<Import>> {
    let files = tokio::task::spawn_blocking(move || {
        let mut dialog = app
            .dialog()
            .file()
            .set_title(title)
            .add_filter("Audio", crate::audio_import::AUDIO_EXTENSIONS);
        if let Some(window) = app.get_webview_window("main") {
            dialog = dialog.set_parent(&window);
        }
        dialog.blocking_pick_files()
    })
    .await
    .map_err(|_| message("audio_read"))?;
    let Some(files) = files else {
        return Ok(Vec::new());
    };
    let mut imports = Vec::new();
    for file in files {
        let path = file.into_path().map_err(|_| message("audio_read"))?;
        let name = path
            .file_name()
            .ok_or_else(|| message("audio_read"))?
            .to_string_lossy()
            .into_owned();
        let cancel = state.runtime.cancellation();
        let (source, error) = match source::snapshot(&state, &path, &name, None, &cancel).await {
            Ok(source) => (Some(source), None),
            Err(error) => (None, Some(error.to_string())),
        };
        imports.push(Import {
            name,
            source,
            error,
        });
    }
    Ok(imports)
}

fn allow(app: &AppHandle, path: PathBuf) -> Result<String> {
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|_| message("stem_asset_missing"))?;
    Ok(path.to_string_lossy().into())
}

#[tauri::command]
pub fn stem_source_audio(state: Desktop<'_>, app: AppHandle, id: String) -> Result<String> {
    allow(&app, source::get(&state, &id)?.audio_path(&state.db.root)?)
}

#[tauri::command]
pub fn stem_project_audio(
    state: Desktop<'_>,
    app: AppHandle,
    id: String,
    role: String,
) -> Result<String> {
    allow(
        &app,
        layer::audio_path(&state, &jobs::get(&state, &id)?, &role)?,
    )
}

#[tauri::command]
pub async fn stem_add_track(
    state: Desktop<'_>,
    app: AppHandle,
    id: String,
    title: String,
) -> Result<Option<layer::Layer>> {
    let Some(path) = pick_audio(app, title).await? else {
        return Ok(None);
    };
    let filename = path
        .file_name()
        .ok_or_else(|| message("audio_read"))?
        .to_string_lossy();
    Ok(Some(layer::import(&state, &id, &path, &filename).await?))
}

#[tauri::command]
pub async fn stem_prepare_track_model(
    state: Desktop<'_>,
    app: AppHandle,
    selection: crate::catalog::Selection,
) -> Result<()> {
    let progress = crate::download::ProgressEvents::new(&app, "model-download-progress");
    let result = model_layer::prepare(&state, &selection, |update| progress.report(update)).await;
    drop(progress);
    let _ = app.emit("models-changed", ());
    result
}

#[tauri::command]
pub async fn stem_generate_track(
    state: Desktop<'_>,
    app: AppHandle,
    id: String,
    request: model_layer::Request,
    progress: tauri::ipc::Channel<JobProgress>,
) -> Result<layer::Layer> {
    let outcome = model_layer::generate(state.inner(), &id, request, |update| {
        let _ = progress.send(update);
    })
    .await;
    if outcome.is_ok() {
        state.changed(&app);
    }
    outcome
}

#[tauri::command]
pub fn stem_cancel_track_generation(state: Desktop<'_>, id: Option<String>) {
    state.runtime.cancel_stem_generation(id.as_deref());
}

#[tauri::command]
pub async fn stem_spectral_preview(
    state: Desktop<'_>,
    id: String,
    role: String,
    first: u64,
    end: u64,
) -> Result<spectral::Spectrogram> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || spectral::preview(&state, &id, &role, first, end))
        .await
        .map_err(|_| message("stem_spectral_failed"))?
}

#[tauri::command]
pub async fn stem_spectral_scan(
    state: Desktop<'_>,
    id: String,
    role: String,
) -> Result<Vec<spectral::Selection>> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || spectral::scan(&state, &id, &role))
        .await
        .map_err(|_| message("stem_spectral_failed"))?
}

#[tauri::command]
pub async fn stem_spectral_audition(
    state: Desktop<'_>,
    id: String,
    role: String,
    selection: spectral::RepairRequest,
) -> Result<tauri::ipc::Response> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || spectral::audition(&state, &id, &role, &selection))
        .await
        .map_err(|_| message("stem_spectral_failed"))?
        .map(tauri::ipc::Response::new)
}

#[tauri::command]
pub async fn stem_repair_spectrum(
    state: Desktop<'_>,
    id: String,
    role: String,
    selection: spectral::RepairRequest,
) -> Result<layer::Layer> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || spectral::apply(&state, &id, &role, &selection))
        .await
        .map_err(|_| message("stem_spectral_failed"))?
}

#[tauri::command]
pub async fn stem_relink_source(
    state: Desktop<'_>,
    app: AppHandle,
    id: String,
    title: String,
) -> Result<bool> {
    let Some(path) = pick_audio(app, title).await? else {
        return Ok(false);
    };
    source::relink(&state, &id, &path).await?;
    Ok(true)
}

async fn pick_audio(app: AppHandle, title: String) -> Result<Option<PathBuf>> {
    tokio::task::spawn_blocking(move || {
        let mut dialog = app
            .dialog()
            .file()
            .set_title(title)
            .add_filter("Audio", crate::audio_import::AUDIO_EXTENSIONS);
        if let Some(window) = app.get_webview_window("main") {
            dialog = dialog.set_parent(&window);
        }
        dialog
            .blocking_pick_file()
            .map(|file| file.into_path().map_err(|_| message("audio_read")))
            .transpose()
    })
    .await
    .map_err(|_| message("audio_read"))?
}

#[tauri::command]
pub async fn stem_preflight(state: Desktop<'_>, request: jobs::Request) -> Result<jobs::Preflight> {
    jobs::preflight(&state, &request)
}

#[tauri::command]
pub async fn stem_start(
    state: Desktop<'_>,
    app: AppHandle,
    request: jobs::Request,
) -> Result<String> {
    let id = jobs::enqueue(&state, request)?;
    state.changed(&app);
    Ok(id)
}

#[tauri::command]
pub fn stem_jobs(
    state: Desktop<'_>,
    song_id: Option<String>,
    source_id: Option<String>,
    folder_id: Option<String>,
    offset: u32,
) -> Result<Vec<jobs::Job>> {
    jobs::list(
        &state,
        song_id.as_deref(),
        source_id.as_deref(),
        folder_id.as_deref(),
        offset,
    )
}

#[tauri::command]
pub fn stem_job(state: Desktop<'_>, id: String) -> Result<jobs::Job> {
    jobs::get(&state, &id)
}

#[tauri::command]
pub fn stem_latest_project(state: Desktop<'_>, song_id: String) -> Result<jobs::Job> {
    jobs::latest_for_song(&state, &song_id)
}

#[tauri::command]
pub async fn stem_remove_project(state: Desktop<'_>, app: AppHandle, id: String) -> Result<()> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        removal::remove_project(&state, &id)?;
        state.changed(&app);
        Ok(())
    })
    .await
    .map_err(|error| message(error.to_string()))?
}

#[tauri::command]
pub fn stem_cancel(state: Desktop<'_>, app: AppHandle, id: String) -> Result<bool> {
    let ok = jobs::cancel(&state, &id)?;
    state.changed(&app);
    Ok(ok)
}

#[tauri::command]
pub fn stem_retry(state: Desktop<'_>, app: AppHandle, id: String) -> Result<()> {
    jobs::retry(&state, &id)?;
    state.changed(&app);
    Ok(())
}

#[tauri::command]
pub fn stem_mixes(state: Desktop<'_>, id: String) -> Result<Vec<mix::Version>> {
    mix::versions(&state, &id)
}

#[tauri::command]
pub fn stem_save_mix(
    state: Desktop<'_>,
    id: String,
    version: Option<String>,
    name: String,
    mix: mix::Mix,
) -> Result<mix::Version> {
    mix::save(&state, &id, version.as_deref(), &name, mix)
}

#[tauri::command]
pub async fn stem_start_export(
    state: Desktop<'_>,
    app: AppHandle,
    request: export::Request,
) -> Result<String> {
    let id = export::start(&state, request)?;
    state.changed(&app);
    Ok(id)
}

#[tauri::command]
pub fn stem_exports(state: Desktop<'_>, id: String) -> Result<Vec<export::Export>> {
    export::list(&state, &id)
}

#[tauri::command]
pub fn stem_cancel_export(state: Desktop<'_>, app: AppHandle, id: String) -> Result<bool> {
    let ok = export::cancel(&state, &id)?;
    state.changed(&app);
    Ok(ok)
}

#[tauri::command]
pub async fn stem_save_export(
    state: Desktop<'_>,
    app: AppHandle,
    id: String,
    title: String,
) -> Result<Option<String>> {
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        let fallback = app
            .path()
            .download_dir()
            .or_else(|_| app.path().home_dir())
            .map_err(|_| message("path_unavailable"))?;
        let default = state.db.export_default_path("Stems", &fallback)?;
        let mut dialog = app.dialog().file().set_title(title);
        if let Some(directory) = default.parent() {
            dialog = dialog.set_directory(directory);
        }
        let Some(path) = dialog.blocking_pick_folder() else {
            return Ok(None);
        };
        let path = path.into_path().map_err(|_| message("path_access"))?;
        let exported = export::save_to(&state, &id, &path)?;
        let _ = app
            .opener()
            .open_path(exported.to_string_lossy(), None::<&str>);
        Ok(Some(exported.to_string_lossy().into()))
    })
    .await
    .map_err(|_| message("stem_export_failed"))?
}

#[tauri::command]
pub async fn stem_open_export(state: Desktop<'_>, app: AppHandle, id: String) -> Result<()> {
    let first = export::path(&state, &id, 0)?;
    let path = first.parent().expect("export directory");
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|_| message("stem_export_failed"))
}
