use super::{
    destination::target,
    source::{database_path, Source},
    ImportPreview, ImportRequest, MissingAudio,
};
use crate::{
    db::{safe_song_path, Database},
    error::Result,
};
use std::{collections::HashSet, path::Path};
use tokio_util::sync::CancellationToken;

/// Inspect a source snapshot without treating denied access as a missing audio file.
pub fn preview(db: &Database, request: &ImportRequest) -> Result<ImportPreview> {
    let mut preview = ImportPreview::default();
    if !empty(db)? {
        preview.issue("library_not_empty", &request.root);
        return Ok(preview);
    }
    let root = Path::new(&request.root);
    if !root.is_absolute() {
        preview.issue("invalid_path", root);
        return Ok(preview);
    }
    let path = match database_path(root) {
        Ok(path) => path,
        Err(e) => {
            let code = if e.kind() == std::io::ErrorKind::PermissionDenied {
                "source_access"
            } else if e.kind() == std::io::ErrorKind::NotFound
                && root.file_name().is_some_and(|n| n == "songs")
            {
                "select_project"
            } else {
                "source_missing"
            };
            preview.issue(code, root);
            return Ok(preview);
        }
    };
    if std::fs::File::open(&path).is_err() {
        preview.issue("source_access", &path);
        return Ok(preview);
    }
    match Source::open(
        db,
        &path,
        request.songs_source.as_deref(),
        &CancellationToken::new(),
    ) {
        Ok(source) => inspect(&source, request),
        Err(e) => {
            let code = match e {
                crate::error::Error::Io(ref error)
                    if error.kind() == std::io::ErrorKind::PermissionDenied =>
                {
                    "source_access"
                }
                crate::error::Error::Message(ref message) if message == "import_source_busy" => {
                    "source_busy"
                }
                _ => "invalid_data",
            };
            preview.issue(code, path);
            Ok(preview)
        }
    }
}

pub(super) fn empty(db: &Database) -> Result<bool> {
    Ok(db.lock().query_row(
        "SELECT (SELECT COUNT(*) FROM songs)+(SELECT COUNT(*) FROM folders)",
        [],
        |r| r.get::<_, u64>(0),
    )? == 0)
}

pub(super) fn inspect(source: &Source, request: &ImportRequest) -> Result<ImportPreview> {
    let con = source.db.lock();
    let mut preview = ImportPreview {
        songs: con.query_row("SELECT COUNT(*) FROM songs", [], |r| r.get(0))?,
        folders: con.query_row("SELECT COUNT(*) FROM folders", [], |r| r.get(0))?,
        songs_source: source.songs.to_string_lossy().into(),
        ..Default::default()
    };
    let mut stmt =
        con.prepare("SELECT id,COALESCE(title,caption),file,audio_missing,status FROM songs")?;
    let mut names = HashSet::new();
    let audio = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, Option<String>>(2)?,
            r.get::<_, bool>(3)?,
            r.get::<_, String>(4)?,
        ))
    })?;
    if let Err(e) = std::fs::read_dir(&source.songs) {
        if e.kind() != std::io::ErrorKind::NotFound {
            preview.issue("songs_access", &source.songs);
        }
    }
    for row in audio {
        let (id, title, file, marked_missing, status) = row?;
        let Some(name) = file.as_deref() else {
            if status == "done" || marked_missing {
                preview.missing.push(MissingAudio { id, title, file });
            }
            continue;
        };
        let path = match safe_song_path(&source.songs, name) {
            Ok(path) => path,
            Err(_) => {
                preview.issue("invalid_data", &source.songs);
                continue;
            }
        };
        if marked_missing {
            preview.missing.push(MissingAudio { id, title, file });
            continue;
        }
        match std::fs::File::open(&path).and_then(|file| file.metadata()) {
            Ok(meta) if meta.is_file() => {
                if names.insert(name.to_string()) {
                    preview.files += 1;
                    preview.bytes = preview.bytes.saturating_add(meta.len());
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                preview.missing.push(MissingAudio { id, title, file })
            }
            _ => preview.issue("songs_access", path),
        }
    }
    target(
        &mut preview,
        Path::new(&request.songs_dir),
        &source.songs,
        names.iter().map(String::as_str),
    );
    preview.can_import =
        preview.issues.is_empty() && (preview.missing.is_empty() || request.allow_partial);
    Ok(preview)
}
