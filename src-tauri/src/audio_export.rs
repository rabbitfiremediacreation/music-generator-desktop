use crate::{
    engine::process::OwnedProcess,
    error::{message, Error, Result},
};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    time::{Duration, UNIX_EPOCH},
};
use tokio_util::sync::CancellationToken;

mod staging;
pub(crate) use staging::cleanup_stale;
use staging::Staging;

pub fn codec_path(resources: &Path) -> PathBuf {
    resources.join("engine").join(if cfg!(windows) {
        "mp3-codec.exe"
    } else {
        "mp3-codec"
    })
}

fn prefix(sid: &str) -> String {
    format!("{:x}-", Sha256::digest(sid.as_bytes()))
}

pub fn remove_cached(root: &Path, sid: &str) {
    let prefix = prefix(sid);
    if let Ok(files) = std::fs::read_dir(root.join("export")) {
        for file in files.flatten() {
            if file.file_name().to_string_lossy().starts_with(&prefix) {
                let _ = std::fs::remove_file(file.path());
            }
        }
    }
}

// Convert a container-local copy; child processes never need external song-folder grants.
pub async fn mp3(
    resources: &Path,
    root: &Path,
    sid: &str,
    source: &Path,
    cancel: &CancellationToken,
) -> Result<PathBuf> {
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    if source
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("mp3"))
    {
        return Ok(source.into());
    }
    let codec = codec_path(resources);
    if !codec.is_file() {
        return Err(message("mp3_failed"));
    }
    let metadata = source.metadata()?;
    let modified = metadata
        .modified()?
        .duration_since(UNIX_EPOCH)
        .map_err(|e| message(e.to_string()))?
        .as_nanos();
    let cache = root.join("export");
    std::fs::create_dir_all(&cache)?;
    std::fs::create_dir_all(root.join("logs"))?;
    let target = cache.join(format!(
        "{}{}-{modified}-192.mp3",
        prefix(sid),
        metadata.len()
    ));
    if target.metadata().is_ok_and(|m| m.len() >= 1000) {
        return Ok(target);
    }
    let staging = Staging::new(&cache)?;
    let input = staging.path().join("source.wav");
    let output = staging.path().join("encoded.mp3");
    staging.copy_source(source).await?;
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    let args = vec![
        "-i".into(),
        input.to_string_lossy().into_owned(),
        "-o".into(),
        output.to_string_lossy().into_owned(),
        "-b".into(),
        "192".into(),
    ];
    let mut process = OwnedProcess::spawn(&codec, &args, false, &root.join("logs/export.log"))
        .map_err(|error| {
            tracing::warn!("MP3 converter launch failed: {error}");
            message("mp3_failed")
        })?;
    let wait = async {
        loop {
            if let Some(status) = process.status()? {
                return Ok::<_, crate::error::Error>(status.success());
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    };
    let success = tokio::select! {
        _ = cancel.cancelled() => return Err(Error::Cancelled),
        result = tokio::time::timeout(Duration::from_secs(180), wait) => result.ok().and_then(|r| r.ok()).unwrap_or(false),
    };
    if !success || !output.metadata().is_ok_and(|m| m.len() >= 1000) {
        return Err(message("mp3_failed"));
    }
    let current = source.metadata()?;
    if current.len() != metadata.len() || current.modified()? != metadata.modified()? {
        return Err(message("mp3_failed"));
    }
    std::fs::rename(&output, &target)?;
    Ok(target)
}
