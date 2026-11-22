use super::{managed_dir, valid_id};
use crate::{
    error::{message, Result},
    state::AppState,
};

/// Remove the project and its dependent records before reclaiming their managed audio files.
pub(super) fn remove_project(state: &AppState, id: &str) -> Result<()> {
    if !valid_id(id) {
        return Err(message("stem_invalid_id"));
    }
    let assets = state.runtime.remove_stem_project(|| {
        let mut con = state.db.lock();
        let tx = con.transaction()?;
        let busy: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM stem_exports WHERE project_id=?1 AND status IN ('queued','running'))",
            [id],
            |row| row.get(0),
        )?;
        if busy {
            return Err(message("stem_project_export_busy"));
        }
        let assets = {
            let mut query = tx.prepare(
                "SELECT 'layers',id FROM stem_layers WHERE project_id=?1
                 UNION ALL SELECT 'exports',id FROM stem_exports WHERE project_id=?1",
            )?;
            let rows = query.query_map([id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        tx.execute("DELETE FROM stem_exports WHERE project_id=?1", [id])?;
        tx.execute("DELETE FROM stem_mixes WHERE project_id=?1", [id])?;
        tx.execute("DELETE FROM stem_layers WHERE project_id=?1", [id])?;
        if tx.execute("DELETE FROM stem_jobs WHERE id=?1 AND status IN ('done','error','cancelled')", [id])? != 1 {
            return Err(message("stem_project_missing"));
        }
        tx.commit()?;
        Ok(assets)
    })?;

    // Source snapshots may still be open in the separation wizard. Startup reclaims unreferenced snapshots.
    for (role, asset) in std::iter::once(("projects", id))
        .chain(assets.iter().map(|(role, id)| (role.as_str(), id.as_str())))
    {
        if let Ok(path) = managed_dir(&state.db.root, role, asset) {
            if let Err(error) = std::fs::remove_dir_all(path) {
                if error.kind() != std::io::ErrorKind::NotFound {
                    tracing::warn!(%error, %role, %asset, "Stem asset cleanup deferred until startup");
                }
            }
        }
    }
    Ok(())
}
