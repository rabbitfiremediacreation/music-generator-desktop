use crate::{
    db::{safe_song_path, Database},
    error::{message, Result},
    types::{now, SongFilter},
};
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use std::path::Path;

impl Database {
    /// Cancel only pending work, even if completion races with the caller.
    pub(super) fn mcp_cancel_song(&self, id: &str) -> Result<bool> {
        let mut con = self.lock();
        let tx = con.transaction()?;
        let status: String = tx
            .query_row("SELECT status FROM songs WHERE id=?1", [id], |r| r.get(0))
            .optional()?
            .ok_or_else(|| message("Song not found"))?;
        let cancelled = matches!(status.as_str(), "queued" | "running");
        if cancelled {
            tx.execute(
                "UPDATE songs SET status='cancelled',message=NULL,finished_at=?2 WHERE id=?1 AND status IN ('queued','running')",
                params![id, now()],
            )?;
        }
        tx.commit()?;
        Ok(cancelled)
    }

    /// Delete terminal songs under the same lock used by retries and worker completion.
    pub(super) fn mcp_delete_song(&self, id: &str) -> Result<()> {
        let songs_dir = self.settings()?.songs_dir;
        let mut con = self.lock();
        let tx = con.transaction()?;
        let (status, file): (String, Option<String>) = tx
            .query_row("SELECT status,file FROM songs WHERE id=?1", [id], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .optional()?
            .ok_or_else(|| message("Song not found"))?;
        if matches!(status.as_str(), "queued" | "running") {
            return Err(message("Cancel the song before deleting it"));
        }
        if let Some(file) = file {
            let path = safe_song_path(Path::new(&songs_dir), &file)?;
            match std::fs::remove_file(path) {
                Ok(()) => (),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
                Err(error) => return Err(error.into()),
            }
        }
        tx.execute("DELETE FROM songs WHERE id=?1", [id])?;
        tx.commit()?;
        drop(con);
        crate::audio_export::remove_cached(&self.root, id);
        Ok(())
    }

    /// Page identifiers directly in SQL, without the studio's 500-row display limit.
    pub(super) fn mcp_song_page(
        &self,
        filter: &SongFilter,
        status: &str,
        limit: u32,
        offset: u32,
    ) -> Result<Value> {
        const FILTER: &str = "FROM songs WHERE (?1='' OR title LIKE ?2 OR caption LIKE ?2 OR lyrics LIKE ?2) AND (?3=0 OR favorite=1) AND (?4='' OR group_id=?4) AND (?5='' OR (?5='none' AND (folder_id IS NULL OR folder_id NOT IN (SELECT id FROM folders))) OR folder_id=?5) AND (?6='' OR status=?6)";
        let con = self.lock();
        let pattern = format!("%{}%", filter.q);
        let total: u64 = con.query_row(
            &format!("SELECT COUNT(*) {FILTER}"),
            params![
                filter.q,
                pattern,
                filter.favorites,
                filter.group,
                filter.folder,
                status
            ],
            |row| row.get(0),
        )?;
        let mut statement = con.prepare(&format!(
            "SELECT id {FILTER} ORDER BY created_at DESC,rowid DESC LIMIT ?7 OFFSET ?8"
        ))?;
        let ids = statement
            .query_map(
                params![
                    filter.q,
                    pattern,
                    filter.favorites,
                    filter.group,
                    filter.folder,
                    status,
                    limit,
                    offset
                ],
                |row| row.get::<_, String>(0),
            )?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        drop(statement);
        drop(con);
        let songs = ids
            .iter()
            .map(|id| self.song(id))
            .collect::<Result<Vec<_>>>()?;
        let next = u64::from(offset) + songs.len() as u64;
        Ok(json!({
            "songs": songs, "total": total, "offset": offset, "limit": limit,
            "next_offset": (next < total).then_some(next)
        }))
    }

    pub(super) fn mcp_queue_jobs(&self) -> Result<Vec<Value>> {
        let con = self.lock();
        let mut statement = con.prepare("SELECT id,status,title,caption,message FROM songs WHERE status IN ('queued','running') ORDER BY created_at,rowid")?;
        let jobs = statement
            .query_map([], |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "status": row.get::<_, String>(1)?,
                    "title": row.get::<_, Option<String>>(2)?,
                    "caption": row.get::<_, String>(3)?,
                    "message": row.get::<_, Option<String>>(4)?
                }))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(jobs)
    }
}
