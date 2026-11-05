use axum::{
    body::Body,
    http::{header::CONTENT_RANGE, StatusCode},
    response::Response,
    routing::get,
    Router,
};
use music_generator::{
    download::{download_model, ensure_space, range_total},
    manifest::Model,
    verification::{ModelVerifier, Verification},
};
use sha2::{Digest, Sha256};
use std::sync::{
    atomic::{AtomicU32, Ordering},
    Arc,
};
use tokio_util::sync::CancellationToken;

fn model() -> Model {
    Model {
        file: "model.gguf".into(),
        estimated_bytes: 6,
        sha256: format!("{:x}", Sha256::digest(b"abcdef")),
        kind: "required".into(),
    }
}
async fn server(
    status: StatusCode,
    range: Option<&'static str>,
    body: &'static [u8],
) -> (String, tokio::task::JoinHandle<()>, Arc<AtomicU32>) {
    let calls = Arc::new(AtomicU32::new(0));
    let count = calls.clone();
    let router = Router::new().route(
        "/model",
        get(move || {
            let calls = count.clone();
            async move {
                calls.fetch_add(1, Ordering::SeqCst);
                let mut response = Response::builder().status(status);
                if let Some(range) = range {
                    response = response.header(CONTENT_RANGE, range);
                }
                response.body(Body::from(body)).unwrap()
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/model", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    (url, task, calls)
}
fn client() -> reqwest::Client {
    reqwest::Client::builder().no_proxy().build().unwrap()
}

#[tokio::test]
async fn resumes_partial_content_at_the_exact_offset() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("model.gguf.part"), b"abc").unwrap();
    let (url, task, _) = server(StatusCode::PARTIAL_CONTENT, Some("bytes 3-5/6"), b"def").await;
    let file = download_model(
        &client(),
        &url,
        dir.path(),
        &model(),
        &mut ModelVerifier::open(dir.path()),
        &CancellationToken::new(),
        |_| {},
    )
    .await
    .unwrap();
    assert_eq!(
        ModelVerifier::open(dir.path())
            .verify(
                &file,
                &model().sha256,
                &CancellationToken::new(),
                |_, _| panic!("downloaded models must not be hashed again")
            )
            .await
            .unwrap(),
        Verification::Cached
    );
    assert_eq!(std::fs::read(file).unwrap(), b"abcdef");
    task.abort();
}

#[tokio::test]
async fn a_server_ignoring_range_restarts_without_appending() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("model.gguf.part"), b"abc").unwrap();
    let (url, task, _) = server(StatusCode::OK, None, b"abcdef").await;
    let file = download_model(
        &client(),
        &url,
        dir.path(),
        &model(),
        &mut ModelVerifier::open(dir.path()),
        &CancellationToken::new(),
        |_| {},
    )
    .await
    .unwrap();
    assert_eq!(std::fs::read(file).unwrap(), b"abcdef");
    task.abort();
}

#[tokio::test]
async fn wrong_range_does_not_modify_existing_partial_data() {
    let dir = tempfile::tempdir().unwrap();
    let part = dir.path().join("model.gguf.part");
    std::fs::write(&part, b"abc").unwrap();
    let (url, task, _) = server(StatusCode::PARTIAL_CONTENT, Some("bytes 0-2/6"), b"def").await;
    assert!(download_model(
        &client(),
        &url,
        dir.path(),
        &model(),
        &mut ModelVerifier::open(dir.path()),
        &CancellationToken::new(),
        |_| {}
    )
    .await
    .is_err());
    assert_eq!(std::fs::read(part).unwrap(), b"abc");
    task.abort();
}

#[tokio::test]
async fn wrong_checksums_are_never_promoted_to_models() {
    let dir = tempfile::tempdir().unwrap();
    let (url, task, _) = server(StatusCode::OK, None, b"broken").await;
    assert!(download_model(
        &client(),
        &url,
        dir.path(),
        &model(),
        &mut ModelVerifier::open(dir.path()),
        &CancellationToken::new(),
        |_| {}
    )
    .await
    .is_err());
    assert!(!dir.path().join("model.gguf").exists());
    assert!(!dir.path().join("model.gguf.part").exists());
    task.abort();
}

#[tokio::test]
async fn verified_existing_model_needs_no_network() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("model.gguf"), b"abcdef").unwrap();
    download_model(
        &client(),
        "http://127.0.0.1:1",
        dir.path(),
        &model(),
        &mut ModelVerifier::open(dir.path()),
        &CancellationToken::new(),
        |_| {},
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn cancellation_keeps_partial_data_for_retry() {
    let dir = tempfile::tempdir().unwrap();
    let part = dir.path().join("model.gguf.part");
    std::fs::write(&part, b"abc").unwrap();
    let cancel = CancellationToken::new();
    cancel.cancel();
    assert!(download_model(
        &client(),
        "http://127.0.0.1:1",
        dir.path(),
        &model(),
        &mut ModelVerifier::open(dir.path()),
        &cancel,
        |_| {}
    )
    .await
    .is_err());
    assert_eq!(std::fs::read(part).unwrap(), b"abc");
}

#[tokio::test]
async fn complete_partial_file_recovers_after_verification_was_interrupted() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("model.gguf.part"), b"abcdef").unwrap();
    let (url, task, _) = server(StatusCode::RANGE_NOT_SATISFIABLE, None, b"").await;
    let path = download_model(
        &client(),
        &url,
        dir.path(),
        &model(),
        &mut ModelVerifier::open(dir.path()),
        &CancellationToken::new(),
        |_| {},
    )
    .await
    .unwrap();
    assert_eq!(std::fs::read(path).unwrap(), b"abcdef");
    task.abort();
}

#[test]
fn insufficient_disk_and_invalid_ranges_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let error = ensure_space(dir.path(), u64::MAX).unwrap_err().to_string();
    assert!(error.starts_with("Not enough free disk space"));
    assert!(error.contains(&dir.path().display().to_string()));
    assert!(error.contains("required 18446744073709551615 bytes"));
    assert!(error.contains("available "));
    assert_eq!(range_total("bytes 3-5/6", 3), Some(6));
    assert_eq!(range_total("bytes 3-8/6", 3), None);
    assert_eq!(range_total("bytes 0-5/*", 0), None);
}

// Windows can resolve the volume even for a nonexistent trailing directory.
#[cfg(unix)]
#[test]
fn disk_space_query_failures_include_the_destination() {
    let dir = tempfile::tempdir().unwrap();
    let missing = dir.path().join("missing");
    let error = ensure_space(&missing, 0).unwrap_err().to_string();
    assert!(error.starts_with("Could not check free disk space"));
    assert!(error.contains(&missing.display().to_string()));
}
