use crate::{db::Database, error::Result, types::now};
use rusqlite::{params, OptionalExtension};
use serde_json::Value;

pub(crate) enum Work {
    Song(String, Value),
    Separate(String),
    Export(String),
}

impl Database {
    /// Generation, separation and export all enter the same FIFO and resource gate.
    pub(crate) fn claim_work(&self) -> Result<Option<Work>> {
        let mut con = self.lock();
        let tx = con.transaction()?;
        let selected = tx.query_row(
            "WITH jobs AS (
                SELECT id,created_at,'song' AS kind,params AS request,rowid AS position FROM songs WHERE status='queued'
                UNION ALL SELECT id,created_at,'stem',request,rowid FROM stem_jobs WHERE status='queued'
                UNION ALL SELECT id,created_at,'export',request,rowid FROM stem_exports WHERE status='queued'
            ) SELECT id,kind,request FROM jobs ORDER BY created_at,kind,position LIMIT 1",
            [], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)),
        ).optional()?;
        let work = match selected {
            Some((id, kind, request)) if kind == "song" => {
                tx.execute(
                    "UPDATE songs SET status='running',message='0:00',started_at=?2 WHERE id=?1",
                    params![id, now()],
                )?;
                Some(Work::Song(id, serde_json::from_str(&request)?))
            }
            Some((id, kind, _)) if kind == "stem" => {
                tx.execute(
                    "UPDATE stem_jobs SET status='running',phase='preflight' WHERE id=?1",
                    [&id],
                )?;
                Some(Work::Separate(id))
            }
            Some((id, _, _)) => {
                tx.execute(
                    "UPDATE stem_exports SET status='running' WHERE id=?1",
                    [&id],
                )?;
                Some(Work::Export(id))
            }
            None => None,
        };
        tx.commit()?;
        Ok(work)
    }
}
