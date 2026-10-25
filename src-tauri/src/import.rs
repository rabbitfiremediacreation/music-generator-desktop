use crate::{
    db::{safe_song_path, Database},
    error::{message, Error, Result},
};
use std::{
    collections::HashSet,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tokio_util::sync::CancellationToken;

mod destination;
mod move_preview;
mod preview;
mod source;
mod types;
pub use move_preview::preview_move;
pub use preview::preview;
pub use types::*;

#[derive(Default)]
struct Copies {
    paths: Vec<PathBuf>,
    committed: bool,
}
impl Drop for Copies {
    fn drop(&mut self) {
        if !self.committed {
            for path in &self.paths {
                let _ = std::fs::remove_file(path);
            }
        }
    }
}

/// Recheck the source snapshot and target, copy exclusively, then commit metadata and target together.
pub fn import_library(
    db: &Database,
    request: &ImportRequest,
    cancel: &CancellationToken,
    progress: impl Fn(ImportProgress),
) -> Result<ImportResult> {
    if !preview::empty(db)? {
        return Err(message("import_library_not_empty"));
    }
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    if !Path::new(&request.root).is_absolute() {
        return Err(message("import_invalid_path"));
    }
    progress(ImportProgress {
        phase: "checking",
        copied_bytes: 0,
        total_bytes: 0,
        files: 0,
        total_files: 0,
    });
    let path = source::database_path(Path::new(&request.root))?;
    let source = source::Source::open(db, &path, request.songs_source.as_deref(), cancel)?;
    let checked = preview::inspect(&source, request)?;
    if !checked.can_import {
        return Err(message(format!(
            "import_{}",
            checked
                .issues
                .first()
                .map(|i| i.code.as_str())
                .unwrap_or("partial_required")
        )));
    }
    let missing: HashSet<_> = checked.missing.iter().map(|m| m.id.as_str()).collect();
    {
        let con = source.db.lock();
        for id in &missing {
            con.execute("UPDATE songs SET audio_missing=1,status=CASE WHEN status IN ('queued','running') THEN 'cancelled' ELSE status END WHERE id=?1", [id])?;
        }
    }
    let names = source.db.audio_files()?;
    let dest = Path::new(&request.songs_dir);
    std::fs::create_dir_all(dest)?;
    let mut copies = Copies::default();
    let mut update = ImportProgress {
        phase: "copying",
        copied_bytes: 0,
        total_bytes: checked.bytes,
        files: 0,
        total_files: names.len(),
    };
    progress(update.clone());
    let mut buffer = vec![0u8; 1024 * 1024];
    for name in &names {
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        let to = safe_song_path(dest, name)?;
        let mut output = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&to)?;
        copies.paths.push(to);
        let mut input = std::fs::File::open(safe_song_path(&source.songs, name)?)?;
        loop {
            if cancel.is_cancelled() {
                return Err(Error::Cancelled);
            }
            let read = input.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            output.write_all(&buffer[..read])?;
            update.copied_bytes += read as u64;
            progress(update.clone());
        }
        output.sync_all()?;
        update.files += 1;
        progress(update.clone());
    }
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    update.phase = "committing";
    progress(update.clone());
    let mut con = db.lock();
    con.execute(
        "ATTACH DATABASE ?1 AS legacy",
        [source
            ._staging
            .0
            .join("music.db")
            .to_string_lossy()
            .as_ref()],
    )?;
    let imported = (|| -> Result<usize> {
        let tx = con.transaction()?;
        // The runtime gate excludes app writers; check again for non-app database writers.
        if tx.query_row(
            "SELECT (SELECT COUNT(*) FROM songs)+(SELECT COUNT(*) FROM folders)",
            [],
            |r| r.get::<_, u64>(0),
        )? != 0
        {
            return Err(message("import_library_not_empty"));
        }
        let count = tx.execute("INSERT INTO songs(id,group_id,created_at,finished_at,status,message,title,caption,lyrics,seed,params,result_meta,engine,file,favorite,folder_id,started_at,audio_missing) SELECT id,group_id,created_at,finished_at,status,message,title,caption,lyrics,seed,params,result_meta,engine,file,favorite,folder_id,started_at,audio_missing FROM legacy.songs ORDER BY rowid", [])?;
        tx.execute(
            "INSERT INTO folders SELECT id,name,created_at FROM legacy.folders",
            [],
        )?;
        tx.execute("INSERT INTO settings(key,value) VALUES('songs_dir',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [serde_json::to_string(&request.songs_dir)?])?;
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        tx.commit()?;
        Ok(count)
    })();
    // Once committed, a detach error must never delete successfully imported audio.
    if imported.is_ok() {
        copies.committed = true;
    }
    let detached = con.execute_batch("DETACH DATABASE legacy");
    let count = imported?;
    if let Err(error) = detached {
        tracing::warn!(%error, "Could not detach committed import snapshot");
    }
    Ok(ImportResult {
        songs: count,
        files: update.files,
        songs_dir: request.songs_dir.clone(),
        missing: checked.missing,
    })
}

/// Compatibility entry point for existing callers; new UI always supplies an explicit target.
pub fn import_legacy(db: &Database, root: &Path) -> Result<serde_json::Value> {
    let result = import_library(
        db,
        &ImportRequest {
            root: root.to_string_lossy().into(),
            songs_source: None,
            songs_dir: db.settings()?.songs_dir,
            allow_partial: false,
        },
        &CancellationToken::new(),
        |_| {},
    )?;
    let direct = root.join("music.db").is_file();
    let models = if direct {
        let con = rusqlite::Connection::open_with_flags(
            root.join("music.db"),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )?;
        con.query_row(
            "SELECT value FROM settings WHERE key='models_dir'",
            [],
            |r| r.get::<_, String>(0),
        )
        .ok()
        .and_then(|s| serde_json::from_str::<String>(&s).ok())
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| root.join("models"))
    } else {
        root.join("engine/acestep.cpp/models")
    };
    Ok(serde_json::json!({"songs": result.songs,"models_dir": models}))
}
