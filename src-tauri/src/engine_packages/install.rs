use super::{package_root, release, Installed, Package, LEGACY_PYTORCH_PACKAGES};
use crate::{
    download::{self, DownloadProgress},
    error::{message, Error, Result},
    manifest::Model,
    verification::ModelVerifier,
};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{self, Seek},
    path::{Path, PathBuf},
};
use tokio_util::sync::CancellationToken;

pub(crate) async fn install(
    data: &Path,
    id: &str,
    cancel: &CancellationToken,
    progress: impl Fn(DownloadProgress) + Send + Sync,
) -> Result<()> {
    let package = release()
        .packages
        .iter()
        .find(|package| package.id == id)
        .ok_or_else(|| message("engine_package_unavailable"))?;
    install_from_url(package, data, &release_url(package), cancel, progress).await
}

pub(super) fn release_url(package: &Package) -> String {
    format!(
        "https://github.com/{}/releases/download/{}/{}",
        crate::updates::RELEASE_REPOSITORY,
        release().tag,
        package.file,
    )
}

pub(super) async fn install_from_url(
    package: &Package,
    data: &Path,
    url: &str,
    cancel: &CancellationToken,
    progress: impl Fn(DownloadProgress) + Send + Sync,
) -> Result<()> {
    let file = fetch_archive(package, data, url, cancel, &progress).await?;
    publish_archive(package, data, file, cancel, &progress).await
}

pub(super) async fn publish_archive(
    package: &Package,
    data: &Path,
    file: Option<PathBuf>,
    cancel: &CancellationToken,
    progress: impl Fn(DownloadProgress),
) -> Result<()> {
    if let Some(file) = file {
        progress(installing(&package.file));
        install_archive(package, data, file, cancel).await
    } else {
        remove_legacy_pytorch(package, data);
        Ok(())
    }
}

pub(super) async fn fetch_archive(
    package: &Package,
    data: &Path,
    url: &str,
    cancel: &CancellationToken,
    progress: impl Fn(DownloadProgress),
) -> Result<Option<PathBuf>> {
    if package.installed(data).is_some_and(|(current, _)| {
        current.sha256 == package.sha256 && current.revision == package.revision
    }) {
        return Ok(None);
    }
    let downloads = package.root(data).join("downloads").join(&package.sha256);
    tokio::fs::create_dir_all(&downloads).await?;
    let archive = Model {
        file: package.file.clone(),
        estimated_bytes: package.bytes,
        sha256: package.sha256.clone(),
        kind: "engine".into(),
    };
    let remaining = package.bytes.saturating_sub(
        fs::metadata(downloads.join(&archive.file))
            .or_else(|_| fs::metadata(downloads.join(format!("{}.part", archive.file))))
            .map_or(0, |file| file.len()),
    );
    download::ensure_space(&downloads, remaining + package.unpacked_bytes)?;
    let mut verifier = ModelVerifier::open(data);
    let file = download::download_pinned_model(
        &download::client()?,
        url,
        &downloads,
        &archive,
        &mut verifier,
        cancel,
        &progress,
    )
    .await
    .map_err(|error| match error {
        Error::Http(ref source) if source.status() == Some(reqwest::StatusCode::NOT_FOUND) => {
            message("engine_package_unavailable")
        }
        error => error,
    })?;
    Ok(Some(file))
}

/// Detach the whole package before deleting it so readers never see a partial installation.
pub(super) fn remove(package: &Package, data: &Path) -> Result<()> {
    remove_package_root(data, &package.id)?;
    if package.id == "pytorch" {
        for id in LEGACY_PYTORCH_PACKAGES {
            remove_package_root(data, id)?;
        }
    }
    Ok(())
}

fn remove_package_root(data: &Path, id: &str) -> Result<()> {
    let root = package_root(data, id);
    let removed = root.with_file_name(format!(".removed-{id}"));
    clear_directory(&removed)?;
    match fs::rename(root, &removed) {
        Ok(()) => clear_directory(&removed),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn remove_legacy_pytorch(package: &Package, data: &Path) {
    if package.id == "pytorch" {
        for id in LEGACY_PYTORCH_PACKAGES {
            // Keep the new active installation even if retiring an old copy fails.
            let _ = remove_package_root(data, id);
        }
    }
}

fn clear_directory(directory: &Path) -> Result<()> {
    match fs::remove_dir_all(directory) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

pub(super) fn installing(file: &str) -> DownloadProgress {
    DownloadProgress {
        file: file.into(),
        phase: "installing",
        downloaded: 0,
        total: 0,
        bytes_per_second: 0,
    }
}

pub(super) async fn install_archive(
    package: &Package,
    data: &Path,
    archive: PathBuf,
    cancel: &CancellationToken,
) -> Result<()> {
    let root = package.root(data);
    let staging = {
        let root = root.clone();
        let package = package.clone();
        let cancel = cancel.clone();
        tokio::task::spawn_blocking(move || {
            if !fs::metadata(&archive)?.is_file() {
                return Err(message("engine_package_invalid"));
            }
            unpack(&package, &root, fs::File::open(archive)?, &cancel)
        })
        .await
        .map_err(|error| message(error.to_string()))??
    };
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    activate(package, data, staging)?;
    let _ = tokio::fs::remove_dir_all(root.join("downloads")).await;
    Ok(())
}

pub(super) fn unpack(
    package: &Package,
    root: &Path,
    mut file: fs::File,
    cancel: &CancellationToken,
) -> Result<tempfile::TempDir> {
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    // Verify the file handle that will be used for extraction as well as the resumable download.
    let mut digest = Sha256::new();
    if file.metadata()?.len() != package.bytes
        || io::copy(&mut file, &mut digest)? != package.bytes
        || format!("{:x}", digest.finalize()) != package.sha256
    {
        return Err(message("engine_package_invalid"));
    }
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    file.rewind()?;
    let invalid = |_| message("engine_package_invalid");
    let mut archive = zip::ZipArchive::new(file).map_err(invalid)?;
    let mut size = 0u64;
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(invalid)?;
        if !entry
            .enclosed_name()
            .is_some_and(|name| name.starts_with("engine"))
        {
            return Err(message("engine_package_invalid"));
        }
        size = size
            .checked_add(entry.size())
            .ok_or_else(|| message("engine_package_invalid"))?;
    }
    if size != package.unpacked_bytes {
        return Err(message("engine_package_invalid"));
    }
    let staging = tempfile::Builder::new()
        .prefix(".install-")
        .tempdir_in(root)?;
    archive.extract(staging.path()).map_err(invalid)?;
    if !package.files_ready(staging.path()) {
        return Err(message("engine_package_invalid"));
    }
    Ok(staging)
}

pub(super) fn activate(package: &Package, data: &Path, staging: tempfile::TempDir) -> Result<()> {
    let root = package.root(data);
    let previous = package.installed(data);
    let installed = Installed {
        directory: uuid::Uuid::new_v4().to_string(),
        revision: package.revision.clone(),
        sha256: package.sha256.clone(),
    };
    let destination = root.join(&installed.directory);
    let record = serde_json::to_vec(&installed)?;
    fs::rename(staging.path(), &destination)?;
    if let Err(error) = crate::paths::write_private(&root.join("current.json"), &record) {
        let _ = fs::remove_dir_all(&destination);
        return Err(error);
    }
    if let Some((_, previous)) = previous {
        let _ = fs::remove_dir_all(previous);
    }
    remove_legacy_pytorch(package, data);
    Ok(())
}
