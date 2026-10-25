use crate::{
    db::Database,
    error::{message, Result},
    types::id,
};
use rusqlite::{
    backup::{Backup, StepResult},
    Connection, OpenFlags,
};
use std::{
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;

// Own the temporary database until all SQLite connections have been dropped.
pub(super) struct Staging(pub PathBuf);
impl Drop for Staging {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

pub(super) struct Source {
    pub db: Database,
    pub songs: PathBuf,
    pub _staging: Staging,
}

/// Resolve only the chosen project or data directory; never search outside its grant.
pub(super) fn database_path(root: &Path) -> std::io::Result<PathBuf> {
    for path in [root.join("music.db"), root.join("data/music.db")] {
        match std::fs::metadata(&path) {
            Ok(meta) if meta.is_file() => return Ok(path),
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    Err(std::io::ErrorKind::NotFound.into())
}

impl Source {
    /// Back up a read-only source, including committed WAL data, and migrate only the copy.
    pub fn open(
        db: &Database,
        source: &Path,
        songs_override: Option<&str>,
        cancel: &CancellationToken,
    ) -> Result<Self> {
        let old = Connection::open_with_flags(source, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        old.busy_timeout(Duration::from_secs(3))?;
        // Reject unrelated SQLite files before migrations can create missing application tables.
        old.prepare("SELECT id,group_id,created_at,finished_at,status,message,title,caption,lyrics,seed,params,result_meta,engine,file,favorite FROM songs LIMIT 0")?;
        old.prepare("SELECT id,name,created_at FROM folders LIMIT 0")?;
        old.prepare("SELECT key,value FROM settings LIMIT 0")?;
        let staging = Staging(db.root.join(format!("import-{}", id())));
        std::fs::create_dir_all(&staging.0)?;
        {
            let mut copy = Connection::open(staging.0.join("music.db"))?;
            let backup = Backup::new(&old, &mut copy)?;
            let started = Instant::now();
            loop {
                if cancel.is_cancelled() {
                    return Err(crate::error::Error::Cancelled);
                }
                match backup.step(100)? {
                    StepResult::Done => break,
                    StepResult::More => {}
                    _ if started.elapsed() > Duration::from_secs(5) => {
                        return Err(message("import_source_busy"))
                    }
                    _ => std::thread::sleep(Duration::from_millis(10)),
                }
            }
        }
        let snapshot = Database::open(&staging.0)?;
        let custom: Option<String> = snapshot
            .lock()
            .query_row(
                "SELECT value FROM settings WHERE key='songs_dir'",
                [],
                |r| r.get::<_, String>(0),
            )
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok());
        let songs = songs_override
            .filter(|s| !s.is_empty())
            .map(PathBuf::from)
            .or_else(|| custom.filter(|s| !s.is_empty()).map(PathBuf::from))
            .unwrap_or_else(|| source.parent().unwrap().join("songs"));
        if !songs.is_absolute() {
            return Err(message("import_invalid_data"));
        }
        {
            let con = snapshot.lock();
            for table in ["songs", "folders"] {
                let mut statement = con.prepare(&format!("SELECT id FROM {table}"))?;
                for value in statement.query_map([], |r| r.get::<_, String>(0))? {
                    let value = value?;
                    if value.is_empty()
                        || !value
                            .chars()
                            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
                    {
                        return Err(message("import_invalid_data"));
                    }
                }
            }
            let mut statement = con.prepare("SELECT params,result_meta FROM songs")?;
            for row in statement.query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
            })? {
                let (params, metadata) = row?;
                if !serde_json::from_str::<serde_json::Value>(&params)?.is_object()
                    || metadata
                        .as_deref()
                        .map(serde_json::from_str::<serde_json::Value>)
                        .transpose()?
                        .is_some_and(|v| !v.is_object())
                {
                    return Err(message("import_invalid_data"));
                }
            }
        }
        Ok(Self {
            db: snapshot,
            songs,
            _staging: staging,
        })
    }
}
