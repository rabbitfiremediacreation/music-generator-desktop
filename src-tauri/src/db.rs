use crate::{
    error::{message, Result},
    types::{id, now, GenerateRequest, Settings, Song, SongFilter},
};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
};

pub struct Database {
    connection: Mutex<Connection>,
    pub root: PathBuf,
}

impl Database {
    pub fn open(root: &Path) -> Result<Self> {
        std::fs::create_dir_all(root)?;
        let db = Self {
            connection: Mutex::new(Connection::open(root.join("music.db"))?),
            root: root.into(),
        };
        {
            let con = db.lock();
            con.busy_timeout(std::time::Duration::from_secs(5))?;
            con.execute_batch(include_str!("schema.sql"))?;
            let mut statement = con.prepare("PRAGMA table_info(songs)")?;
            let columns = statement
                .query_map([], |r| r.get::<_, String>(1))?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            if !columns.iter().any(|c| c == "folder_id") {
                con.execute("ALTER TABLE songs ADD COLUMN folder_id TEXT", [])?;
            }
            if !columns.iter().any(|c| c == "started_at") {
                con.execute("ALTER TABLE songs ADD COLUMN started_at TEXT", [])?;
            }
            if !columns.iter().any(|c| c == "audio_missing") {
                con.execute(
                    "ALTER TABLE songs ADD COLUMN audio_missing INTEGER NOT NULL DEFAULT 0",
                    [],
                )?;
            }
            con.execute(
                "UPDATE songs SET status='queued', message=NULL WHERE status='running'",
                [],
            )?;
        }
        Ok(db)
    }

