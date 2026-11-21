use super::{engine, managed_dir};
use crate::{
    audio_import::AUDIO_EXTENSIONS,
    error::{message, Error, Result},
    state::AppState,
    types::id,
    verification::hash_file_with_progress,
};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Deserialize, Serialize)]
pub struct AudioInfo {
    pub rate: u32,
    pub frames: u64,
    pub channels: u32,
    pub peaks: Vec<f32>,
}

impl AudioInfo {
    pub fn seconds(&self) -> f64 {
        self.frames as f64 / f64::from(self.rate)
    }
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Source {
    pub id: String,
    pub song_id: Option<String>,
    pub name: String,
    pub hash: String,
    pub extension: String,
    pub decoded: bool,
    pub audio: AudioInfo,
}

impl Source {
    fn folder(&self, root: &Path) -> Result<PathBuf> {
        managed_dir(root, "sources", &self.id)
    }

    pub fn original(&self, root: &Path) -> Result<PathBuf> {
        if !AUDIO_EXTENSIONS.contains(&self.extension.as_str()) {
            return Err(message("audio_type"));
        }
        super::file(&self.folder(root)?, &format!("source.{}", self.extension))
    }

    pub fn audio_path(&self, root: &Path) -> Result<PathBuf> {
        if self.decoded {
            super::file(&self.folder(root)?, "decoded.wav")
        } else {
            self.original(root)
        }
    }
}

pub fn get(state: &AppState, id: &str) -> Result<Source> {
    let json: String = state
        .db
        .lock()
        .query_row("SELECT data FROM stem_sources WHERE id=?1", [id], |row| {
            row.get(0)
        })
        .optional()?
        .ok_or_else(|| message("stem_source_missing"))?;
    Ok(serde_json::from_str(&json)?)
}

pub async fn song(state: &AppState, song_id: &str) -> Result<Source> {
    let song = state.db.song(song_id)?;
    let path = song
        .audio_path()
        .map(Path::new)
        .ok_or_else(|| message("stem_source_missing"))?;
    let name = song
        .title
        .as_deref()
        .filter(|title| !title.trim().is_empty())
        .unwrap_or(&song.caption);
    snapshot(
        state,
        path,
        name,
        Some(song_id),
        &state.runtime.cancellation(),
    )
    .await
}

/// Copy the original bytes under a managed identity before decoding or enqueueing.
pub async fn snapshot(
    state: &AppState,
    input: &Path,
    name: &str,
    song_id: Option<&str>,
    cancel: &CancellationToken,
) -> Result<Source> {
    if !engine::installed(state) {
        return Err(message("stem_engine_missing"));
    }
    let extension = input
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !AUDIO_EXTENSIONS.contains(&extension.as_str()) {
        return Err(message("audio_type"));
    }
    let metadata = tokio::fs::metadata(input).await?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err(message("audio_read"));
    }
    if song_id.is_none() && metadata.len() > crate::audio_import::MAX_AUDIO_BYTES as u64 {
        return Err(message("audio_size"));
    }
    let source_id = id();
    let target = managed_dir(&state.db.root, "sources", &source_id)?;
    let parent = target.parent().expect("source parent");
    std::fs::create_dir_all(parent)?;
    crate::download::ensure_space(parent, metadata.len())?;
    let staging = tempfile::Builder::new()
        .prefix(".source-")
        .tempdir_in(parent)?;
    let path = staging.path().join(format!("source.{extension}"));
    tokio::select! {
        _ = cancel.cancelled() => return Err(Error::Cancelled),
        copied = tokio::fs::copy(input, &path) => { copied?; }
    }
    let hash = hash_file_with_progress(&path, cancel, |_, _| {}).await?;
    if let Some(song_id) = song_id {
        let prior: Option<String> = state.db.lock().query_row(
            "SELECT data FROM stem_sources WHERE song_id=?1 AND json_extract(data,'$.hash')=?2 LIMIT 1",
            params![song_id, hash], |row| row.get(0),
        ).optional()?;
        if let Some(prior) = prior {
            let source: Source = serde_json::from_str(&prior)?;
            if source.audio_path(&state.db.root).is_ok() {
                return Ok(source);
            }
        }
    }
    let decoded_path = staging.path().join("decoded.wav");
    let (audio, decoded) = match inspect(state, &path, cancel).await {
        Ok(info) => (info, false),
        Err(Error::Cancelled) => return Err(Error::Cancelled),
        Err(_) if extension == "m4a" => {
            crate::audio_export::decode_float(&state.db.root, &path, &decoded_path, cancel).await?;
            (inspect(state, &decoded_path, cancel).await?, true)
        }
        Err(error) => return Err(error),
    };
    let source = Source {
        id: source_id,
        song_id: song_id.map(str::to_owned),
        name: name.chars().take(180).collect(),
        hash,
        extension,
        decoded,
        audio,
    };
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    let data = serde_json::to_string(&source)?;
    std::fs::rename(staging.path(), &target)?;
    let result = state.db.lock().execute(
        "INSERT INTO stem_sources(id,song_id,data) VALUES(?1,?2,?3)",
        params![source.id, source.song_id, data],
    );
    if result.is_err() {
        let _ = std::fs::remove_dir_all(target);
    }
    result?;
    Ok(source)
}

