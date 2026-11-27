use super::{filename, Artwork};
use crate::{
    db::{safe_song_path, Database},
    download::ProgressEvents,
    error::{message, Error, Result},
    runtime::OperationKind,
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
    let outcome = super::install(&state.db.root, &transfer.cancellation(), |update| {
        progress.report(update);
    })
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
    state.runtime.cancel_cover_art(&id);
}

pub(super) async fn generate_existing<R: Runtime>(
    state: &AppState,
    app: &AppHandle<R>,
    id: &str,
) -> Result<()> {
    let operation = state.runtime.try_begin(OperationKind::CoverArt)?;
    let song = state.db.song(id)?;
    if song.status != "done" || song.audio_path().is_none() || filename(id).is_none() {
        return Err(message("cover_art_audio_required"));
    }
    if song.cover_path.is_some() {
        return Ok(());
    }
    if !super::installed(&state.db.root) {
        return Err(message("cover_art_install_required"));
    }
    operation.start_cover_art(id);
    let cancel = operation.cancellation();
    state.changed(app);
    let outcome = async {
        let _awake = crate::power::KeepAwake::new();
        state.stop_engine();
        let artwork = super::generate_for_song(
            &state.db.root,
            &song,
            song.result_meta.as_ref().unwrap_or(&Value::Null),
            &cancel,
        )
        .await?;
        let dir = state.db.settings()?.songs_dir;
        let db = state.db.clone();
        tokio::task::spawn_blocking(move || {
            let _operation = operation;
            attach(&db, Path::new(&dir), &song.id, artwork, &cancel)
        })
        .await
        .map_err(|error| message(error.to_string()))?
    }
    .await;
    state.changed(app);
    outcome
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
