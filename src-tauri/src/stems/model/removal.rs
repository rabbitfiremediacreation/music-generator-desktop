use super::{get, installed_file, Pin};
use crate::{
    error::{message, Result},
    state::AppState,
};
use rusqlite::params;
use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
pub struct Removal {
    pub bytes: u64,
    pub files: Vec<RemovalFile>,
    pub busy: bool,
}

#[derive(Serialize)]
pub struct RemovalFile {
    pub file: String,
    pub bytes: u64,
    pub shared: bool,
}

pub fn removal(state: &AppState, pin: &Pin) -> Result<Removal> {
    let profile = get(&pin.model)?;
    let artifact = installed_file(state, pin)?.ok_or_else(|| message("stem_model_missing"))?;
    let models = state.db.settings()?.models_dir;
    let con = state.db.lock();
    let shared: bool = con.query_row(
        "SELECT EXISTS(SELECT 1 FROM stem_models WHERE json_extract(artifact,'$.sha256')=?4
           AND json_extract(artifact,'$.file')=?5 AND NOT(model=?1 AND repository=?2 AND revision=?3)
         UNION ALL SELECT 1 FROM stem_model_transfers WHERE json_extract(artifact,'$.sha256')=?4
           AND json_extract(artifact,'$.file')=?5)",
        params![pin.model,pin.repository,pin.revision,artifact.sha256,artifact.file], |r| r.get(0),
    )?;
    let busy: bool = con.query_row(
        "SELECT EXISTS(SELECT 1 FROM stem_jobs WHERE status IN ('queued','running') AND
         json_extract(request,'$.pin.model')=?1 AND json_extract(request,'$.pin.repository')=?2
         AND json_extract(request,'$.pin.revision')=?3)",
        params![pin.model, pin.repository, pin.revision],
        |r| r.get(0),
    )?;
    let shared_config: bool = con.query_row(
        "SELECT EXISTS(SELECT 1 FROM stem_models WHERE model=?1 AND NOT(repository=?2 AND revision=?3)
         UNION ALL SELECT 1 FROM stem_model_transfers WHERE model=?1)",
        params![pin.model,pin.repository,pin.revision], |r| r.get(0),
    )?;
    let mut files = Vec::new();
    for (file, shared) in profile
        .files(&artifact)
        .into_iter()
        .zip([shared_config, shared])
    {
        let path = file.checked_path(Path::new(&models))?;
        files.push(RemovalFile {
            bytes: if shared {
                0
            } else {
                path.metadata().map_or(0, |metadata| metadata.len())
            },
            file: path.to_string_lossy().into(),
            shared,
        });
    }
    Ok(Removal {
        bytes: files.iter().map(|file| file.bytes).sum(),
        files,
        busy,
    })
}

pub fn remove(state: &AppState, pin: &Pin) -> Result<()> {
    let impact = removal(state, pin)?;
    if impact.busy {
        return Err(message("stem_model_in_use"));
    }
    let mut con = state.db.lock();
    let tx = con.transaction()?;
    let was_active: bool = tx.query_row(
        "SELECT active FROM stem_models WHERE model=?1 AND repository=?2 AND revision=?3",
        params![pin.model, pin.repository, pin.revision],
        |row| row.get(0),
    )?;
    tx.execute(
        "DELETE FROM stem_models WHERE model=?1 AND repository=?2 AND revision=?3",
        params![pin.model, pin.repository, pin.revision],
    )?;
    if was_active {
        tx.execute("UPDATE stem_models SET active=1 WHERE rowid=(SELECT rowid FROM stem_models WHERE model=?1 ORDER BY installed_at DESC LIMIT 1)", [&pin.model])?;
    }
    let mut moved = Vec::new();
    let result: Result<()> = (|| {
        for file in impact.files.iter().filter(|file| !file.shared) {
            let path = Path::new(&file.file);
            if !path.is_file() {
                continue;
            }
            let tombstone = tempfile::Builder::new()
                .prefix(".remove-")
                .tempdir_in(path.parent().expect("artifact folder"))?;
            std::fs::rename(path, tombstone.path().join("artifact"))?;
            moved.push((tombstone, path));
        }
        tx.commit()?;
        Ok(())
    })();
    if result.is_err() {
        for (tombstone, path) in moved {
            if std::fs::rename(tombstone.path().join("artifact"), path).is_err() {
                let _ = tombstone.keep();
            }
        }
    }
    result?;
    Ok(())
}
