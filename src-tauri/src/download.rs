use crate::{
    error::{message, Error, Result},
    manifest::Model,
    verification::{ModelVerifier, Verification},
};
use futures_util::StreamExt;
use reqwest::{
    header::{CONTENT_RANGE, RANGE},
    RequestBuilder, StatusCode,
};
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;

mod events;
pub(crate) mod queue;
pub(crate) use events::ProgressEvents;

#[derive(Clone, Serialize)]
pub struct DownloadProgress {
    pub file: String,
    pub phase: &'static str,
    pub downloaded: u64,
    pub total: u64,
    pub bytes_per_second: u64,
}

pub(crate) fn client() -> Result<reqwest::Client> {
    let redirects = reqwest::redirect::Policy::default();
    Ok(reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .read_timeout(Duration::from_secs(60))
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.url().scheme() != "https"
                && attempt
                    .previous()
                    .last()
                    .is_some_and(|url| url.scheme() == "https")
            {
                return attempt.error("Download redirect must preserve HTTPS");
            }
            redirects.redirect(attempt)
        }))
        .build()?)
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

fn verification_progress<'a>(
    model: &'a Model,
    progress: &'a impl Fn(DownloadProgress),
) -> impl Fn(u64, u64) + 'a {
    move |downloaded, total| {
        progress(DownloadProgress {
            file: model.file.clone(),
            phase: "verifying",
            downloaded,
            total,
            bytes_per_second: 0,
        })
    }
}

pub async fn verify_model(
    path: &Path,
    model: &Model,
    verifier: &mut ModelVerifier,
    cancel: &CancellationToken,
    progress: impl Fn(DownloadProgress),
) -> Result<()> {
    if path.metadata()?.len() != model.estimated_bytes
        || verifier
            .verify(
                path,
                &model.sha256,
                cancel,
                verification_progress(model, &progress),
            )
            .await?
            == Verification::Invalid
    {
        return Err(message(format!(
            "{} failed verification. Replace the damaged file before retrying.",
            model.file
        )));
    }
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
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
    fetch(
        || Ok(client.get(url)),
        None,
        root,
        model,
        verifier,
        cancel,
        progress,
    )
    .await
}

pub async fn download_pinned_model(
    client: &reqwest::Client,
    url: &str,
    root: &Path,
    model: &Model,
    verifier: &mut ModelVerifier,
    cancel: &CancellationToken,
    progress: impl Fn(DownloadProgress),
) -> Result<PathBuf> {
    fetch(
        || Ok(client.get(url)),
        Some(model.estimated_bytes),
        root,
        model,
        verifier,
        cancel,
        progress,
    )
    .await
}

pub(crate) async fn fetch(
    request: impl FnOnce() -> Result<RequestBuilder>,
    pinned_bytes: Option<u64>,
    root: &Path,
    model: &Model,
    verifier: &mut ModelVerifier,
    cancel: &CancellationToken,
    progress: impl Fn(DownloadProgress),
) -> Result<PathBuf> {
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    tokio::fs::create_dir_all(root).await?;
    let canonical = root.canonicalize()?;
    let target = canonical.join(&model.file);
    if verifier.is_verified(&target, &model.sha256)
        && pinned_bytes.is_none_or(|bytes| target.metadata().is_ok_and(|file| file.len() == bytes))
    {
        return Ok(root.join(&model.file));
    }
    let task = queue::Task::begin(&model.file, model.estimated_bytes, cancel);
    let result = async {
        let _permit = task.acquire(&target).await?;
        fetch_file(
            request,
            pinned_bytes,
            root,
            model,
            verifier,
            task.cancellation(),
            |update| {
                task.progress(&update);
                progress(update);
            },
        )
        .await
    }
    .await;
    task.finish(&result);
    result
}

