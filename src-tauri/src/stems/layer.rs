use super::{engine, file, jobs, managed_dir, mix, model, source, valid_id};
use crate::{
    error::{message, Error, Result},
    state::AppState,
    types::{id, now},
};
use rusqlite::params;
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

const ROLE_PREFIX: &str = "layer_";

pub fn is_role(role: &str) -> bool {
    role.strip_prefix(ROLE_PREFIX).is_some_and(valid_id)
}

#[derive(Serialize)]
pub struct Layer {
    pub role: String,
    pub name: String,
}

pub(super) fn registered<'a>(state: &AppState, project_id: &str, role: &'a str) -> Result<&'a str> {
    let id = role
        .strip_prefix(ROLE_PREFIX)
        .filter(|id| valid_id(id))
        .ok_or_else(|| message("stem_asset_missing"))?;
    let exists: bool = state.db.lock().query_row(
        "SELECT EXISTS(SELECT 1 FROM stem_layers WHERE id=?1 AND project_id=?2)",
        params![id, project_id],
        |row| row.get(0),
    )?;
    if !exists {
        return Err(message("stem_asset_missing"));
    }
    Ok(id)
}

pub fn path(state: &AppState, project_id: &str, role: &str) -> Result<PathBuf> {
    let id = registered(state, project_id, role)?;
    file(&managed_dir(&state.db.root, "layers", id)?, "aligned.wav")
}

pub fn audio_path(state: &AppState, job: &jobs::Job, role: &str) -> Result<PathBuf> {
    if is_role(role) {
        path(state, &job.id, role)
    } else {
        job.audio_path(&state.db.root, role)
    }
}

pub async fn import(state: &AppState, project_id: &str, input: &Path, name: &str) -> Result<Layer> {
    let operation = state
        .runtime
        .try_begin(crate::runtime::OperationKind::Import)?;
    let cancel = operation.cancellation();
    let project = jobs::get(state, project_id)?.complete()?.clone();
    let source = source::snapshot(state, input, name, None, &cancel).await?;
    let frames =
        (source.audio.frames * u64::from(model::RATE)).div_ceil(u64::from(source.audio.rate));
    if frames > project.frames {
        return Err(message("stem_layer_length"));
    }
    let layer_id = id();
    let target = managed_dir(&state.db.root, "layers", &layer_id)?;
    let root = target.parent().expect("layer folder");
    std::fs::create_dir_all(root)?;
    crate::download::ensure_space(root, project.frames * 8 + 1024)?;
    let staging = tempfile::Builder::new()
        .prefix(".layer-")
        .tempdir_in(root)?;
    let config = staging.path().join("alignment.json");
    let output = staging.path().join("aligned.wav");
    std::fs::write(
        &config,
        serde_json::to_vec(&serde_json::json!({
            "input": source.audio_path(&state.db.root)?, "first": 0, "frames": source.audio.frames,
            "source_rate": source.audio.rate, "target_frames": frames, "output": output,
        }))?,
    )?;
    engine::execute(
        state,
        "align",
        &[config.as_os_str().to_owned()],
        &cancel,
        Duration::from_secs(90),
        |_| {},
        "stem_output_alignment",
    )
    .await?;
    if frames < project.frames {
        let padded = staging.path().join("padded.wav");
        super::wave::pad_stereo(&output, &padded, frames, project.frames, &cancel)?;
        std::fs::remove_file(&output)?;
        std::fs::rename(padded, &output)?;
    }
    mix::verify_wave(&output, project.frames, &cancel)?;
    std::fs::remove_file(config)?;
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    std::fs::rename(staging.path(), &target)?;
    let result = state.db.lock().execute(
        "INSERT INTO stem_layers(id,project_id,source_id,created_at) VALUES(?1,?2,?3,?4)",
        params![layer_id, project_id, source.id, now()],
    );
    if result.is_err() {
        let _ = std::fs::remove_dir_all(target);
    }
    result?;
    Ok(Layer {
        role: format!("{ROLE_PREFIX}{layer_id}"),
        name: source.name,
    })
}
