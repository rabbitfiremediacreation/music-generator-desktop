use super::manifest;
use crate::{
    download::{self, DownloadProgress},
    error::{message, Error, Result},
    verification::ModelVerifier,
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
        download::download_pinned_model(
            &self.client,
            &model.url,
            self.root,
            &model.file,
            &mut ModelVerifier::open(self.root),
            self.cancel,
            &self.progress,
        )
        .await
    }

    pub(super) async fn engine(&self, platform: &str) -> Result<PathBuf> {
        let manifest = manifest();
        let pin = &manifest.engines[platform];
        let install = self
            .root
            .join(format!("{}-{platform}", manifest.engine_version));
        let cli = if cfg!(windows) {
            "sd-cli.exe"
        } else {
            "sd-cli"
        };
        let executable = install.join(cli);
        if executable.is_file() {
            return Ok(executable);
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
        tokio::task::spawn_blocking(move || unpack(&source, &dest, cli))
            .await
            .map_err(|error| message(error.to_string()))??;
        if self.cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        if install.exists() {
            tokio::fs::remove_dir_all(&install).await?;
        }
        tokio::fs::rename(staging.path(), &install).await?;
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