    pub(crate) fn lock(&self) -> MutexGuard<'_, Connection> {
        self.connection.lock().expect("database mutex poisoned")
    }

    pub fn settings(&self) -> Result<Settings> {
        let mut value = serde_json::to_value(Settings::default())?;
        let con = self.lock();
        let mut statement = con.prepare("SELECT key,value FROM settings")?;
        for row in
            statement.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        {
            let (key, text) = row?;
            if value.get(&key).is_some() {
                value[&key] = serde_json::from_str(&text)?;
            }
        }
        let mut settings: Settings = serde_json::from_value(value)?;
        crate::catalog::restore_supported_profile(&mut settings)?;
        if settings.models_dir.is_empty() {
            settings.models_dir = self.root.join("models").to_string_lossy().into();
        }
        if settings.songs_dir.is_empty() {
            settings.songs_dir = self.root.join("songs").to_string_lossy().into();
        }
        Ok(settings)
    }

    /// Update only this preference; callers serialize admission with configuration writers.
    pub fn set_expert_mode(&self, enabled: bool) -> Result<()> {
        self.set_preferences(Some(enabled), None)
    }

    /// Update only provided preferences atomically, preserving unrelated configuration.
    pub fn set_preferences(
        &self,
        expert: Option<bool>,
        cpu: Option<crate::types::CpuIterationBehavior>,
    ) -> Result<()> {
        let mut con = self.lock();
        let tx = con.transaction()?;
        for (key, value) in [
            ("expert_mode", expert.map(serde_json::to_value)),
            ("cpu_iteration_behavior", cpu.map(serde_json::to_value)),
        ] {
            if let Some(value) = value {
                tx.execute("INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![key, value?.to_string()])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn save_settings(&self, settings: &Settings) -> Result<()> {
        let mut con = self.lock();
        let tx = con.transaction()?;
        for (key, value) in serde_json::to_value(settings)?.as_object().unwrap() {
            tx.execute("INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![key, value.to_string()])?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn songs(&self, filter: &SongFilter) -> Result<Vec<Song>> {
        let songs_dir = self.settings()?.songs_dir;
        let con = self.lock();
        let mut stmt = con.prepare("SELECT *, (SELECT COUNT(*) FROM songs older WHERE older.group_id=songs.group_id AND older.rowid<songs.rowid) AS variant_index, (SELECT COUNT(*) FROM songs siblings WHERE siblings.group_id=songs.group_id) AS variant_count FROM songs WHERE (?1='' OR title LIKE ?2 OR caption LIKE ?2 OR lyrics LIKE ?2) AND (?3=0 OR favorite=1) AND (?4='' OR group_id=?4) AND (?5='' OR (?5='none' AND (folder_id IS NULL OR folder_id NOT IN (SELECT id FROM folders))) OR folder_id=?5) AND (?6='' OR id=?6) ORDER BY created_at DESC,rowid DESC LIMIT 500")?;
        let rows = stmt.query_map(
            params![
                filter.q,
                format!("%{}%", filter.q),
                filter.favorites,
                filter.group,
                filter.folder,
                filter.id
            ],
            |row| {
                let file: Option<String> = row.get("file")?;
                let audio_missing: bool = row.get("audio_missing")?;
                let meta: Option<String> = row.get("result_meta")?;
                let index: u32 = row.get("variant_index")?;
                let count: u32 = row.get("variant_count")?;
                Ok(Song {
                    id: row.get("id")?,
                    group_id: row.get("group_id")?,
                    created_at: row.get("created_at")?,
                    started_at: row.get("started_at")?,
                    finished_at: row.get("finished_at")?,
                    status: row.get("status")?,
                    message: row.get("message")?,
                    title: row.get("title")?,
                    caption: row.get("caption")?,
                    lyrics: row.get("lyrics")?,
                    seed: row.get("seed")?,
                    params: parse_json(row.get("params")?)?,
                    result_meta: meta.map(parse_json).transpose()?,
                    engine: row.get("engine")?,
                    path: file
                        .as_ref()
                        .filter(|_| !audio_missing)
                        .and_then(|f| safe_song_path(Path::new(&songs_dir), f).ok())
                        .map(|p| p.to_string_lossy().into()),
                    audio_missing,
                    file,
                    favorite: row.get::<_, bool>("favorite")?,
                    folder_id: row.get("folder_id")?,
                    letter: if count > 1 && index < 26 {
                        char::from_u32(65 + index).unwrap().to_string()
                    } else {
                        String::new()
                    },
                })
            },
        )?;
        let mut songs = rows.collect::<std::result::Result<Vec<_>, _>>()?;
        drop(stmt);
        drop(con);
        for song in &mut songs {
            if song.status != "done" {
                continue;
            }
            let mut metadata = song.result_meta.clone().unwrap_or_else(|| json!({}));
            if let Some(path) = song.path.as_deref() {
                let _ = crate::audio_facts::enrich_metadata(
                    Path::new(path),
                    &song.params,
                    &mut metadata,
                );
            } else {
                crate::audio_facts::unknown_duration(&song.params, &mut metadata);
            }
            if song.engine.as_deref() == Some("acestep_cpp") {
                crate::generation_limits::enrich_metadata(&song.params, &mut metadata);
            }
            song.result_meta = Some(metadata);
        }
        Ok(songs)
    }

    pub fn song(&self, sid: &str) -> Result<Song> {
        self.songs(&SongFilter {
            id: sid.into(),
            ..Default::default()
        })?
        .into_iter()
        .next()
        .ok_or_else(|| message("Song not found"))
    }

    pub fn enqueue(&self, req: &GenerateRequest) -> Result<Vec<String>> {
        if let Some(selection) = &req.model_selection {
            crate::catalog::required(selection)?;
        }
        if !(1..=50).contains(&req.variants)
            || !req.duration.is_finite()
            || !(0.0..=600.0).contains(&req.duration)
            || req.inference_steps > crate::generation_limits::MAX_INFERENCE_STEPS
            || req.bpm > 300
            || req.seed.checked_add(req.variants as i64).is_none()
            || req
                .lm_temperature
                .is_some_and(|n| !n.is_finite() || !(0.0..=3.0).contains(&n))
        {
            return Err(message("Invalid generation parameters"));
        }
        let caption = [
            req.style.trim().trim_matches(','),
            req.prompt.trim().trim_matches(','),
        ]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(", ");
        let caption = if caption.is_empty() {
            req.caption.trim().to_string()
        } else {
            caption
        };
        if caption.is_empty() {
            return Err(message("Please enter a prompt or style"));
        }
        let group = req.group_id.clone().unwrap_or_else(id);
        let lyrics = if req.instrumental {
            "[Instrumental]"
        } else {
            req.lyrics.trim()
        };
        let selection = if let Some(selection) = &req.model_selection {
            selection.clone()
        } else {
            crate::catalog::Selection::from_settings(&self.settings()?)
        };
        let steps = crate::generation_limits::effective_steps(
            Some(u64::from(req.inference_steps)),
            &selection.synthesis,
        );
        let mut con = self.lock();
        let tx = con.transaction()?;
        let folder = req.folder_id.as_ref().filter(|f| {
            tx.query_row("SELECT COUNT(*) FROM folders WHERE id=?1", [f], |r| {
                r.get::<_, u32>(0)
            })
            .unwrap_or(0)
                > 0
        });
        let mut ids = Vec::new();
        for i in 0..req.variants {
            let sid = id();
            let seed = if req.seed < 0 {
                (uuid::Uuid::new_v4().as_u128() % (i32::MAX as u128)) as i64
            } else {
                req.seed + i as i64
            };
            let mut p = serde_json::to_value(req)?;
            p["inference_steps"] = json!(steps);
            p["caption"] = json!(caption);
            p["lyrics"] = json!(lyrics);
            p["seed"] = json!(seed);
            p["use_cot_caption"] = json!(!req.keep_caption);
            tx.execute("INSERT INTO songs(id,group_id,created_at,status,title,caption,lyrics,seed,params,folder_id) VALUES(?1,?2,?3,'queued',?4,?5,?6,?7,?8,?9)", params![sid,group,now(),nonempty(&req.title),caption,lyrics,seed,p.to_string(),folder])?;
            ids.push(sid);
        }
        tx.commit()?;
        Ok(ids)
    }

    pub fn claim_next(&self) -> Result<Option<(String, Value)>> {
        let mut con = self.lock();
        let tx = con.transaction()?;
        let next = {
            let mut stmt = tx.prepare("SELECT id,params FROM songs WHERE status='queued' ORDER BY created_at,rowid LIMIT 1")?;
            let mut rows = stmt.query([])?;
            rows.next()?
                .map(|r| Ok::<_, rusqlite::Error>((r.get::<_, String>(0)?, parse_json(r.get(1)?)?)))
                .transpose()?
        };
        if let Some((sid, _)) = &next {
            tx.execute(
                "UPDATE songs SET status='running',message='0:00',started_at=?2 WHERE id=?1",
                params![sid, now()],
            )?;
        }
        tx.commit()?;
        Ok(next)
    }

    pub fn busy(&self) -> Result<bool> {
        Ok(self.lock().query_row(
            "SELECT COUNT(*) FROM songs WHERE status IN ('running','queued')",
            [],
            |r| r.get::<_, u32>(0),
        )? > 0)
    }

    pub fn progress(&self, sid: &str, text: &str) -> Result<()> {
        self.lock().execute(
            "UPDATE songs SET message=?1 WHERE id=?2 AND status='running'",
            params![text, sid],
        )?;
        Ok(())
    }

    pub fn finish(&self, sid: &str, file: &str, meta: &Value) -> Result<bool> {
        let engine = "acestep_cpp";
        let mut meta = meta.clone();
        if meta["generated_title"]
            .as_str()
            .and_then(nonempty)
            .is_none()
            && meta["title_generation_error"].as_str().is_some()
        {
            meta["generated_title"] = crate::random_titles::random_title().into();
        }
        Ok(self.lock().execute("UPDATE songs SET status='done',message=NULL,audio_missing=0,file=?1,result_meta=?2,engine=?5,finished_at=?3,title=CASE WHEN title IS NULL OR trim(title)='' THEN COALESCE(?6,title) ELSE title END WHERE id=?4 AND status='running'", params![file, meta.to_string(), now(), sid, engine, meta["generated_title"].as_str().and_then(nonempty)])? == 1)
    }

    pub fn fail(&self, sid: &str, error: &str) -> Result<()> {
        self.lock().execute("UPDATE songs SET status='error',message=?1,finished_at=?2 WHERE id=?3 AND status='running'", params![error, now(), sid])?;
        Ok(())
    }

    pub fn retry(&self, sid: &str) -> Result<()> {
        self.lock().execute("UPDATE songs SET status='queued',message=NULL WHERE id=?1 AND status IN ('error','cancelled')", [sid])?;
        Ok(())
    }

    pub fn cancel_or_delete(&self, sid: &str) -> Result<bool> {
        let song = self.song(sid)?;
        if ["queued", "running"].contains(&song.status.as_str()) {
            self.lock().execute(
                "UPDATE songs SET status='cancelled',message=NULL,finished_at=?1 WHERE id=?2",
                params![now(), sid],
            )?;
            return Ok(true);
        }
        if let Some(path) = song.path {
            let path = Path::new(&path);
            if path.is_file() {
                std::fs::remove_file(path)?;
            }
        }
        self.lock()
            .execute("DELETE FROM songs WHERE id=?1", [sid])?;
        crate::audio_export::remove_cached(&self.root, sid);
        Ok(false)
    }

    pub fn patch(&self, sid: &str, patch: &Value) -> Result<()> {
        let mut con = self.lock();
        let tx = con.transaction()?;
        if let Some(v) = patch.get("title").and_then(Value::as_str) {
            tx.execute(
                "UPDATE songs SET title=?1 WHERE id=?2",
                params![nonempty(v), sid],
            )?;
        }
        if let Some(v) = patch.get("favorite").and_then(Value::as_bool) {
            tx.execute("UPDATE songs SET favorite=?1 WHERE id=?2", params![v, sid])?;
        }
        if let Some(v) = patch.get("folder_id") {
            let folder = v.as_str().filter(|s| !s.is_empty());
            if let Some(fid) = folder {
                if tx.query_row("SELECT COUNT(*) FROM folders WHERE id=?1", [fid], |r| {
                    r.get::<_, u32>(0)
                })? == 0
                {
                    return Err(message("Folder not found"));
                }
            }
            tx.execute(
                "UPDATE songs SET folder_id=?1 WHERE id=?2",
                params![folder, sid],
            )?;
        }
        tx.commit()?;
        Ok(())
    }
}

pub fn safe_song_path(root: &Path, file: &str) -> Result<PathBuf> {
    if file.is_empty()
        || file.contains(['/', '\\'])
        || file == "."
        || file == ".."
        || file.contains(':')
    {
        return Err(message("Invalid song filename"));
    }
    let path = root.join(file);
    if path.exists() && !path.canonicalize()?.starts_with(root.canonicalize()?) {
        return Err(message("Song is outside its library"));
    }
    Ok(path)
}

fn nonempty(s: &str) -> Option<&str> {
    if s.trim().is_empty() {
        None
    } else {
        Some(s.trim())
    }
}
fn parse_json(s: String) -> rusqlite::Result<Value> {
    serde_json::from_str(&s).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    })
}
