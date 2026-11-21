use crate::{
    audio_export::{self, AudioFormat},
    db::Database,
    error::{message, Result},
    types::OutputKind,
};
use rusqlite::OptionalExtension;
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
};

mod staging;

pub(crate) enum ExportSelection {
    Audio(Option<AudioFormat>),
    Zip(Option<AudioFormat>),
    Lyrics,
    Midi,
}

impl ExportSelection {
    pub(crate) fn parse(kind: &str, format: Option<AudioFormat>) -> Result<Self> {
        match (kind, format) {
            ("audio", format) => Ok(Self::Audio(format)),
            ("zip", format) => Ok(Self::Zip(format)),
            ("midi", None) => Ok(Self::Midi),
            ("lyrics", None) => Ok(Self::Lyrics),
            _ => Err(message("Unknown export format")),
        }
    }
}

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
        let path = song
            .audio_path()
            .ok_or_else(|| message("Song has no audio file"))?;
        if Path::new(path).canonicalize()? == destination.canonicalize().unwrap_or_default() {
            return Err(message(
                "Choose a destination outside the source audio file",
            ));
        }
        std::fs::copy(path, destination)?;
        Ok(())
    }

    pub fn export_midi(&self, sid: &str, destination: &Path) -> Result<()> {
        if !destination
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("mid"))
        {
            return Err(message("Destination must have the .mid extension"));
        }
        if destination.is_dir() {
            return Err(message("Export destination is a directory"));
        }
        let song = self.song(sid)?;
        let path = song
            .path
            .filter(|_| song.output_kind == OutputKind::Midi && song.status == "done")
            .ok_or_else(|| message("Song has no MIDI file"))?;
        if Path::new(&path).canonicalize()? == destination.canonicalize().unwrap_or_default() {
            return Err(message("Choose a destination outside the source MIDI file"));
        }
        let temp = staging::StagedExport::new(destination)?;
        std::fs::copy(path, temp.path())?;
        temp.commit(destination)
    }

    pub fn export_lyrics(&self, sid: &str, destination: &Path) -> Result<()> {
        let song = self.song(sid)?;
        if !song.output_kind.is_audio() {
            return Err(message("Song has no lyrics"));
        }
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
    export_selected(
        db,
        resources,
        ExportSelection::parse(&kind, None)?,
        sid,
        folder,
        destination,
        cancel,
    )
    .await
}

pub(crate) async fn export_selected(
    db: std::sync::Arc<Database>,
    resources: PathBuf,
    selection: ExportSelection,
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
    export_contents(db, resources, selection, sid, folder, destination, cancel).await
}

/// Export bytes without remembering a temporary staging directory as the user's destination.
pub(crate) async fn export_contents(
    db: std::sync::Arc<Database>,
    resources: PathBuf,
    selection: ExportSelection,
    sid: Option<String>,
    folder: Option<String>,
    destination: PathBuf,
    cancel: tokio_util::sync::CancellationToken,
) -> Result<()> {
    if !destination.is_absolute() {
        return Err(message("Select an absolute destination"));
    }
    if matches!(selection, ExportSelection::Audio(_)) && destination.is_dir() {
        return Err(message("Export destination is a directory"));
    }
    let mut sources = HashMap::new();
    if let ExportSelection::Audio(format) | ExportSelection::Zip(format) = selection {
        let explicit = format.is_some();
        let format = match format {
            Some(format) => format,
            None => audio_export::legacy_format(&db.settings()?.export_format),
        };
        let ids = if matches!(selection, ExportSelection::Audio(_)) {
            vec![sid.clone().ok_or_else(|| message("Missing song"))?]
        } else if format == AudioFormat::Original {
            Vec::new()
        } else {
            db.export_song_ids(folder.as_deref().unwrap_or(""))?
        };
        for id in ids {
            let song = db.song(&id)?;
            if matches!(selection, ExportSelection::Zip(_)) && !song.output_kind.is_audio() {
                continue;
            }
            let path = song
                .audio_path()
                .filter(|_| song.status == "done")
                .ok_or_else(|| message("Song has no audio file"))?;
            let path = Path::new(path);
            if path.canonicalize()? == destination.canonicalize().unwrap_or_default() {
                return Err(message(
                    "Choose a destination outside the source audio file",
                ));
            }
            let source = if !explicit && format == AudioFormat::Mp3 {
                audio_export::mp3(&resources, &db.root, &id, path, &cancel).await?
            } else {
                audio_export::convert(&resources, &db.root, &id, path, format, &cancel).await?
            };
            if explicit && matches!(selection, ExportSelection::Audio(_)) {
                let extension = source.extension().and_then(|value| value.to_str());
                if !extension
                    .zip(destination.extension().and_then(|value| value.to_str()))
                    .is_some_and(|(actual, requested)| requested.eq_ignore_ascii_case(actual))
                {
                    return Err(message("audio_export_extension_mismatch"));
                }
            }
            sources.insert(id, source);
        }
    }
    if cancel.is_cancelled() {
        return Err(crate::error::Error::Cancelled);
    }
    tauri::async_runtime::spawn_blocking(move || match selection {
        ExportSelection::Audio(_) => {
            let sid = sid.as_deref().ok_or_else(|| message("Missing song"))?;
            if let Some(source) = sources.get(sid) {
                let temp = staging::StagedExport::new(&destination)?;
                std::fs::copy(source, temp.path())?;
                if cancel.is_cancelled() {
                    return Err(crate::error::Error::Cancelled);
                }
                temp.commit(&destination)
            } else {
                db.export_audio(sid, &destination)
            }
        }
        ExportSelection::Lyrics => db.export_lyrics(
            sid.as_deref().ok_or_else(|| message("Missing song"))?,
            &destination,
        ),
        ExportSelection::Midi => db.export_midi(
            sid.as_deref().ok_or_else(|| message("Missing song"))?,
            &destination,
        ),
        ExportSelection::Zip(_) => {
            db.export_zip_sources(folder.as_deref().unwrap_or(""), &destination, &sources)
        }
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
