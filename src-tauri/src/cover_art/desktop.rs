use super::{filename, Artwork};
use crate::{
    db::{safe_song_path, Database},
    download::ProgressEvents,
    error::{message, Error, Result},
    runtime::{Operation, OperationKind},
    state::AppState,
};
use rusqlite::params;
use serde_json::{json, Value};
use std::{io::Write, path::Path, sync::Arc};
use tauri::{AppHandle, Emitter, Runtime, State};
use tokio_util::sync::CancellationToken;

#[tauri::command]
pub async fn install_cover_art(state: State<'_, Arc<AppState>>, app: AppHandle) -> Result<()> {
    let transfer = state.runtime.transfer("models", "cover-art")?;
    let progress = ProgressEvents::new(&app, "cover-art-download-progress");
    state.changed(&app);
    let outcome = super::install(
        &state.db.root,
        &state.resources,
        &transfer.cancellation(),
        |update| {
            progress.report(update);
        },
    )
    .await;
    drop(progress);
    drop(transfer);
    let _ = app.emit("models-changed", ());
    state.changed(&app);
    outcome
}

#[tauri::command]
pub async fn generate_song_cover(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    id: String,
) -> Result<()> {
    generate_existing(&state, &app, &id).await
}

#[tauri::command]
pub fn cancel_song_cover(state: State<'_, Arc<AppState>>, id: String) {
    state.runtime.cancel_cover_art(Some(&id));
}

pub(super) async fn generate_existing<R: Runtime>(
    state: &AppState,
    app: &AppHandle<R>,
    id: &str,
) -> Result<()> {
    let operation = Arc::new(state.runtime.try_begin(OperationKind::CoverArt)?);
    operation.start_cover_art(id);
    state.changed(app);
    let _awake = crate::power::KeepAwake::new();
    let outcome = render_existing(state, id, &operation).await;
    drop(operation);
    state.changed(app);
    outcome
}

/// Recheck the track after admission and record a rendering failure for a later retry.
pub(super) async fn render_existing(
    state: &AppState,
    id: &str,
    operation: &Arc<Operation>,
) -> Result<()> {
    let song = state.db.song(id)?;
    if song.status != "done"
        || !song
            .audio_path()
            .is_some_and(|path| Path::new(path).is_file())
        || filename(id).is_none()
    {
        return Err(message("cover_art_audio_required"));
    }
    if song.cover_path.is_some() {
        return Ok(());
    }
    let cancel = operation.cancellation();
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    state.stop_engine();
    let artwork = super::generate_for_song(
        &state.db.root,
        &state.resources,
        &song,
        song.result_meta.as_ref().unwrap_or(&Value::Null),
        &cancel,
    )
    .await;
    let db = state.db.clone();
    let dir = db.settings()?.songs_dir;
    let operation = operation.clone();
    tokio::task::spawn_blocking(move || {
        let _operation = operation;
        let result = artwork.and_then(|art| attach(&db, Path::new(&dir), &song.id, art, &cancel));
        if let Err(error) = &result {
            if !matches!(error, Error::Cancelled) {
                db.lock().execute(
                    "UPDATE songs SET result_meta=json_patch(COALESCE(result_meta,'{}'),?2) WHERE id=?1 AND status='done'",
                    params![song.id, json!({"cover_art_error": error.to_string()}).to_string()],
                )?;
            }
        }
        result
    }).await.map_err(|error| message(error.to_string()))?
}

/// Publish the PNG alongside a metadata-only update, preserving the audio and all song fields.
pub(super) fn attach(
    db: &Database,
    dir: &Path,
    id: &str,
    artwork: Artwork,
    cancel: &CancellationToken,
) -> Result<()> {
    let filename = filename(id).ok_or_else(|| message("cover_art_audio_required"))?;
    let destination = safe_song_path(dir, &filename)?;
    let mut staged = tempfile::NamedTempFile::new_in(dir)?;
    staged.write_all(&artwork.png)?;
    staged.as_file().sync_all()?;
    let mut connection = db.lock();
    let transaction = connection.transaction()?;
    if transaction.execute(
        "UPDATE songs SET result_meta=json_patch(COALESCE(result_meta,'{}'),?2)
         WHERE id=?1 AND status='done' AND output_kind='audio' AND audio_missing=0 AND file IS NOT NULL",
        params![id, json!({"cover_art": artwork.provenance, "cover_art_error": null}).to_string()],
    )? == 0 {
        return Err(message("cover_art_audio_required"));
    }
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    staged
        .persist_noclobber(&destination)
        .map_err(|error| error.error)?;
    if let Err(error) = transaction.commit() {
        let _ = std::fs::remove_file(destination);
        return Err(error.into());
    }
    Ok(())
}
