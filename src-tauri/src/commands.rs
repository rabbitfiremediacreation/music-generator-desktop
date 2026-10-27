use crate::{
    configuration::SettingsPatch,
    error::{message, Result},
    runtime::OperationKind,
    state::AppState,
    types::{GenerateRequest, Settings, Song, SongFilter},
};
use serde_json::{json, Value};
use std::{path::PathBuf, sync::Arc};
use tauri::{AppHandle, Emitter, Manager, State};

type Desktop<'a> = State<'a, Arc<AppState>>;

#[tauri::command]
pub async fn get_generation_form_preferences(
    state: Desktop<'_>,
) -> Result<crate::form_preferences::GenerationFormPreferences> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let selection = crate::catalog::Selection::from_settings(&state.db.settings()?);
        let defaults = state
            .synthesis_probe
            .session_policy(&state.resources, &selection, false, || {
                state.backend_status()
            })
            .defaults;
        state
            .db
            .generation_form_preferences_with_defaults(&defaults)
    })
    .await
    .map_err(|e| message(e.to_string()))?
}

#[tauri::command]
pub async fn generation_policy(
    state: Desktop<'_>,
    selection: Option<crate::catalog::Selection>,
    refresh: bool,
) -> Result<crate::synthesis_policy::Policy> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let settings = state.db.settings()?;
        let selection = selection.unwrap_or(crate::catalog::Selection::from_settings(&settings));
        let mut policy =
            state
                .synthesis_probe
                .session_policy(&state.resources, &selection, refresh, || {
                    state.backend_status()
                });
        policy.cpu_iteration_behavior = settings.cpu_iteration_behavior;
        policy.lm_device = settings.lm_device;
        Ok(policy)
    })
    .await
    .map_err(|e| message(e.to_string()))?
}

#[tauri::command]
pub fn save_generation_form_preferences(
    state: Desktop<'_>,
    values: crate::form_preferences::GenerationFormPreferences,
) -> Result<()> {
    state.db.save_generation_form_preferences(&values)
}

#[tauri::command]
pub fn remember_folder(path: String) -> Result<()> {
    crate::sandbox::remember(std::path::Path::new(&path)).map_err(|_| message("path_access"))
}

#[tauri::command]
pub async fn bootstrap(
    startup: State<'_, crate::startup::Startup>,
    app: AppHandle,
    attempt: u64,
) -> Result<Value> {
    let state = startup.prepare(&app, attempt).await?;
    let _operation = state.runtime.begin(OperationKind::Startup).await?;
    startup.ensure_active(attempt)?;
    let started = std::time::Instant::now();
    startup.report(&app, attempt, "hardware", None);
    let hardware = tauri::async_runtime::spawn_blocking(crate::hardware::inspect)
        .await
        .map_err(|e| message(e.to_string()))?;
    tracing::info!(
        elapsed_ms = started.elapsed().as_millis(),
        "Startup hardware check finished"
    );
    startup.ensure_active(attempt)?;
    startup.report(&app, attempt, "settings", None);
    let settings = state.db.settings()?;
    let needs_setup = !settings.setup_complete;
    if !needs_setup {
        app.asset_protocol_scope()
            .allow_directory(&settings.songs_dir, false)
            .map_err(|e| message(e.to_string()))?;
    }
    state.restore_setup()?;
    tracing::info!(
        elapsed_ms = started.elapsed().as_millis(),
        needs_setup,
        "Startup setup check finished"
    );
    startup.ensure_active(attempt)?;
    startup.report(&app, attempt, "interface", None);
    Ok(
        json!({"needs_setup":needs_setup,"recommended_profiles":crate::catalog::catalog().recommended_profiles(hardware),"settings":settings,"hardware":hardware,"manifest":crate::manifest::manifest(),"title_model":crate::titles::manifest().model,"error":null,"version":env!("CARGO_PKG_VERSION"),"data_dir":state.db.root}),
    )
}

#[tauri::command]
pub async fn setup_models(
    state: Desktop<'_>,
    app: AppHandle,
    request: crate::setup::SetupRequest,
) -> Result<Value> {
    let result = crate::setup::configure(
        state.inner().clone(),
        request,
        |progress| {
            let _ = app.emit("setup-progress", progress);
        },
        |stage| {
            let _ = app.emit("setup-stage", stage);
        },
        |songs| authorize_songs(&app, songs),
    )
    .await?;
    state.changed(&app);
    Ok(result)
}

