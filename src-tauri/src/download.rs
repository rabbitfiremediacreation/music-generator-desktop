use crate::{
    error::{message, Error, Result},
    manifest::Model,
    verification::{ModelVerifier, Verification},
};
use futures_util::StreamExt;
use reqwest::{
    header::{CONTENT_RANGE, RANGE},
    StatusCode,
};
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    time::Instant,
};
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;

#[derive(Clone, Serialize)]
pub struct DownloadProgress {
    pub file: String,
    pub phase: &'static str,
    pub downloaded: u64,
    pub total: u64,
    pub bytes_per_second: u64,
}

// A partial response is only appendable when its start and declared size agree.
pub fn range_total(value: &str, offset: u64) -> Option<u64> {
    let (range, total) = value.strip_prefix("bytes ")?.split_once('/')?;
    let (start, end) = range.split_once('-')?;
    let start: u64 = start.parse().ok()?;
    let end: u64 = end.parse().ok()?;
    let total: u64 = total.parse().ok()?;
    (start == offset && end >= start && end < total).then_some(total)
}

pub fn ensure_space(root: &Path, bytes: u64) -> Result<()> {
    let available = fs2::available_space(root).map_err(|error| {
        message(format!(
            "Could not check free disk space in \"{}\": {error}",
            root.display()
        ))
    })?;
    check_space(root, bytes, available)
}

fn check_space(root: &Path, required: u64, available: u64) -> Result<()> {
    if available < required {
        return Err(message(format!(
            "Not enough free disk space in \"{}\": required {required} bytes ({:.1} MiB), available {available} bytes ({:.1} MiB)",
            root.display(),
            required as f64 / (1024.0 * 1024.0),
            available as f64 / (1024.0 * 1024.0),
        )));
    }
    Ok(())
}

pub async fn download_model(
    client: &reqwest::Client,
    url: &str,
    root: &Path,
    model: &Model,
    verifier: &mut ModelVerifier,
    cancel: &CancellationToken,
    progress: impl Fn(DownloadProgress),
) -> Result<PathBuf> {
    tokio::fs::create_dir_all(root).await?;
    let target = root.join(&model.file);
    let verify_progress = |downloaded, total| {
        progress(DownloadProgress {
            file: model.file.clone(),
            phase: "verifying",
            downloaded,
            total,
            bytes_per_second: 0,
        })
    };
    if target.exists() {
        if verifier
            .verify(&target, &model.sha256, cancel, verify_progress)
            .await?
            != Verification::Invalid
        {
            return Ok(target);
        }
        return Err(message(format!("{} failed verification. Choose a different model folder or remove the damaged file before retrying.", model.file)));
    }
    let partial = root.join(format!("{}.part", model.file));
    let offset = tokio::fs::metadata(&partial)
        .await
        .map(|m| m.len())
        .unwrap_or(0);
    let response = tokio::select! {
        _ = cancel.cancelled() => return Err(Error::Cancelled),
        response = client.get(url).header(RANGE, format!("bytes={offset}-")).send() => response?,
    };
    // A fully downloaded .part may remain after cancellation during checksum verification.
    if response.status() == StatusCode::RANGE_NOT_SATISFIABLE && offset > 0 {
        if verifier
            .verify(&partial, &model.sha256, cancel, verify_progress)
            .await?
            != Verification::Invalid
        {
            if cancel.is_cancelled() {
                return Err(Error::Cancelled);
            }
            verifier.promote(&partial, &target)?;
            return Ok(target);
        }
        tokio::fs::remove_file(&partial).await?;
        return Err(message(
            "Partial download is invalid; retry to download from the beginning",
        ));
    }
    let response = response.error_for_status()?;
    let (append, total) = if response.status() == StatusCode::PARTIAL_CONTENT {
        let total = response
            .headers()
            .get(CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| range_total(v, offset))
            .ok_or_else(|| message("Invalid Content-Range; refusing to append download"))?;
        (true, total)
    } else if response.status() == StatusCode::OK {
        (
            false,
            response.content_length().unwrap_or(model.estimated_bytes),
        )
    } else {
        return Err(message("Unexpected download response"));
    };
    let mut downloaded = if append { offset } else { 0 };
    ensure_space(
        root,
        total
            .saturating_sub(downloaded)
            .saturating_add(64 * 1024 * 1024),
    )?;
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(append)
        .truncate(!append)
        .open(&partial)
        .await?;
    let mut stream = response.bytes_stream();
    let start = Instant::now();
    let initial = downloaded;
    let mut last = Instant::now();
    loop {
        let chunk = tokio::select! { _ = cancel.cancelled() => { file.flush().await?; return Err(Error::Cancelled); }, chunk = stream.next() => chunk };
        let Some(chunk) = chunk else {
            break;
        };
        let chunk = chunk?;
        file.write_all(&chunk).await?;
        downloaded += chunk.len() as u64;
        if last.elapsed().as_millis() >= 200 {
            progress(DownloadProgress {
                file: model.file.clone(),
                phase: "downloading",
                downloaded,
                total,
                bytes_per_second: ((downloaded - initial) as f64
                    / start.elapsed().as_secs_f64().max(0.01))
                    as u64,
            });
            last = Instant::now();
        }
    }
    file.flush().await?;
    file.sync_all().await?;
    drop(file);
    if verifier
        .verify(&partial, &model.sha256, cancel, verify_progress)
        .await?
        == Verification::Invalid
    {
        tokio::fs::remove_file(&partial).await?;
        return Err(message(format!(
            "Checksum mismatch for {}; retry the download",
            model.file
        )));
    }
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    verifier.promote(&partial, &target)?;
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disk_space_boundary_and_diagnostics() {
        let root = Path::new("CUDA data/Größe");
        assert!(check_space(root, 1024, 1024).is_ok());
        assert!(check_space(root, 1024, 1025).is_ok());
        let error = check_space(root, 1024, 1023).unwrap_err().to_string();
        assert!(error.contains(&root.display().to_string()));
        assert!(error.contains("required 1024 bytes"));
        assert!(error.contains("available 1023 bytes"));
        assert!(check_space(root, u64::MAX, u64::MAX - 1).is_err());
        assert!(check_space(root, 0, 0).is_ok());
    }
}
