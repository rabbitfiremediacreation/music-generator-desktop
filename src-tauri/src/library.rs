use crate::{
    db::Database,
    error::{message, Result},
    types::{id, now},
};
use rusqlite::params;
use serde_json::{json, Value};

impl Database {
    /// Resolve playback by library identity, without accepting a frontend filesystem path.
    pub fn read_song_audio(&self, id: &str) -> Result<Vec<u8>> {
        let song = self.song(id)?;
        let path = song
            .audio_path()
            .ok_or_else(|| message("Song audio is unavailable"))?;
        let bytes = std::fs::read(path)
            .map_err(|error| message(format!("Cannot read song audio: {error}")))?;
        if bytes.is_empty() {
            return Err(message("Song audio is unavailable"));
        }
        Ok(bytes)
    }

    pub fn folders(&self) -> Result<Value> {
        let con = self.lock();
        let mut stmt = con.prepare("SELECT f.id,f.name,(SELECT COUNT(*) FROM songs s WHERE s.folder_id=f.id) FROM folders f ORDER BY name COLLATE NOCASE")?;
        let folders = stmt.query_map([], |r| Ok(json!({"id":r.get::<_,String>(0)?,"name":r.get::<_,String>(1)?,"count":r.get::<_,u32>(2)?})))?.collect::<std::result::Result<Vec<_>,_>>()?;
        let all: u32 = con.query_row("SELECT COUNT(*) FROM songs", [], |r| r.get(0))?;
        let none: u32 = con.query_row("SELECT COUNT(*) FROM songs WHERE folder_id IS NULL OR folder_id NOT IN (SELECT id FROM folders)", [], |r| r.get(0))?;
        Ok(json!({"folders":folders,"all":all,"none":none}))
    }

    pub fn folder_save(&self, fid: Option<&str>, name: &str) -> Result<Value> {
        let name: String = name.trim().chars().take(60).collect();
        if name.is_empty() {
            return Err(message("Please enter a folder name"));
        }
        let fid = fid.map(str::to_string).unwrap_or_else(id);
        self.lock().execute("INSERT INTO folders(id,name,created_at) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET name=excluded.name", params![fid,name,now()])?;
        Ok(json!({"id":fid,"name":name}))
    }

    pub fn folder_delete(&self, fid: &str) -> Result<()> {
        let mut con = self.lock();
        let tx = con.transaction()?;
        tx.execute("UPDATE songs SET folder_id=NULL WHERE folder_id=?1", [fid])?;
        tx.execute("DELETE FROM folders WHERE id=?1", [fid])?;
        tx.commit()?;
        Ok(())
    }