async fn fetch_file(
    request: impl FnOnce() -> Result<RequestBuilder>,
    pinned_bytes: Option<u64>,
    root: &Path,
    model: &Model,
    verifier: &mut ModelVerifier,
    cancel: &CancellationToken,
    progress: impl Fn(DownloadProgress),
) -> Result<PathBuf> {
    let target = root.join(&model.file);
    if let Some(parent) = target.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let verify_progress = verification_progress(model, &progress);
    if target.exists() {
        if pinned_bytes.is_some() {
            verify_model(&target, model, verifier, cancel, &progress).await?;
            return Ok(target);
        }
        if verifier
            .verify(&target, &model.sha256, cancel, &verify_progress)
            .await?
            != Verification::Invalid
        {
            return Ok(target);
        }
        return Err(message(format!("{} failed verification. Choose a different model folder or remove the damaged file before retrying.", model.file)));
    }
    let partial = root.join(format!("{}.part", model.file));
    let mut offset = tokio::fs::metadata(&partial)
        .await
        .map(|m| m.len())
        .unwrap_or(0);
    if let Some(size) = pinned_bytes.filter(|size| offset >= *size) {
        if offset == size
            && verifier
                .verify(&partial, &model.sha256, cancel, &verify_progress)
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
        offset = 0;
    }
    let request = request()?.header(RANGE, format!("bytes={offset}-"));
    let response = tokio::select! {
        _ = cancel.cancelled() => return Err(Error::Cancelled),
        response = request.send() => response.map_err(reqwest::Error::without_url)?,
    };
    // A fully downloaded .part may remain after cancellation during checksum verification.
    if response.status() == StatusCode::RANGE_NOT_SATISFIABLE && offset > 0 {
        if verifier
            .verify(&partial, &model.sha256, cancel, &verify_progress)
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
    if matches!(
        response.status(),
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN
    ) && crate::hugging_face_token::is_hub(response.url())
    {
        return Err(message("hf_download_auth"));
    }
    let response = response
        .error_for_status()
        .map_err(reqwest::Error::without_url)?;
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
    if pinned_bytes.is_some_and(|size| size != total) {
        return Err(message(format!(
            "Unexpected download size for {}",
            model.file
        )));
    }
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
    let report_download = |downloaded| {
        progress(DownloadProgress {
            file: model.file.clone(),
            phase: "downloading",
            downloaded,
            total,
            bytes_per_second: ((downloaded - initial) as f64
                / start.elapsed().as_secs_f64().max(0.01)) as u64,
        });
    };
    report_download(downloaded);
    loop {
        let chunk = tokio::select! { _ = cancel.cancelled() => { file.flush().await?; return Err(Error::Cancelled); }, chunk = stream.next() => chunk };
        let Some(chunk) = chunk else {
            break;
        };
        let chunk = chunk.map_err(reqwest::Error::without_url)?;
        downloaded += chunk.len() as u64;
        if pinned_bytes.is_some_and(|size| downloaded > size) {
            return Err(message(format!(
                "Download exceeded the pinned size for {}",
                model.file
            )));
        }
        file.write_all(&chunk).await?;
        if last.elapsed().as_millis() >= 200 {
            report_download(downloaded);
            last = Instant::now();
        }
    }
    file.flush().await?;
    file.sync_all().await?;
    drop(file);
    if pinned_bytes.is_some_and(|size| size != downloaded) {
        return Err(message(format!(
            "Incomplete download for {}; resume the download",
            model.file
        )));
    }
    if verifier
        .verify(&partial, &model.sha256, cancel, &verify_progress)
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

    #[tokio::test]
    async fn authenticated_resume_drops_credentials_at_the_redirect_destination() {
        use axum::{
            http::{header::AUTHORIZATION, HeaderMap},
            response::Redirect,
            routing::get,
            Router,
        };
        use sha2::{Digest, Sha256};

        let cdn = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let cdn_url = format!("http://{}/file", cdn.local_addr().unwrap());
        let cdn_task = tokio::spawn(async move {
            let routes = Router::new().route(
                "/file",
                get(|headers: HeaderMap| async move {
                    assert!(!headers.contains_key(AUTHORIZATION));
                    assert_eq!(headers[RANGE], "bytes=3-");
                    (
                        StatusCode::PARTIAL_CONTENT,
                        [(CONTENT_RANGE, "bytes 3-5/6")],
                        "def",
                    )
                }),
            );
            axum::serve(cdn, routes).await.unwrap();
        });
        let hub = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let hub_url = format!("http://{}/model", hub.local_addr().unwrap());
        let hub_task = tokio::spawn(async move {
            let routes = Router::new().route(
                "/model",
                get(move |headers: HeaderMap| {
                    let cdn_url = cdn_url.clone();
                    async move {
                        assert_eq!(headers[AUTHORIZATION], "Bearer hf_test-example");
                        assert_eq!(headers[RANGE], "bytes=3-");
                        Redirect::temporary(&cdn_url)
                    }
                }),
            );
            axum::serve(hub, routes).await.unwrap();
        });

        let root = tempfile::tempdir().unwrap();
        let root = root.path();
        let client = client().unwrap();
        let model = Model {
            file: "model.gguf".into(),
            estimated_bytes: 6,
            sha256: format!("{:x}", Sha256::digest(b"abcdef")),
            kind: "required".into(),
        };
        std::fs::write(root.join("model.gguf.part"), b"abc").unwrap();
        let result = fetch(
            || Ok(client.get(hub_url).bearer_auth("hf_test-example")),
            Some(model.estimated_bytes),
            root,
            &model,
            &mut ModelVerifier::open(root),
            &CancellationToken::new(),
            |_| {},
        )
        .await;
        hub_task.abort();
        cdn_task.abort();
        assert_eq!(std::fs::read(result.unwrap()).unwrap(), b"abcdef");
    }

    #[tokio::test]
    async fn corrupt_resume_is_never_promoted() {
        use axum::{http::HeaderMap, routing::get, Router};
        use sha2::{Digest, Sha256};

        let server = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/model", server.local_addr().unwrap());
        let task = tokio::spawn(async move {
            let app = Router::new().route(
                "/model",
                get(|headers: HeaderMap| async move {
                    assert_eq!(headers[RANGE], "bytes=3-");
                    (
                        StatusCode::PARTIAL_CONTENT,
                        [(CONTENT_RANGE, "bytes 3-5/6")],
                        "def",
                    )
                }),
            );
            axum::serve(server, app).await.unwrap();
        });
        let root = tempfile::tempdir().unwrap();
        let root = root.path();
        let model = Model {
            file: "weights.safetensors".into(),
            estimated_bytes: 6,
            sha256: format!("{:x}", Sha256::digest(b"abcdef")),
            kind: "stem-separation".into(),
        };
        std::fs::write(root.join("weights.safetensors.part"), b"bad").unwrap();
        let result = download_pinned_model(
            &client().unwrap(),
            &url,
            root,
            &model,
            &mut ModelVerifier::open(root),
            &CancellationToken::new(),
            |_| {},
        )
        .await;
        task.abort();
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("Checksum mismatch"));
        assert!(!root.join("weights.safetensors").exists());
        assert!(!root.join("weights.safetensors.part").exists());
    }

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
