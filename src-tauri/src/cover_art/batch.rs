use super::{desktop::render_existing, filename, output_path};
use crate::{
    db::{safe_song_path, Database},
    error::{message, Error, Result},
    runtime::OperationKind,
    state::AppState,
};
use serde::Serialize;
use std::{path::Path, sync::Arc};
use tauri::{ipc::Channel, AppHandle, Runtime, State};

/// Find playable tracks across the whole library, including covers lost since generation.
pub(super) fn missing(db: &Database) -> Result<Vec<(String, String)>> {
    let dir = db.settings()?.songs_dir;
    let root = Path::new(&dir);
    let candidates = {
        let con = db.lock();
        let mut stmt = con.prepare(
            "SELECT id, COALESCE(NULLIF(title,''),NULLIF(caption,''),id), file,
                COALESCE(json_type(result_meta,'$.cover_art')='object',0)
             FROM songs WHERE status='done' AND output_kind='audio' AND audio_missing=0 AND file IS NOT NULL
             ORDER BY created_at DESC,rowid DESC"
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get(1)?,
                r.get::<_, String>(2)?,
                r.get(3)?,
            ))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    Ok(candidates
        .into_iter()
        .filter_map(|(id, label, file, generated)| {
            (filename(&id).is_some()
                && output_path(root, &id, generated).is_none()
                && safe_song_path(root, &file).is_ok_and(|path| path.is_file()))
            .then_some((id, label))
        })
        .collect())
}

#[derive(Clone, Default, Serialize)]
pub struct BatchProgress {
    total: usize,
    processed: usize,
    failed: usize,
    last_failure: Option<(String, String)>,
}

async fn candidates(db: Arc<Database>) -> Result<Vec<(String, String)>> {
    tokio::task::spawn_blocking(move || missing(&db))
        .await
        .map_err(|error| message(error.to_string()))?
}

#[tauri::command]
pub async fn missing_cover_count(state: State<'_, Arc<AppState>>) -> Result<usize> {
    Ok(candidates(state.db.clone()).await?.len())
}

#[tauri::command]
pub async fn generate_missing_covers<R: Runtime>(
    state: State<'_, Arc<AppState>>,
    app: AppHandle<R>,
    progress: Channel<BatchProgress>,
) -> Result<BatchProgress> {
    let operation = Arc::new(state.runtime.try_begin(OperationKind::CoverArtBatch)?);
    if !super::installed(&state.db.root, &state.resources) {
        return Err(message("cover_art_install_required"));
    }
    let songs = candidates(state.db.clone()).await?;
    let mut status = BatchProgress {
        total: songs.len(),
        ..Default::default()
    };
    let cancel = operation.cancellation();
    let _awake = crate::power::KeepAwake::new();
    state.changed(&app);
    let _ = progress.send(status.clone());
    for (id, label) in songs {
        if cancel.is_cancelled() {
            break;
        }
        match render_existing(&state, &id, &operation).await {
            Ok(()) => (),
            Err(Error::Cancelled) => break,
            Err(error) => {
                status.failed += 1;
                status.last_failure = Some((label, error.to_string()));
            }
        }
        status.processed += 1;
        let _ = progress.send(status.clone());
        state.changed(&app);
    }
    drop(operation);
    state.changed(&app);
    Ok(status)
}

#[tauri::command]
pub fn cancel_missing_covers(state: State<'_, Arc<AppState>>) {
    state.runtime.cancel_cover_art(None);
}
