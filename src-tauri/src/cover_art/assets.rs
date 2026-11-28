use super::manifest;
use crate::{
    download::{self, DownloadProgress},
    error::{message, Error, Result},
    verification::{ModelVerifier, Verification},
};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tokio_util::sync::CancellationToken;

const UNPACK_HEADROOM: u64 = 256 * 1024 * 1024;

pub(super) fn supported() -> bool {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64" | "x86_64") => sysinfo::System::os_version()
            .and_then(|version| version.split('.').next()?.parse::<u32>().ok())
            .is_some_and(|major| major >= 26),
        ("windows", "x86_64") => true,
        ("linux", "x86_64") => crate::process_output::output(
            std::process::Command::new("/usr/bin/getconf").arg("GNU_LIBC_VERSION"),
            Duration::from_secs(2),
        )
        .and_then(|version| {
            let (_, number) = version.split_once(' ')?;
            let (major, minor) = number.split_once('.')?;
            Some((major.parse::<u32>().ok()?, minor.parse::<u32>().ok()?))
        })
        .is_some_and(|version| version >= (2, 43)),
        _ => false,
    }
}

pub(super) fn engines() -> &'static [(&'static str, &'static str)] {
    match std::env::consts::OS {
        "macos" => &[("macos", "mtl"), ("macos", "cpu")],
        "windows" => &[("windows-vulkan", "vulkan"), ("windows-cpu", "cpu")],
        "linux" => &[("linux-vulkan", "vulkan"), ("linux-cpu", "cpu")],
        _ => &[],
    }
}

const CLI: &str = if cfg!(windows) {
    "sd-cli.exe"
} else {
    "sd-cli"
};

pub(super) fn executable(root: &Path, resources: &Path, platform: &str) -> PathBuf {
    if platform == "macos" {
        return resources.join("cover-art").join(CLI);
    }
    root.join(format!("{}-{platform}", manifest().engine_version))
        .join(CLI)
}

pub(super) fn installed_model(root: &Path) -> Option<PathBuf> {
    let pin = &manifest().model.file;
    let path = root.join(&pin.file);
    ModelVerifier::open(root)
        .is_verified(&path, &pin.sha256)
        .then_some(path)
}

pub(super) struct Work<'a, F> {
    root: &'a Path,
    cancel: &'a CancellationToken,
    progress: F,
    client: reqwest::Client,
}

impl<'a, F: Fn(DownloadProgress)> Work<'a, F> {
    pub(super) async fn new(
        root: &'a Path,
        cancel: &'a CancellationToken,
        progress: F,
    ) -> Result<Self> {
        tokio::fs::create_dir_all(root).await?;
        Ok(Self {
            root,
            cancel,
            progress,
            client: download::client()?,
        })
    }

    pub(super) async fn model(&self) -> Result<PathBuf> {
        let model = &manifest().model;
        let path = self.root.join(&model.file.file);
        let mut verifier = ModelVerifier::open(self.root);
        if path.is_file()
            && (path.metadata()?.len() != model.file.estimated_bytes
                || verifier
                    .verify(
                        &path,
                        &model.file.sha256,
                        self.cancel,
                        download::verification_progress(&model.file, &self.progress),
                    )
                    .await?
                    == Verification::Invalid)
        {
            if self.cancel.is_cancelled() {
                return Err(Error::Cancelled);
            }
            tokio::fs::remove_file(path).await?;
        }
        download::download_pinned_model(
            &self.client,
            &model.url,
            self.root,
            &model.file,
            &mut verifier,
            self.cancel,
            &self.progress,
        )
        .await
    }

    pub(super) async fn engine(&self, resources: &Path, platform: &str) -> Result<PathBuf> {
        let manifest = manifest();
        let pin = &manifest.engines[platform];
        let executable = executable(self.root, resources, platform);
        let install = executable
            .parent()
            .expect("cover engine has an installation folder");
        if executable.is_file() {
            return Ok(executable);
        }
        if platform == "macos" {
            return Err(message("cover_art_engine_missing"));
        }
        let url = format!(
            "https://github.com/leejet/stable-diffusion.cpp/releases/download/{}/{}",
            manifest.engine_version, pin.file
        );
        let archive = download::download_pinned_model(
            &self.client,
            &url,
            self.root,
            pin,
            &mut ModelVerifier::open(self.root),
            self.cancel,
            &self.progress,
        )
        .await?;
        download::ensure_space(self.root, UNPACK_HEADROOM)?;
        let staging = tempfile::tempdir_in(self.root)?;
        let dest = staging.path().to_owned();
        let source = archive.clone();
        tokio::task::spawn_blocking(move || unpack(&source, &dest, CLI))
            .await
            .map_err(|error| message(error.to_string()))??;
        if self.cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        if install.exists() {
            tokio::fs::remove_dir_all(install).await?;
        }
        tokio::fs::rename(staging.path(), install).await?;
        if let Err(error) = tokio::fs::remove_file(archive).await {
            tracing::warn!(%error, "Could not remove cover engine archive");
        }
        Ok(executable)
    }
}

fn unpack(source: &Path, destination: &Path, cli: &str) -> Result<()> {
    let invalid =
        |error: zip::result::ZipError| message(format!("Invalid cover engine archive: {error}"));
    let mut archive = zip::ZipArchive::new(std::fs::File::open(source)?).map_err(invalid)?;
    if archive
        .decompressed_size()
        .is_none_or(|size| size > u128::from(UNPACK_HEADROOM))
    {
        return Err(message(
            "Cover engine archive exceeds the installation size limit",
        ));
    }
    archive.extract(destination).map_err(invalid)?;
    for unused in [
        "sd-server",
        "sd-server.exe",
        "start-server.sh",
        "start-server.bat",
    ] {
        let file = destination.join(unused);
        if file.is_file() {
            std::fs::remove_file(file)?;
        }
    }
    if !destination.join(cli).is_file() {
        return Err(message("Cover engine executable is missing"));
    }
    Ok(())
}
