mod queue;
use super::{engine, export, managed_dir, model, source};
use crate::{
    error::{message, Error, Result},
    runtime::Operation,
    state::AppState,
    types::{id, now},
};
pub(crate) use queue::Work;
use rusqlite::{params, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

const JOB_FIELDS: &str =
    "j.id,j.request,j.status,j.phase,j.error,j.created_at,j.finished_at,j.result,s.data";

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Quality {
    Fast,
    Standard,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Request {
    pub source_id: String,
    pub pin: model::Pin,
    pub name: String,
    #[serde(default)]
    pub folder_id: Option<String>,
    pub start: f64,
    pub end: Option<f64>,
    pub quality: Quality,
    pub overlap: f64,
    pub outputs: Vec<String>,
    #[serde(default)]
    pub preview: bool,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Project {
    pub rate: u32,
    pub channels: u32,
    pub frames: u64,
    pub source_start_frame: u64,
    pub source_frames: u64,
    pub roles: Vec<String>,
    pub engine: String,
    pub engine_version: String,
    pub architecture: String,
    pub backend: String,
    pub weights_sha256: String,
    pub expected_roles: Vec<String>,
    pub original_peak: f32,
    pub track_peaks: Vec<f32>,
}

#[derive(Clone, Serialize)]
pub struct Job {
    pub id: String,
    pub request: Request,
    pub status: String,
    pub phase: String,
    pub error: Option<String>,
    pub created_at: String,
    pub finished_at: Option<String>,
    pub project: Option<Project>,
    pub source: source::Source,
}

impl Job {
    pub fn complete(&self) -> Result<&Project> {
        self.project
            .as_ref()
            .filter(|_| self.status == "done")
            .ok_or_else(|| message("stem_project_not_ready"))
    }

    pub fn audio_path(&self, root: &Path, role: &str) -> Result<PathBuf> {
        if role != "original" && !self.complete()?.roles.iter().any(|item| item == role) {
            return Err(message("stem_asset_missing"));
        }
        self.complete()?;
        let dir = managed_dir(root, "projects", &self.id)?;
        super::file(&dir, &format!("{role}.wav"))
    }
}

fn row(row: &Row<'_>) -> rusqlite::Result<Job> {
    Ok(Job {
        id: row.get(0)?,
        request: crate::db::parse_json(row.get(1)?)?,
        status: row.get(2)?,
        phase: row.get(3)?,
        error: row.get(4)?,
        created_at: row.get(5)?,
        finished_at: row.get(6)?,
        project: row
            .get::<_, Option<String>>(7)?
            .map(crate::db::parse_json)
            .transpose()?,
        source: crate::db::parse_json(row.get(8)?)?,
    })
}

pub fn list(
    state: &AppState,
    song_id: Option<&str>,
    source_id: Option<&str>,
    folder_id: Option<&str>,
    offset: u32,
) -> Result<Vec<Job>> {
    let con = state.db.lock();
    let mut query = con.prepare(&format!(
        "SELECT {JOB_FIELDS} FROM stem_jobs j JOIN stem_sources s ON s.id=j.source_id
         WHERE (?1 IS NULL OR s.song_id=?1) AND (?2 IS NULL OR j.source_id=?2)
         AND (?3 IS NULL OR (?3='none' AND (json_extract(j.request,'$.folder_id') IS NULL OR
              NOT EXISTS(SELECT 1 FROM folders WHERE id=json_extract(j.request,'$.folder_id'))))
              OR json_extract(j.request,'$.folder_id')=?3)
         ORDER BY j.created_at DESC,j.rowid DESC LIMIT 40 OFFSET ?4"
    ))?;
    let rows = query.query_map(params![song_id, source_id, folder_id, offset], row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn get(state: &AppState, id: &str) -> Result<Job> {
    state.db.lock().query_row(
        &format!("SELECT {JOB_FIELDS} FROM stem_jobs j JOIN stem_sources s ON s.id=j.source_id WHERE j.id=?1"),
        [id], row,
    ).optional()?.ok_or_else(|| message("stem_project_missing"))
}

pub fn latest_for_song(state: &AppState, song_id: &str) -> Result<Job> {
    state.db.lock().query_row(
        &format!("SELECT {JOB_FIELDS} FROM stem_jobs j JOIN stem_sources s ON s.id=j.source_id
                  WHERE s.song_id=?1 AND j.status='done' AND json_extract(j.request,'$.preview')=0
                  ORDER BY j.created_at DESC,j.rowid DESC LIMIT 1"),
        [song_id], row,
    ).optional()?.ok_or_else(|| message("stem_project_missing"))
}

pub fn enqueue(state: &AppState, request: Request) -> Result<String> {
    state.runtime.enqueue(|| {
        preflight(state, &request)?;
        if let Some(folder) = &request.folder_id {
            let exists: bool = state.db.lock().query_row("SELECT EXISTS(SELECT 1 FROM folders WHERE id=?1)", [folder], |row| row.get(0))?;
            if !exists { return Err(message("stem_folder_missing")); }
        }
        let id = id();
        state.db.lock().execute(
            "INSERT INTO stem_jobs(id,source_id,request,status,phase,created_at) VALUES(?1,?2,?3,'queued','queued',?4)",
            params![id, request.source_id, serde_json::to_string(&request)?, now()],
        )?;
        Ok(id)
    })
}

#[derive(Serialize)]
pub struct Preflight {
    pub frames: u64,
    pub first: u64,
    pub source_frames: u64,
    pub bytes: u64,
    pub seconds: f64,
}

pub fn preflight(state: &AppState, request: &Request) -> Result<Preflight> {
    let artifact = model::ready_file(state, &request.pin)?;
    let profile = model::get(&request.pin.model)?;
    let source = source::get(state, &request.source_id)?;
    source.audio_path(&state.db.root)?;
    if request.name.trim().is_empty()
        || request.name.chars().count() > 160
        || !request.overlap.is_finite()
        || !(0.0..=0.5).contains(&request.overlap)
        || request.outputs.is_empty()
        || request.outputs.len() > profile.roles.len() + 1
        || request
            .outputs
            .iter()
            .any(|role| role != "instrumental" && !profile.roles.contains(&role.as_str()))
        || request
            .outputs
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
            != request.outputs.len()
    {
        return Err(message("stem_parameters"));
    }
    let rate = f64::from(source.audio.rate);
    let end = request.end.unwrap_or_else(|| source.audio.seconds());
    if !request.start.is_finite()
        || !end.is_finite()
        || request.start < 0.0
        || end <= request.start
        || end > source.audio.seconds()
        || (request.preview && end - request.start > 20.0)
    {
        return Err(message("stem_range"));
    }
    let first = (request.start * rate).round() as u64;
    let end = (end * rate).round() as u64;
    let source_frames = end
        .checked_sub(first)
        .filter(|count| *count > 0)
        .ok_or_else(|| message("stem_range"))?;
    let frames = (source_frames * u64::from(model::RATE)).div_ceil(u64::from(source.audio.rate));
    if frames > u64::from((u32::MAX - 1024) / 8) {
        return Err(message("stem_range"));
    }
    let bytes = (frames * 8 + 1024) * (request.outputs.len() as u64 + 1);
    let parent = state.db.root.join("stems").join("projects");
    std::fs::create_dir_all(&parent)?;
    crate::download::ensure_space(&parent, bytes + artifact.bytes + 8 * 1024 * 1024)?;
    drop(tempfile::NamedTempFile::new_in(&parent)?);
    Ok(Preflight {
        frames,
        first,
        source_frames,
        bytes,
        seconds: frames as f64 / f64::from(model::RATE),
    })
}

pub fn cancel(state: &AppState, id: &str) -> Result<bool> {
    state.runtime.cancel_song(id, || {
        Ok(state.db.lock().execute(
            "UPDATE stem_jobs SET status='cancelled',phase='cancelled',finished_at=?2
             WHERE id=?1 AND status IN ('queued','running')",
            params![id, now()],
        )? == 1)
    })
}

pub fn retry(state: &AppState, id: &str) -> Result<()> {
    state.runtime.enqueue(|| {
        preflight(state, &get(state, id)?.request)?;
        if state.db.lock().execute(
            "UPDATE stem_jobs SET status='queued',phase='queued',error=NULL,finished_at=NULL
             WHERE id=?1 AND status IN ('error','cancelled')",
            [id],
        )? != 1
        {
            return Err(message("stem_retry_unavailable"));
        }
        Ok(())
    })
}

pub async fn run(state: &AppState, id: &str, operation: &Operation, notify: impl Fn()) {
    let result = separate(state, id, operation, &notify).await;
    if let Err(error) = result {
        let (status, phase, text) = match error {
            Error::Cancelled if state.runtime.is_shutdown() => {
                ("error", "interrupted", Some("stem_interrupted".into()))
            }
            Error::Cancelled => ("cancelled", "cancelled", None),
            _ => ("error", "error", Some(error.to_string())),
        };
        let _ = state.db.lock().execute(
            "UPDATE stem_jobs SET status=?2,phase=?3,error=?4,finished_at=?5 WHERE id=?1 AND status='running'",
            params![id, status, phase, text, now()],
        );
    }
    notify();
}

async fn separate(
    state: &AppState,
    id: &str,
    operation: &Operation,
    notify: &impl Fn(),
) -> Result<()> {
    let cancel = operation.cancellation();
    let job = get(state, id)?;
    if job.status != "running" || cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    let request = &job.request;
    let preflight = preflight(state, request)?;
    let (weight, artifact) = model::verify(state, &request.pin, &cancel).await?;
    let profile = model::get(&request.pin.model)?;
    let source = job.source.audio_path(&state.db.root)?;
    let original = job.source.original(&state.db.root)?;
    if crate::verification::hash_file_with_progress(&original, &cancel, |_, _| {}).await?
        != job.source.hash
    {
        return Err(message("stem_source_changed"));
    }
    let target = managed_dir(&state.db.root, "projects", id)?;
    let staging = tempfile::Builder::new()
        .prefix(".project-")
        .tempdir_in(target.parent().expect("projects"))?;
    // The Python subprocess reads its weights inside the app container, even when the
    // configured model folder is protected by a macOS security-scoped bookmark.
    let local_weight = staging.path().join("weights.safetensors");
    tokio::select! {
        _ = cancel.cancelled() => return Err(Error::Cancelled),
        copied = tokio::fs::copy(&weight, &local_weight) => { copied?; }
    }
    let config = staging.path().join("request.json");
    std::fs::write(
        &config,
        serde_json::to_vec(&serde_json::json!({
            "weights":local_weight, "input":source, "output":staging.path(), "first":preflight.first,
            "frames":preflight.source_frames, "source_rate":job.source.audio.rate,
            "roles":profile.roles, "outputs":request.outputs, "quality":request.quality, "overlap":request.overlap,
        }))?,
    )?;
    let timeout = Duration::from_secs_f64(
        state.db.settings()?.timeout_minutes.clamp(1.0, 24.0 * 60.0) * 60.0,
    );
    let phase = |phase: &str| {
        let _ = state.db.lock().execute(
            "UPDATE stem_jobs SET phase=?2 WHERE id=?1 AND status='running'",
            params![id, phase],
        );
        notify();
    };
    state.stop_engine();
    engine::execute(
        state,
        "separate",
        &[config.into_os_string()],
        &cancel,
        timeout,
        |value| {
            if let Some(stage @ ("loading" | "preparing" | "separating" | "validating")) =
                value["phase"].as_str()
            {
                phase(stage);
            }
        },
        "stem_engine_failed",
    )
    .await?;
    let (original_peak, track_peaks) = {
        let roles = request.outputs.clone();
        let folder = staging.path().to_owned();
        let frames = preflight.frames;
        let cancel = cancel.clone();
        tokio::task::spawn_blocking(move || {
            let original = super::mix::verify_wave(&folder.join("original.wav"), frames, &cancel)?;
            let peaks = roles
                .iter()
                .map(|role| {
                    super::mix::verify_wave(&folder.join(format!("{role}.wav")), frames, &cancel)
                })
                .collect::<Result<Vec<_>>>()?;
            Ok::<_, Error>((original, peaks))
        })
        .await
        .map_err(|_| message("stem_output_invalid"))??
    };
    std::fs::remove_file(local_weight)?;
    std::fs::remove_file(staging.path().join("request.json"))?;
    let project = Project {
        rate: model::RATE,
        channels: 2,
        frames: preflight.frames,
        source_start_frame: preflight.first,
        source_frames: preflight.source_frames,
        roles: request.outputs.clone(),
        engine: model::ENGINE.into(),
        engine_version: model::ENGINE_VERSION.into(),
        architecture: profile.architecture.into(),
        backend: "cpu".into(),
        weights_sha256: artifact.sha256,
        expected_roles: request.outputs.clone(),
        original_peak,
        track_peaks,
    };
    phase("saving");
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    std::fs::rename(staging.path(), &target)?;
    let update = state.db.lock().execute(
        "UPDATE stem_jobs SET status='done',phase='done',result=?2,finished_at=?3 WHERE id=?1 AND status='running'",
        params![id, serde_json::to_string(&project)?, now()],
    );
    if !matches!(update, Ok(1)) {
        let _ = std::fs::remove_dir_all(target);
    }
    update?;
    Ok(())
}

pub async fn run_export(state: &AppState, id: &str, operation: &Operation, notify: impl Fn()) {
    export::run(state, id, &operation.cancellation(), notify).await;
}

#[derive(Deserialize)]
pub struct FromSong {
    pub song_id: String,
    pub model_id: String,
    #[serde(default)]
    pub vocals_and_instrumental: bool,
}

pub async fn from_song(state: &AppState, input: FromSong) -> Result<String> {
    let catalog = model::catalog(state)?;
    let model = catalog
        .models
        .into_iter()
        .find(|model| model.profile.id == input.model_id)
        .ok_or_else(|| message("stem_model_unknown"))?;
    let pin = model
        .active
        .filter(|_| model.status == "ready")
        .ok_or_else(|| message("stem_model_missing"))?;
    let source = source::song(state, &input.song_id).await?;
    let outputs = if input.vocals_and_instrumental {
        vec!["vocals".into(), "instrumental".into()]
    } else {
        model
            .profile
            .roles
            .iter()
            .map(|role| (*role).into())
            .collect()
    };
    enqueue(
        state,
        Request {
            source_id: source.id,
            pin: pin.pin,
            name: source.name.chars().take(160).collect(),
            folder_id: None,
            start: 0.0,
            end: None,
            quality: Quality::Standard,
            overlap: 0.25,
            outputs,
            preview: false,
        },
    )
}
