use super::{
    install::{install_archive, install_from_url, remove},
    *,
};
use crate::error::Error;
use sha2::{Digest, Sha256};
use std::io::Write;
use tokio_util::sync::CancellationToken;

fn archive(data: &Path, revision: &str, executable: &[u8]) -> (Package, PathBuf) {
    let path = data.join(format!("{revision}.zip"));
    let mut archive = zip::ZipWriter::new(fs::File::create(&path).unwrap());
    archive
        .start_file(
            ACE_ENTRY,
            zip::write::SimpleFileOptions::default().unix_permissions(0o755),
        )
        .unwrap();
    archive.write_all(executable).unwrap();
    archive.finish().unwrap();
    let bytes = fs::read(&path).unwrap();
    (
        Package {
            id: "ace-step".into(),
            executable: ACE_ENTRY.into(),
            additional_executables: Vec::new(),
            revision: revision.into(),
            file: format!("{revision}.zip"),
            sha256: format!("{:x}", Sha256::digest(&bytes)),
            bytes: bytes.len() as u64,
            unpacked_bytes: executable.len() as u64,
        },
        path,
    )
}

#[tokio::test]
async fn shared_pytorch_requires_both_runners_before_retiring_old_packages() {
    let root = tempfile::tempdir().unwrap();
    let data = root.path();
    let (mut package, zip) = archive(data, "shared", b"mimetic runner");
    package.id = "pytorch".into();
    let midi = "engine/text2midi/text2midi-runner";
    package.additional_executables.push(midi.into());
    assert!(package.has_executable(Path::new(midi)));
    for id in LEGACY_PYTORCH_PACKAGES {
        fs::create_dir_all(package_root(data, id)).unwrap();
        fs::write(package_root(data, id).join("current.json"), "{}").unwrap();
    }
    fs::create_dir_all(package.root(data)).unwrap();
    let token = CancellationToken::new();
    assert!(install_archive(&package, data, zip.clone(), &token)
        .await
        .is_err());
    assert!(package.has_legacy_pytorch(data));
    assert!(package.installed(data).is_none());

    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&zip)
        .unwrap();
    let mut writer = zip::ZipWriter::new_append(file).unwrap();
    writer
        .start_file(midi, zip::write::SimpleFileOptions::default())
        .unwrap();
    writer.write_all(b"midi runner").unwrap();
    writer.finish().unwrap();
    let bytes = fs::read(&zip).unwrap();
    package.bytes = bytes.len() as u64;
    package.sha256 = format!("{:x}", Sha256::digest(bytes));
    package.unpacked_bytes += b"midi runner".len() as u64;
    install_archive(&package, data, zip, &token).await.unwrap();
    let (_, installed) = package.installed(data).unwrap();
    assert!(installed.join(midi).is_file());
    assert!(!package.has_legacy_pytorch(data));
    remove(&package, data).unwrap();
    assert!(package.installed(data).is_none());
}

#[tokio::test]
async fn an_invalid_or_cancelled_update_keeps_the_previous_installation() {
    let root = tempfile::tempdir().unwrap();
    let data = root.path();
    let (before, first) = archive(data, "before", b"previous");
    let (next, update) = archive(data, "next", b"replacement");
    fs::create_dir_all(before.root(data)).unwrap();
    let token = CancellationToken::new();
    install_archive(&before, data, first.clone(), &token)
        .await
        .unwrap();
    let (_, current) = before.installed(data).unwrap();

    assert_eq!(
        install_archive(&next, data, first, &token)
            .await
            .unwrap_err()
            .to_string(),
        "engine_package_invalid",
    );
    let cancelled = CancellationToken::new();
    cancelled.cancel();
    assert!(matches!(
        install_archive(&next, data, update.clone(), &cancelled).await,
        Err(Error::Cancelled)
    ));
    assert_eq!(fs::read(current.join(ACE_ENTRY)).unwrap(), b"previous");
    assert_eq!(before.installed(data).unwrap().1, current);
    let resources = data.join("app");
    let status =
        serde_json::to_value(status::package_status(&next, &resources, data, &[])).unwrap();
    assert_eq!(status["update_available"], true);
    assert_eq!(status["installed_version"]["revision"], "before");
    assert_eq!(status["available_version"]["revision"], "next");

    install_archive(&next, data, update, &token).await.unwrap();
    let (installed, active) = next.installed(data).unwrap();
    assert_eq!(installed.revision, "next");
    assert_eq!(fs::read(active.join(ACE_ENTRY)).unwrap(), b"replacement");
    assert!(!current.exists());
}