#[tauri::command]
pub fn setup_estimate(state: Desktop<'_>, request: crate::setup::SetupRequest) -> Result<Value> {
    crate::setup::validate_selection(&request, &state.db.settings()?, crate::hardware::inspect())?;
    let models = crate::setup::plan(&request)?;
    let (root, _) = crate::paths::setup_folders(&request.models_dir, &request.songs_dir)?;
    let ancestor = crate::paths::folder_ancestor(&root)?;
    let missing: u64 = models
        .iter()
        .filter(|(m, _)| !root.join(&m.file).is_file())
        .map(|(m, _)| {
            m.estimated_bytes.saturating_sub(
                root.join(format!("{}.part", m.file))
                    .metadata()
                    .map(|m| m.len())
                    .unwrap_or(0),
            )
        })
        .sum();
    Ok(
        json!({"missing_bytes":missing,"free_bytes":fs2::available_space(ancestor).map_err(|_| message("path_access"))?}),
    )
}

#[tauri::command]
pub fn cancel_setup(state: Desktop<'_>) {
    state.runtime.cancel_configuration();
}

#[tauri::command]
pub async fn preview_import(
    state: Desktop<'_>,
    request: crate::import::ImportRequest,
) -> Result<crate::import::ImportPreview> {
    let operation = state.runtime.try_begin(OperationKind::Import)?;
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        crate::import::preview(&db, &request)
    })
    .await
    .map_err(|e| message(e.to_string()))?
}

#[tauri::command]
pub async fn preview_library_move(
    state: Desktop<'_>,
    songs_dir: String,
) -> Result<crate::import::ImportPreview> {
    let operation = state.runtime.try_begin(OperationKind::Settings)?;
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        crate::import::preview_move(&db, &songs_dir)
    })
    .await
    .map_err(|e| message(e.to_string()))?
}

#[tauri::command]
pub async fn import_library(
    state: Desktop<'_>,
    app: AppHandle,
    request: crate::import::ImportRequest,
) -> Result<crate::import::ImportResult> {
    let operation = state.runtime.try_begin(OperationKind::Import)?;
    // Authorize playback and persist the target grant before any durable database change.
    authorize_songs(&app, std::path::Path::new(&request.songs_dir))?;
    let db = state.db.clone();
    let events = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        crate::import::import_library(&db, &request, &operation.cancellation(), |progress| {
            let _ = events.emit("import-progress", progress);
        })
    })
    .await
    .map_err(|e| message(e.to_string()))??;
    let _ = app.emit("settings-changed", ());
    state.changed(&app);
    Ok(result)
}

#[tauri::command]
pub fn list_songs(state: Desktop<'_>, filter: SongFilter) -> Result<Vec<Song>> {
    state.db.songs(&filter)
}

#[tauri::command]
pub fn get_song(state: Desktop<'_>, id: String) -> Result<Song> {
    state.db.song(&id)
}

#[tauri::command]
pub fn generate(state: Desktop<'_>, app: AppHandle, request: GenerateRequest) -> Result<Value> {
    let ids = crate::admission::generate(&state, request)?;
    state.changed(&app);
    Ok(json!({"ids":ids}))
}

#[tauri::command]
pub fn patch_song(state: Desktop<'_>, app: AppHandle, id: String, patch: Value) -> Result<Song> {
    state.db.patch(&id, &patch)?;
    state.changed(&app);
    state.db.song(&id)
}

#[tauri::command]
pub fn delete_song(state: Desktop<'_>, app: AppHandle, id: String) -> Result<Value> {
    let cancelled = state.db.cancel_or_delete(&id)?;
    if cancelled {
        state.runtime.cancel_song(&id);
    }
    state.changed(&app);
    Ok(json!({"cancelled":cancelled,"deleted":!cancelled}))
}

#[tauri::command]
pub fn retry_song(state: Desktop<'_>, app: AppHandle, id: String) -> Result<Song> {
    crate::admission::retry(&state, &id)?;
    state.changed(&app);
    state.db.song(&id)
}

#[tauri::command]
pub fn list_folders(state: Desktop<'_>) -> Result<Value> {
    state.db.folders()
}

#[tauri::command]
pub fn save_folder(
    state: Desktop<'_>,
    app: AppHandle,
    id: Option<String>,
    name: String,
) -> Result<Value> {
    let folder = state.db.folder_save(id.as_deref(), &name)?;
    state.changed(&app);
    Ok(folder)
}

