use crate::{
    db::Database,
    error::{message, Result},
};
use rusqlite::OptionalExtension;
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
};

mod staging;

impl Database {
    pub fn export_default_path(&self, filename: &str, fallback: &Path) -> Result<PathBuf> {
        let stored: Option<String> = self
            .lock()
            .query_row(
                "SELECT value FROM settings WHERE key='last_export_dir'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        let directory = stored
            .and_then(|value| serde_json::from_str::<PathBuf>(&value).ok())
            .filter(|path| {
                path.is_absolute()
                    && match std::fs::metadata(path) {
                        Ok(metadata) => metadata.is_dir(),
                        // The native save panel can revisit a directory without a live file grant.
                        Err(error) => error.kind() == std::io::ErrorKind::PermissionDenied,
                    }
            });
        let filename: String = filename
            .chars()
            .map(|ch| {
                if ch.is_control() || "\\/:*?\"<>|".contains(ch) {
                    '_'
                } else {
                    ch
                }
            })
            .collect();
        let filename = if matches!(filename.trim(), "" | "." | "..") {
            "Song"
        } else {
            &filename
        };
        Ok(directory.as_deref().unwrap_or(fallback).join(filename))
    }

    pub(crate) fn remember_export_directory(&self, directory: &Path) -> Result<()> {
        self.lock().execute(
            "INSERT INTO settings(key,value) VALUES('last_export_dir',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            [serde_json::to_string(directory)?],
        )?;
        Ok(())
    }

    pub fn export_audio(&self, sid: &str, destination: &Path) -> Result<()> {
        let song = self.song(sid)?;
        let path = song.path.ok_or_else(|| message("Song has no audio file"))?;
        if Path::new(&path).canonicalize()? == destination.canonicalize().unwrap_or_default() {
            return Err(message(
                "Choose a destination outside the source audio file",
            ));
        }
        std::fs::copy(path, destination)?;
        Ok(())
    }

    pub fn export_lyrics(&self, sid: &str, destination: &Path) -> Result<()> {
        let song = self.song(sid)?;
        let lyrics = song
            .result_meta
            .as_ref()
            .and_then(|m| m["lyrics"].as_str())
            .or(song.lyrics.as_deref())
            .unwrap_or("");
        std::fs::write(destination, lyrics)?;
        Ok(())
    }

    pub fn export_zip(&self, folder: &str, destination: &Path) -> Result<()> {
        self.export_zip_sources(folder, destination, &HashMap::new())
    }

    pub(crate) fn export_song_ids(&self, folder: &str) -> Result<Vec<String>> {
        // Export all matching rows, including songs outside the UI's display limit.
        let con = self.lock();
        let mut stmt = con.prepare("SELECT id FROM songs WHERE status='done' AND audio_missing=0 AND file IS NOT NULL AND (?1='' OR folder_id=?1 OR (?1='none' AND (folder_id IS NULL OR folder_id NOT IN (SELECT id FROM folders)))) ORDER BY created_at,rowid")?;
        let ids = stmt
            .query_map([folder], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        drop(stmt);
        drop(con);
        if ids.is_empty() {
            return Err(message("No finished songs to export"));
        }
        Ok(ids)
    }

    pub(crate) fn export_zip_sources(
        &self,
        folder: &str,
        destination: &Path,
        sources: &HashMap<String, PathBuf>,
    ) -> Result<()> {
        let ids = self.export_song_ids(folder)?;
        let temp = staging::StagedExport::new(destination)?;
        let mut zip = zip::ZipWriter::new(std::fs::File::create(temp.path())?);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        let mut names = HashSet::new();
        for sid in ids {
            let song = self.song(&sid)?;
            let Some(original) = song.path else {
                continue;
            };
            let path = sources
                .get(&sid)
                .cloned()
                .unwrap_or_else(|| PathBuf::from(original));
            let mut file = std::fs::File::open(&path)?;
            let title = clean_name(song.title.as_deref().unwrap_or(&song.caption));
            let base = format!(
                "{}{}",
                title,
                if song.letter.is_empty() {
                    String::new()
                } else {
                    format!(" {}", song.letter)
                }
            );
            let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("wav");
            let mut name = format!("{base}.{ext}");
            if !names.insert(name.to_lowercase()) {
                name = format!("{base}-{}.{ext}", song.id);
                names.insert(name.to_lowercase());
            }
            zip.start_file(name, options)
                .map_err(|e| message(e.to_string()))?;
            std::io::copy(&mut file, &mut zip)?;
        }
        zip.finish()
            .map_err(|e| message(e.to_string()))?
            .sync_all()?;
        temp.commit(destination)?;
        Ok(())
    }
}

pub async fn export(
    db: std::sync::Arc<Database>,
    resources: PathBuf,
    kind: String,
    sid: Option<String>,
    folder: Option<String>,
    destination: PathBuf,
    cancel: tokio_util::sync::CancellationToken,
) -> Result<()> {
    if !destination.is_absolute() {
        return Err(message("Select an absolute destination"));
    }
    if let Some(parent) = destination.parent() {
        if let Err(error) = db.remember_export_directory(parent) {
            tracing::warn!(%error, "Could not remember export directory");
        }
    }
    export_contents(db, resources, kind, sid, folder, destination, cancel).await
}

/// Export bytes without remembering a temporary staging directory as the user's destination.
pub(crate) async fn export_contents(
    db: std::sync::Arc<Database>,
    resources: PathBuf,
    kind: String,
    sid: Option<String>,
    folder: Option<String>,
    destination: PathBuf,
    cancel: tokio_util::sync::CancellationToken,
) -> Result<()> {
    if !destination.is_absolute() {
        return Err(message("Select an absolute destination"));
    }
    let mp3 = db.settings()?.export_format == "mp3";
    let mut sources = HashMap::new();
    if mp3 && (kind == "audio" || kind == "zip") {
        let ids = if kind == "audio" {
            vec![sid.clone().ok_or_else(|| message("Missing song"))?]
        } else {
            db.export_song_ids(folder.as_deref().unwrap_or(""))?
        };
        for id in ids {
            let song = db.song(&id)?;
            let path = song.path.ok_or_else(|| message("Song has no audio file"))?;
            if std::path::Path::new(&path).canonicalize()?
                == destination.canonicalize().unwrap_or_default()
            {
                return Err(message(
                    "Choose a destination outside the source audio file",
                ));
            }
            sources.insert(
                id.clone(),
                crate::audio_export::mp3(&resources, &db.root, &id, Path::new(&path), &cancel)
                    .await?,
            );
        }
    }
    if cancel.is_cancelled() {
        return Err(crate::error::Error::Cancelled);
    }
    tauri::async_runtime::spawn_blocking(move || match kind.as_str() {
        "audio" => {
            let sid = sid.as_deref().ok_or_else(|| message("Missing song"))?;
            if let Some(source) = sources.get(sid) {
                std::fs::copy(source, destination)?;
                Ok(())
            } else {
                db.export_audio(sid, &destination)
            }
        }
        "lyrics" => db.export_lyrics(
            sid.as_deref().ok_or_else(|| message("Missing song"))?,
            &destination,
        ),
        "zip" => db.export_zip_sources(folder.as_deref().unwrap_or(""), &destination, &sources),
        _ => Err(message("Unknown export format")),
    })
    .await
    .map_err(|e| message(e.to_string()))?
}

pub fn clean_name(name: &str) -> String {
    let clean: String = name
        .chars()
        .filter(|c| c.is_alphanumeric() || [' ', '-', '_'].contains(c))
        .take(80)
        .collect();
    if clean.trim().is_empty() {
        "Song".into()
    } else {
        clean.trim().into()
    }
}