#[test]
fn lists_packaged_audio_cpp_version_without_a_minimax_preview() {
    let root = tempfile::tempdir().unwrap();
    let resources = root.path().join("app");
    let profiles = crate::catalog::catalog().profiles;
    let runtime = &profiles
        .iter()
        .find(|profile| profile.selection.provider == "heartmula")
        .unwrap()
        .runtime;
    let (mut package, _) = archive(root.path(), "audio", b"payload");
    package.executable = runtime
        .packaged_executable
        .clone()
        .unwrap_or_else(|| runtime.executable.clone());
    package.revision = format!("{}:macos-plugin-v1", runtime.revision);
    let audio = serde_json::to_value(status::package_status(
        &package,
        &resources,
        root.path(),
        &profiles,
    ))
    .unwrap();
    assert_eq!(audio["available_version"]["tag"], "v0.9.5");
    assert!(audio["installed_version"].is_null());

    let inventory = serde_json::to_value(status::inventory(&resources, root.path())).unwrap();
    assert!(inventory
        .as_array()
        .unwrap()
        .iter()
        .all(|engine| engine["id"] != "minimax-music3"));
}

#[tokio::test]
async fn downloads_updates_and_removes_only_the_requested_engine() {
    use axum::{routing::get, Router};

    let root = tempfile::tempdir().unwrap();
    let data = root.path();
    let (before, first) = archive(data, "before", b"previous");
    let (next, update) = archive(data, "next", b"replacement");
    let first = fs::read(first).unwrap();
    let update = fs::read(update).unwrap();
    let server = Router::new()
        .route("/before.zip", get(move || async move { first }))
        .route("/next.zip", get(move || async move { update }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, server).await.unwrap() });
    let models = data.join("models");
    fs::create_dir(&models).unwrap();
    fs::write(models.join("model.gguf"), b"weights").unwrap();
    let token = CancellationToken::new();

    for package in [&before, &next] {
        let url = format!("{origin}/{}", package.file);
        install_from_url(package, data, &url, &token, |_| {})
            .await
            .unwrap();
        let (installed, _) = package.installed(data).unwrap();
        assert_eq!(installed.revision, package.revision);
        assert_eq!(installed.sha256, package.sha256);
    }
    // Only the active payload and current.json remain after a successful update.
    assert_eq!(fs::read_dir(next.root(data)).unwrap().count(), 2);
    let (unpublished, _) = archive(data, "unpublished", b"unpublished");
    let unavailable = install_from_url(
        &unpublished,
        data,
        &format!("{origin}/{}", unpublished.file),
        &token,
        |_| {},
    )
    .await;
    assert_eq!(
        unavailable.unwrap_err().to_string(),
        "engine_package_unavailable"
    );
    assert_eq!(next.installed(data).unwrap().0.revision, next.revision);

    let mut other = before.clone();
    other.id = "other".into();
    fs::create_dir_all(other.root(data)).unwrap();
    fs::write(other.root(data).join("keep"), b"other engine").unwrap();
    remove(&next, data).unwrap();
    remove(&next, data).unwrap();
    assert!(next.installed(data).is_none());
    assert!(!next.root(data).exists());
    assert!(!next.removed_root(data).exists());
    assert!(other.root(data).join("keep").is_file());
    assert_eq!(fs::read(models.join("model.gguf")).unwrap(), b"weights");
    server.abort();
}
