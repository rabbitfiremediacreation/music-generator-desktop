use crate::{
    download,
    error::{message, Result},
    runtime::OperationKind,
    state::AppState,
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, OnceLock},
};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

mod install;
mod probe;
mod status;
#[cfg(test)]
mod tests;

pub(crate) use install::install;
use install::{install_archive, installing, remove};
pub use probe::cli;
#[cfg(target_os = "macos")]
pub(crate) use probe::install_probe_archives;
use status::EnginePackageStatus;

pub(crate) const ACE_ENTRY: &str = if cfg!(windows) {
    "engine/ace-server.exe"
} else if cfg!(target_os = "macos") {
    "engine/libace-server-plugin.dylib"
} else {
    "engine/ace-server"
};

#[derive(Deserialize)]
struct Release {
    format: u32,
    tag: String,
    packages: Vec<Package>,
}

#[derive(Clone, Deserialize)]
struct Package {
    id: String,
    executable: String,
    #[serde(default)]
    additional_executables: Vec<String>,
    revision: String,
    file: String,
    sha256: String,
    bytes: u64,
    unpacked_bytes: u64,
}

#[derive(Deserialize, Serialize)]
struct Installed {
    directory: String,
    revision: String,
    sha256: String,
}

fn release() -> &'static Release {
    static RELEASE: OnceLock<Release> = OnceLock::new();
    RELEASE.get_or_init(|| {
        let release: Release = serde_json::from_str(include_str!(concat!(
            env!("OUT_DIR"),
            "/engine-packages.json"
        )))
        .expect("valid desktop engine package manifest");
        assert_eq!(release.format, 1);
        release
    })
}

pub(crate) fn managed() -> bool {
    !release().packages.is_empty()
}

const LEGACY_PYTORCH_PACKAGES: [&str; 2] = ["mimetic", "text2midi"];

fn package_root(data: &Path, id: &str) -> PathBuf {
    data.join("engines/v1").join(id)
}

impl Package {
    fn root(&self, data: &Path) -> PathBuf {
        package_root(data, &self.id)
    }

    fn removed_root(&self, data: &Path) -> PathBuf {
        self.root(data)
            .with_file_name(format!(".removed-{}", self.id))
    }

    fn installed(&self, data: &Path) -> Option<(Installed, PathBuf)> {
        let root = self.root(data);
        let installed: Installed =
            serde_json::from_slice(&fs::read(root.join("current.json")).ok()?).ok()?;
        let directory = root.join(
            uuid::Uuid::parse_str(&installed.directory)
                .ok()?
                .to_string(),
        );
        self.files_ready(&directory)
            .then_some((installed, directory))
    }

    fn files_ready(&self, directory: &Path) -> bool {
        directory.join(&self.executable).is_file()
            && self
                .additional_executables
                .iter()
                .all(|entry| directory.join(entry).is_file())
    }

    fn has_executable(&self, executable: &Path) -> bool {
        Path::new(&self.executable) == executable
            || self
                .additional_executables
                .iter()
                .any(|entry| Path::new(entry) == executable)
    }

    fn has_legacy_pytorch(&self, data: &Path) -> bool {
        self.id == "pytorch"
            && LEGACY_PYTORCH_PACKAGES
                .iter()
                .any(|id| package_root(data, id).join("current.json").is_file())
    }
}

pub(crate) fn contains(id: &str) -> bool {
    release().packages.iter().any(|package| package.id == id)
}

pub(crate) fn resources_for(bundled: &Path, data: &Path, executable: &Path) -> PathBuf {
    release()
        .packages
        .iter()
        .find(|package| package.has_executable(executable))
        .and_then(|package| {
            let (installed, directory) = package.installed(data)?;
            (installed.revision == package.revision).then_some(directory)
        })
        .unwrap_or_else(|| bundled.to_owned())
}

pub(crate) fn ace_resources(bundled: &Path, data: &Path) -> PathBuf {
    resources_for(bundled, data, Path::new(ACE_ENTRY))
}

pub(crate) fn ace_download_bytes(bundled: &Path, data: &Path) -> u64 {
    if crate::engine::engine_path(&ace_resources(bundled, data)).is_file() {
        return 0;
    }
    release()
        .packages
        .iter()
        .find(|package| package.id == "ace-step")
        .map_or(0, |package| package.bytes)
}

#[tauri::command]
pub(crate) fn engine_package_status(state: State<'_, Arc<AppState>>) -> Vec<EnginePackageStatus> {
    status::inventory(&state.resources, &state.db.root)
}

#[tauri::command]
pub(crate) async fn remove_engine_package(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    id: String,
) -> Result<()> {
    let package = release()
        .packages
        .iter()
        .find(|package| package.id == id)
        .ok_or_else(|| message("engine_package_unavailable"))?;
    let operation = state.runtime.try_begin(OperationKind::Models)?;
    let state = state.inner().clone();
    tokio::task::spawn_blocking(move || {
        if package.id == "ace-step" {
            state.stop_engine();
        }
        let result = remove(package, &state.db.root);
        if package.id == "ace-step" {
            state.synthesis_probe.clear();
        }
        drop(operation);
        let _ = app.emit("models-changed", ());
        result
    })
    .await
    .map_err(|error| message(error.to_string()))?
}

#[tauri::command]
pub(crate) async fn install_engine_package(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    id: Option<String>,
    title: Option<String>,
) -> Result<()> {
    let archive = if let Some(title) = title {
        let dialog_app = app.clone();
        let selected = tokio::task::spawn_blocking(move || {
            let mut dialog = dialog_app
                .dialog()
                .file()
                .set_title(title)
                .add_filter("ZIP", &["zip"]);
            if let Some(window) = dialog_app.get_webview_window("main") {
                dialog = dialog.set_parent(&window);
            }
            dialog
                .blocking_pick_file()
                .map(|file| {
                    file.into_path()
                        .map_err(|_| message("engine_package_invalid"))
                })
                .transpose()
        })
        .await
        .map_err(|_| message("dialog_failed"))??;
        let Some(archive) = selected else {
            return Ok(());
        };
        Some(archive)
    } else {
        None
    };
    let package = release()
        .packages
        .iter()
        .find(|package| match &archive {
            Some(archive) => archive
                .file_name()
                .is_some_and(|name| name == std::ffi::OsStr::new(&package.file)),
            None => id.as_deref() == Some(&package.id),
        })
        .ok_or_else(|| {
            message(if archive.is_some() {
                "engine_package_invalid"
            } else {
                "engine_package_unavailable"
            })
        })?;
    let operation = state.runtime.try_begin(OperationKind::Models)?;
    let state = state.inner().clone();
    tokio::spawn(async move {
        let cancel = operation.cancellation();
        let progress = download::ProgressEvents::new(&app, "engine-download-progress");
        if package.id == "ace-step" {
            state.stop_engine();
        }
        let result = if let Some(archive) = archive {
            let root = package.root(&state.db.root);
            fs::create_dir_all(&root)?;
            download::ensure_space(&root, package.unpacked_bytes)?;
            progress.report(installing(&package.file));
            install_archive(package, &state.db.root, archive, &cancel).await
        } else {
            install(&state.db.root, &package.id, &cancel, |update| {
                progress.report(update)
            })
            .await
        };
        if package.id == "ace-step" && result.is_ok() {
            state.synthesis_probe.clear();
        }
        drop(progress);
        drop(operation);
        let _ = app.emit("models-changed", ());
        result
    })
    .await
    .map_err(|error| message(error.to_string()))?
}