    pub(crate) fn active_work(&self) -> Result<Vec<Value>> {
        let con = self.lock();
        let mut stmt = con.prepare("SELECT id,status,message,caption,kind,title FROM (
            SELECT id,status,message,caption,'song' AS kind,title,created_at,rowid AS position
            FROM songs WHERE status IN ('queued','running')
            UNION ALL SELECT id,status,phase,json_extract(request,'$.name'),'separation',NULL,created_at,rowid FROM stem_jobs WHERE status IN ('queued','running')
            UNION ALL SELECT e.id,e.status,'export',json_extract(j.request,'$.name'),'export',NULL,e.created_at,e.rowid FROM stem_exports e
            JOIN stem_jobs j ON j.id=e.project_id WHERE e.status IN ('queued','running')
        ) ORDER BY created_at,position")?;
        let rows = stmt
            .query_map([], |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "status": row.get::<_, String>(1)?,
                    "message": row.get::<_, Option<String>>(2)?,
                    "caption": row.get::<_, String>(3)?,
                    "kind": row.get::<_, String>(4)?,
                    "title": row.get::<_, Option<String>>(5)?,
                }))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Read completed audio jobs separately so the running counter can poll a small snapshot.
    pub(crate) fn completed_work(&self, offset: u32) -> Result<Value> {
        const PAGE: usize = 25;
        let con = self.lock();
        let mut stmt = con.prepare(
            "SELECT id,kind,label,finished FROM (
                SELECT id,
                    CASE WHEN json_valid(params) THEN
                        CASE WHEN json_type(params,'$.remix')='object' THEN 'remix' ELSE 'song' END
                    ELSE 'song' END AS kind,
                    COALESCE(NULLIF(title,''),caption) AS label,
                    COALESCE(finished_at,created_at) AS finished
                FROM songs WHERE status='done'
                UNION ALL SELECT id,'separation',json_extract(request,'$.name'),COALESCE(finished_at,created_at)
                    FROM stem_jobs WHERE status='done'
                UNION ALL SELECT e.id,'export',json_extract(j.request,'$.name'),COALESCE(e.finished_at,e.created_at)
                    FROM stem_exports e JOIN stem_jobs j ON j.id=e.project_id WHERE e.status='done'
                UNION ALL SELECT id,'stem_generation',generated_name,created_at
                    FROM stem_layers WHERE generated_name IS NOT NULL
            ) ORDER BY finished DESC, kind, id LIMIT ?1 OFFSET ?2",
        )?;
        let mut jobs = stmt
            .query_map(params![PAGE + 1, offset], |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "kind": row.get::<_, String>(1)?,
                    "label": row.get::<_, Option<String>>(2)?,
                    "finished_at": row.get::<_, String>(3)?,
                }))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let next_offset = (jobs.len() > PAGE).then(|| u64::from(offset) + PAGE as u64);
        jobs.truncate(PAGE);
        Ok(json!({ "jobs": jobs, "next_offset": next_offset }))
    }

    pub fn queue(&self) -> Result<Value> {
        let rows = self.active_work()?;
        let dir = self.settings()?.songs_dir;
        let bytes: u64 = std::fs::read_dir(dir)
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|p| p.metadata().ok())
            .filter(|m| m.is_file())
            .map(|m| m.len())
            .sum();
        let count: u64 = self.lock().query_row(
            "SELECT COUNT(*) FROM songs WHERE file IS NOT NULL AND audio_missing=0",
            [],
            |r| r.get(0),
        )?;
        let queued = rows.iter().filter(|row| row["status"] == "queued").count();
        let running = rows.iter().filter(|row| row["status"] == "running").map(|row| json!({
            "id": row["id"], "status": row["status"], "message": row["message"], "caption": row["caption"],
        })).collect::<Vec<_>>();
        Ok(json!({"running":running,"queued":queued,"library":{"count":count,"bytes":bytes}}))
    }

    pub(crate) fn result_files(&self) -> Result<Vec<String>> {
        let con = self.lock();
        let mut stmt = con.prepare(
            "SELECT DISTINCT file FROM songs WHERE file IS NOT NULL AND audio_missing=0 ORDER BY file",
        )?;
        let files = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(files)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn completed_work_lists_successes_newest_first_across_job_types() {
        let root = tempfile::tempdir().unwrap();
        let db = Database::open(root.path()).unwrap();
        db.lock()
            .execute_batch(
                r#"
                INSERT INTO songs(id,group_id,created_at,finished_at,status,title,caption,seed,params)
                VALUES ('song','songs','2026-01-01','2026-01-06','done',NULL,'Song prompt',1,'{}'),
                    ('remix','songs','2026-01-01','2026-01-09','done','A remix','Style prompt',1,'{"remix":{}}'),
                    ('queued','songs','2026-01-01',NULL,'queued',NULL,'Waiting',1,'{}'),
                    ('error','songs','2026-01-01','2026-01-10','error',NULL,'Failed song',1,'{}');
                INSERT INTO stem_sources VALUES ('source',NULL,'{}');
                INSERT INTO stem_jobs(id,source_id,request,status,phase,created_at,finished_at)
                VALUES ('project','source','{"name":"Split song"}','done','done','2026-01-01','2026-01-07');
                INSERT INTO stem_exports(id,project_id,request,status,created_at,finished_at)
                VALUES ('export','project','{}','done','2026-01-01','2026-01-08');
                INSERT INTO stem_layers(id,project_id,source_id,created_at,generated_name)
                VALUES ('generated','project','source','2026-01-10','Keys'),
                    ('imported','project','source','2026-01-11',NULL);
                "#,
            )
            .unwrap();
        let page = db.completed_work(0).unwrap();
        let jobs = page["jobs"].as_array().unwrap();
        let summary: Vec<_> = jobs
            .iter()
            .map(|job| {
                (
                    job["kind"].as_str().unwrap(),
                    job["label"].as_str().unwrap(),
                )
            })
            .collect();
        assert_eq!(
            summary,
            [
                ("stem_generation", "Keys"),
                ("remix", "A remix"),
                ("export", "Split song"),
                ("separation", "Split song"),
                ("song", "Song prompt"),
            ]
        );
        assert!(page["next_offset"].is_null());
        assert_eq!(db.completed_work(3).unwrap()["jobs"][0]["id"], "project");
        assert_eq!(db.active_work().unwrap().len(), 1);
    }
}