#[tauri::command]
pub fn delete_folder(state: Desktop<'_>, app: AppHandle, id: String) -> Result<()> {
    state.db.folder_delete(&id)?;
    state.changed(&app);
    Ok(())
}

#[tauri::command]
pub fn queue(state: Desktop<'_>) -> Result<Value> {
    let mut queue = state.db.queue()?;
    queue["active"] = json!(state.runtime.is_busy());
    queue["progress"] = json!(state.runtime.progress());
    Ok(queue)
}

#[tauri::command]
pub fn get_settings(state: Desktop<'_>) -> Result<Value> {
    let settings = state.db.settings()?;
    let mut result = serde_json::to_value(&settings)?;
    result["songs_dir_default"] = json!(state.db.root.join("songs"));
    result["mp3_available"] = json!(crate::audio_export::codec_path(&state.resources).is_file());
    let hardware = crate::hardware::inspect();
    result["cpu_only"] = json!(hardware.cpu_only);
    result["recommended_profiles"] =
        json!(crate::catalog::catalog().recommended_profiles(hardware));
    result["dit_xl_available"] = json!(PathBuf::from(settings.models_dir)
        .join("acestep-v15-xl-sft-Q8_0.gguf")
        .is_file());
    Ok(result)
}

#[tauri::command]
pub async fn save_settings(
    state: Desktop<'_>,
    app: AppHandle,
    values: SettingsPatch,
) -> Result<Settings> {
    let events = app.clone();
    let settings = crate::configuration::save_with_progress(
        state.inner().clone(),
        values,
        |songs| authorize_songs(&app, songs),
        move |progress| {
            let _ = events.emit("import-progress", progress);
        },
    )
    .await?;
    let _ = app.emit("settings-changed", ());
    state.changed(&app);
    Ok(settings)
}

fn authorize_songs(app: &AppHandle, songs: &std::path::Path) -> Result<()> {
    crate::sandbox::remember(songs)?;
    app.asset_protocol_scope()
        .allow_directory(songs, false)
        .map_err(|e| message(e.to_string()))
}

#[tauri::command]
pub async fn analyze(
    state: Desktop<'_>,
    data: Vec<u8>,
    filename: String,
    selection: Option<crate::catalog::Selection>,
) -> Result<Value> {
    if data.len() > 60 * 1024 * 1024 {
        return Err(message("audio_size"));
    }
    let extension = filename.rsplit('.').next().unwrap_or("").to_lowercase();
    if !crate::audio_import::AUDIO_EXTENSIONS.contains(&extension.as_str()) {
        return Err(message("audio_type"));
    }
    let operation = state.runtime.try_begin(OperationKind::Analysis)?;
    if !state.runtime.is_ready() {
        return Err(message("Complete model setup first"));
    }
    let settings = crate::admission::analysis_settings(&state, selection)?;
    let cancel = operation.cancellation();
    let engine = state.start_engine(&operation, &settings).await?;
    let _awake = crate::power::KeepAwake::new();
    engine
        .analyze(
            data,
            filename,
            &crate::catalog::Selection::from_settings(&settings),
            &cancel,
        )
        .await
}

#[tauri::command]
pub async fn health(state: Desktop<'_>) -> Result<Value> {
    Ok(state.health().await)
}

#[tauri::command]
pub fn export_default_path(
    state: Desktop<'_>,
    app: AppHandle,
    filename: String,
) -> Result<PathBuf> {
    let fallback = crate::paths::dialog_directory(app, None, None, true)?;
    state
        .db
        .export_default_path(&filename, std::path::Path::new(&fallback))
}

#[tauri::command]
pub async fn export_file(
    state: Desktop<'_>,
    kind: String,
    id: Option<String>,
    folder: Option<String>,
    destination: String,
) -> Result<()> {
    let destination = PathBuf::from(destination);
    if !destination.is_absolute() {
        return Err(message("Select an absolute destination"));
    }
    crate::exports::export(
        state.db.clone(),
        state.resources.clone(),
        kind,
        id,
        folder,
        destination,
        state.runtime.cancellation(),
    )
    .await
}

#[tauri::command]
pub async fn check_update() -> Result<Value> {
    crate::updates::check().await
}

#[tauri::command]
pub fn exit_app(app: AppHandle) {
    if let Some(state) = app.try_state::<Arc<AppState>>() {
        state.begin_shutdown();
    }
    app.exit(0);
}
