use super::{engine, get, hub, installed_file, FilePin, Pin, Profile};
use crate::{
    download::{self, DownloadProgress},
    error::{message, Error, Result},
    state::AppState,
    verification::ModelVerifier,
};
use rusqlite::{params, OptionalExtension};
use std::path::Path;
use tokio_util::sync::CancellationToken;

async fn resolve(
    state: &AppState,
    profile: &Profile,
    pin: &Pin,
    cancel: &CancellationToken,
) -> Result<FilePin> {
    if let Some(artifact) = installed_file(state, pin)? {
        return Ok(artifact);
    }
    if *pin == profile.pin() {
        return Ok(profile.artifact.pinned());
    }
    let pending = state.db.lock().query_row(
        "SELECT artifact FROM stem_model_transfers WHERE model=?1 AND repository=?2 AND revision=?3",
        params![pin.model, pin.repository, pin.revision], |row| crate::db::parse_json(row.get(0)?),
    ).optional()?;
    if let Some(artifact) = pending {
        return Ok(artifact);
    }
    let exact = hub::hub_info(&state.db.root, &pin.repository, Some(&pin.revision), cancel).await?;
    exact
        .candidate(profile)
        .filter(|(candidate, _)| candidate == pin)
        .map(|(_, artifact)| artifact)
        .ok_or_else(|| message("stem_model_unconfirmed"))
}

/// Retain the active revision while a new immutable artifact downloads and passes the adapter probe.
pub async fn install(
    state: &AppState,
    pin: &Pin,
    cancel: &CancellationToken,
    progress: impl Fn(DownloadProgress),
) -> Result<()> {
    let result = install_revision(state, pin, cancel, progress).await;
    if let Err(error) = &result {
        if !matches!(error, Error::Cancelled) {
            let _ = state.db.lock().execute(
                "UPDATE stem_model_transfers SET error=?4 WHERE model=?1 AND repository=?2 AND revision=?3",
                params![pin.model, pin.repository, pin.revision, error.to_string()],
            );
        }
    }
    result
}

async fn install_revision(
    state: &AppState,
    pin: &Pin,
    cancel: &CancellationToken,
    progress: impl Fn(DownloadProgress),
) -> Result<()> {
    let profile = get(&pin.model)?;
    if !engine::installed(state) {
        return Err(message("stem_engine_missing"));
    }
    let artifact = resolve(state, profile, pin, cancel).await?;
    let settings = state.db.settings()?;
    let models = Path::new(&settings.models_dir);
    let path = artifact.checked_path(models)?;
    let pending: Option<(String, String)> = state
        .db
        .lock()
        .query_row(
            "SELECT repository,revision FROM stem_model_transfers WHERE model=?1",
            [&pin.model],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    if pending.is_some_and(|pending| pending != (pin.repository.clone(), pin.revision.clone())) {
        return Err(message("stem_pending_conflict"));
    }
    let file_data = serde_json::to_string(&artifact)?;
    state.db.lock().execute(
        "INSERT INTO stem_model_transfers(model,repository,revision,artifact) VALUES(?1,?2,?3,?4)
         ON CONFLICT(model) DO UPDATE SET repository=excluded.repository,revision=excluded.revision,artifact=excluded.artifact,error=NULL",
        params![pin.model, pin.repository, pin.revision, file_data],
    )?;
    let mut verifier = ModelVerifier::open(&state.db.root);
    let client = download::client()?;
    let files = profile.files(&artifact);
    let total = files.iter().map(|file| file.bytes).sum();
    let mut downloaded = 0;
    for file in &files {
        let report = |update: DownloadProgress| {
            progress(DownloadProgress {
                file: artifact.file.clone(),
                phase: update.phase,
                total,
                downloaded: downloaded + update.downloaded,
                bytes_per_second: update.bytes_per_second,
            })
        };
        let target = file.checked_path(models)?;
        let folder = file.folder(models);
        std::fs::create_dir_all(&folder)?;
        let specification = file.specification();
        if target.exists() {
            match download::verify_model(&target, &specification, &mut verifier, cancel, &report)
                .await
            {
                Ok(()) => {}
                Err(Error::Cancelled) => return Err(Error::Cancelled),
                Err(_) => std::fs::remove_file(&target)?,
            }
        }
        // The manifest identity comes from the app catalog or a reviewed Hub revision.
        let url = format!(
            "https://huggingface.co/{}/resolve/{}/{}",
            pin.repository, pin.revision, file.file
        );
        download::fetch(
            || crate::hugging_face_token::get(&client, &url, &state.db.root),
            Some(file.bytes),
            &folder,
            &specification,
            &mut verifier,
            cancel,
            report,
        )
        .await
        .map_err(hub::download_error)?;
        downloaded += file.bytes;
    }
    let config = std::fs::read_to_string(profile.configuration.pinned().path(models))?;
    let signature = Path::new(&artifact.file)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .ok_or_else(|| message("stem_model_incompatible"))?;
    if config.trim_end() != format!("models: ['{signature}']") {
        return Err(message("stem_model_incompatible"));
    }
    engine::check_weights(state, &path, profile.roles, cancel).await?;
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    let mut con = state.db.lock();
    let tx = con.transaction()?;
    tx.execute(
        "UPDATE stem_models SET active=0 WHERE model=?1",
        [&pin.model],
    )?;
    tx.execute(
        "INSERT INTO stem_models(model,repository,revision,active,installed_at,artifact) VALUES(?1,?2,?3,1,?4,?5)
         ON CONFLICT(model,repository,revision) DO UPDATE SET active=1",
        params![pin.model, pin.repository, pin.revision, crate::types::now(), file_data],
    )?;
    tx.execute(
        "DELETE FROM stem_model_transfers WHERE model=?1",
        [&pin.model],
    )?;
    tx.commit()?;
    Ok(())
}

pub fn discard(state: &AppState, id: &str) -> Result<()> {
    let profile = get(id)?;
    let models = state.db.settings()?.models_dir;
    let models = Path::new(&models);
    let mut con = state.db.lock();
    let tx = con.transaction()?;
    let pending: Option<FilePin> = tx
        .query_row(
            "SELECT artifact FROM stem_model_transfers WHERE model=?1",
            [id],
            |row| crate::db::parse_json(row.get(0)?),
        )
        .optional()?;
    if let Some(artifact) = pending {
        let shared_weight: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM stem_models WHERE json_extract(artifact,'$.sha256')=?1 AND json_extract(artifact,'$.file')=?2)",
            params![artifact.sha256, artifact.file], |row| row.get(0),
        )?;
        let shared_config: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM stem_models WHERE model=?1)",
            [id],
            |row| row.get(0),
        )?;
        for (file, shared) in profile
            .files(&artifact)
            .into_iter()
            .zip([shared_config, shared_weight])
        {
            let path = file.checked_path(models)?;
            remove_file(&file.partial(models))?;
            if !shared {
                remove_file(&path)?;
            }
        }
        tx.execute("DELETE FROM stem_model_transfers WHERE model=?1", [id])?;
    }
    tx.commit()?;
    Ok(())
}

fn remove_file(path: &Path) -> Result<()> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}
