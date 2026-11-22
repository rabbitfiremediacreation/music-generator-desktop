//! Local source separation, immutable audio projects, and non-destructive mixes.
pub mod desktop;
mod dsp;
mod engine;
pub mod export;
pub mod jobs;
pub mod layer;
pub mod mix;
pub mod model;
mod model_layer;
mod removal;
mod resample;
pub mod source;
mod spectral;
mod wave;

#[cfg(test)]
mod tests;

use crate::error::{message, Result};
use std::path::{Path, PathBuf};

fn valid_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn managed_dir(root: &Path, role: &str, id: &str) -> Result<PathBuf> {
    if !valid_id(id) {
        return Err(message("stem_invalid_id"));
    }
    let path = root.join("stems").join(role).join(id);
    for component in path.ancestors().take(3) {
        match component.symlink_metadata() {
            Ok(metadata) if metadata.is_dir() => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            _ => return Err(message("stem_asset_missing")),
        }
    }
    Ok(path)
}

fn file(folder: &Path, name: &str) -> Result<PathBuf> {
    let expected = folder.join(name);
    let resolved = expected.canonicalize()?;
    if resolved.parent() != Some(folder.canonicalize()?.as_path())
        || !expected.symlink_metadata()?.is_file()
    {
        return Err(message("stem_asset_missing"));
    }
    Ok(resolved)
}

pub(crate) fn recover(db: &crate::db::Database) -> Result<()> {
    let con = db.lock();
    con.execute_batch(
        "UPDATE stem_jobs SET status='error',phase='interrupted',error='stem_interrupted' WHERE status='running';
         UPDATE stem_exports SET status='error',error='stem_interrupted' WHERE status='running';
         DELETE FROM stem_sources WHERE id NOT IN (SELECT source_id FROM stem_jobs)
           AND id NOT IN (SELECT source_id FROM stem_layers);",
    )?;
    let assets = db.root.join("stems");
    if !assets
        .symlink_metadata()
        .is_ok_and(|metadata| metadata.is_dir())
    {
        return Ok(());
    }
    for (directory, prefix, query) in [
        (
            "projects",
            ".project-",
            "SELECT id FROM stem_jobs WHERE status='done'",
        ),
        ("sources", ".source-", "SELECT id FROM stem_sources"),
        ("layers", ".layer-", "SELECT id FROM stem_layers"),
        (
            "exports",
            ".export-",
            "SELECT id FROM stem_exports WHERE status='done'",
        ),
    ] {
        let mut statement = con.prepare(query)?;
        let keep = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<std::collections::HashSet<_>>>()?;
        let path = assets.join(directory);
        if path
            .symlink_metadata()
            .is_ok_and(|metadata| metadata.is_dir())
        {
            for entry in std::fs::read_dir(path)?.flatten() {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if entry.file_type().is_ok_and(|kind| kind.is_dir())
                    && (name.starts_with(prefix)
                        || (valid_id(&name) && !keep.contains(name.as_ref())))
                {
                    let _ = std::fs::remove_dir_all(entry.path());
                }
            }
        }
    }
    Ok(())
}