async fn inspect(state: &AppState, path: &Path, cancel: &CancellationToken) -> Result<AudioInfo> {
    let info = Mutex::new(None);
    engine::execute(
        state,
        "inspect",
        &[path.as_os_str().to_owned()],
        cancel,
        Duration::from_secs(60),
        |value| *info.lock().unwrap() = serde_json::from_value::<AudioInfo>(value).ok(),
        "stem_source_decode",
    )
    .await?;
    info.into_inner()
        .unwrap()
        .filter(|info| {
            info.frames > 0
                && (8000..=192000).contains(&info.rate)
                && matches!(info.channels, 1 | 2)
        })
        .ok_or_else(|| message("stem_source_decode"))
}

pub async fn upload(state: &AppState, name: &str, data: Vec<u8>) -> Result<Source> {
    if data.len() > crate::audio_import::MAX_AUDIO_BYTES {
        return Err(message("audio_size"));
    }
    let decoded = Path::new(name);
    let extension = decoded
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !AUDIO_EXTENSIONS.contains(&extension.as_str()) {
        return Err(message("audio_type"));
    }
    let directory = tempfile::tempdir_in(&state.db.root)?;
    let file = directory.path().join(format!("upload.{extension}"));
    tokio::fs::write(&file, data).await?;
    let name = decoded
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Audio");
    snapshot(state, &file, name, None, &state.runtime.cancellation()).await
}

pub async fn relink(state: &AppState, id: &str, replacement: &Path) -> Result<()> {
    let operation = state
        .runtime
        .try_begin(crate::runtime::OperationKind::Import)?;
    let cancel = operation.cancellation();
    let saved = get(state, id)?;
    let folder = saved.folder(&state.db.root)?;
    let parent = folder.parent().expect("source folder");
    std::fs::create_dir_all(parent)?;
    let staging = tempfile::Builder::new()
        .prefix(".source-")
        .tempdir_in(parent)?;
    let name = format!("source.{}", saved.extension);
    let new = staging.path().join(&name);
    crate::download::ensure_space(parent, replacement.metadata()?.len())?;
    tokio::select! {
        _ = cancel.cancelled() => return Err(Error::Cancelled),
        copied = tokio::fs::copy(replacement, &new) => { copied?; }
    }
    if hash_file_with_progress(&new, &cancel, |_, _| {}).await? != saved.hash {
        return Err(message("stem_source_hash_mismatch"));
    }
    if saved.decoded {
        crate::audio_export::decode_float(
            &state.db.root,
            &new,
            &staging.path().join("decoded.wav"),
            &cancel,
        )
        .await?;
    }
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    if !folder.exists() {
        std::fs::rename(staging.path(), &folder)?;
    } else {
        // Preserve the source ID and only replace files proven to belong to it.
        for item in std::fs::read_dir(staging.path())? {
            let item = item?;
            let mut temporary = tempfile::NamedTempFile::new_in(&folder)?;
            std::io::copy(&mut std::fs::File::open(item.path())?, &mut temporary)?;
            temporary.as_file().sync_all()?;
            temporary
                .persist(folder.join(item.file_name()))
                .map_err(|error| error.error)?;
        }
    }
    Ok(())
}
