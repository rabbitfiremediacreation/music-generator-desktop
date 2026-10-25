use crate::{
    db::Database,
    error::{message, Result},
    types::{id, now},
};
use rusqlite::params;
use serde_json::{json, Value};

impl Database {
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

    pub fn queue(&self) -> Result<Value> {
        let dir = self.settings()?.songs_dir;
        let con = self.lock();
        let mut stmt = con.prepare("SELECT id,status,message,caption FROM songs WHERE status IN ('queued','running') ORDER BY created_at,rowid")?;
        let rows = stmt.query_map([], |r| Ok(json!({"id":r.get::<_,String>(0)?,"status":r.get::<_,String>(1)?,"message":r.get::<_,Option<String>>(2)?,"caption":r.get::<_,String>(3)?})))?.collect::<std::result::Result<Vec<_>,_>>()?;
        let bytes: u64 = std::fs::read_dir(dir)
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|p| p.metadata().ok())
            .filter(|m| m.is_file())
            .map(|m| m.len())
            .sum();
        let count: u64 = con.query_row(
            "SELECT COUNT(*) FROM songs WHERE file IS NOT NULL AND audio_missing=0",
            [],
            |r| r.get(0),
        )?;
        Ok(
            json!({"running":rows.iter().filter(|s| s["status"]=="running").collect::<Vec<_>>(),"queued":rows.iter().filter(|s| s["status"]=="queued").count(),"library":{"count":count,"bytes":bytes}}),
        )
    }

    pub(crate) fn audio_files(&self) -> Result<Vec<String>> {
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
