use super::{managed, release, Package};
use crate::catalog::{NativeRuntime, ProviderProfile};
use serde::Serialize;
use std::{fs, path::Path};

#[derive(Default, Serialize)]
pub(crate) struct EnginePackageStatus {
    id: String,
    bytes: u64,
    installed: bool,
    update_available: bool,
    removable: bool,
    install_command: Option<String>,
    installed_version: Option<EngineVersion>,
    available_version: Option<EngineVersion>,
}

#[derive(Serialize)]
struct EngineVersion {
    tag: Option<String>,
    revision: String,
}

impl EngineVersion {
    fn new(revision: String, runtime: Option<&NativeRuntime>) -> Self {
        let upstream = revision.split(':').next().unwrap_or(&revision);
        let tag = runtime
            .filter(|runtime| runtime.revision == upstream)
            .and_then(|runtime| {
                runtime.version.clone().or_else(|| {
                    let (_, tag) = runtime.source.rsplit_once("/releases/tag/")?;
                    Some(tag.to_owned())
                })
            });
        Self { tag, revision }
    }
}

pub(super) fn package_status(
    package: &Package,
    resources: &Path,
    data: &Path,
    profiles: &[ProviderProfile],
) -> EnginePackageStatus {
    let installed = package.installed(data).map(|(current, _)| current);
    let bundled = package.files_ready(resources);
    let legacy = package.has_legacy_pytorch(data);
    let runtime = profiles
        .iter()
        .map(|profile| &profile.runtime)
        .find(|runtime| {
            let executable = runtime
                .packaged_executable
                .as_ref()
                .unwrap_or(&runtime.executable);
            executable == &package.executable
                && package.revision.split(':').next() == Some(runtime.revision.as_str())
                && (runtime.version.is_some() || runtime.source.contains("/releases/tag/"))
        });
    let version = |revision| EngineVersion::new(revision, runtime);
    EnginePackageStatus {
        id: package.id.clone(),
        bytes: package.bytes,
        installed: bundled
            || installed
                .as_ref()
                .is_some_and(|current| current.revision == package.revision),
        update_available: installed.as_ref().map_or(legacy, |current| {
            current.sha256 != package.sha256 || current.revision != package.revision
        }),
        removable: installed.is_some() || legacy || package.removed_root(data).exists(),
        installed_version: installed
            .map(|current| version(current.revision))
            .or_else(|| bundled.then(|| version(package.revision.clone()))),
        available_version: Some(version(package.revision.clone())),
        ..Default::default()
    }
}

pub(super) fn inventory(resources: &Path, data: &Path) -> Vec<EnginePackageStatus> {
    let profiles = crate::catalog::catalog().profiles;
    let mut status: Vec<_> = release()
        .packages
        .iter()
        .map(|package| package_status(package, resources, data, &profiles))
        .collect();
    if !managed() {
        status.extend(bundled_status(resources, data, &profiles));
    }
    status
}

fn bundled_status(
    resources: &Path,
    data: &Path,
    profiles: &[ProviderProfile],
) -> Vec<EnginePackageStatus> {
    let mut status = Vec::new();
    if crate::engine::engine_path(resources).is_file() {
        let installed_version = fs::read(resources.join("engine/VERSION.desktop.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
            .and_then(|metadata| {
                Some(EngineVersion::new(
                    metadata["revision"].as_str()?.to_owned(),
                    None,
                ))
            });
        status.push(EnginePackageStatus {
            id: "ace-step".into(),
            installed: true,
            installed_version,
            ..Default::default()
        });
    }
    if let Some(profile) = profiles
        .iter()
        .find(|profile| profile.selection.provider == "text2midi")
    {
        if profile.platform(crate::hardware::inspect()).is_ok()
            && profile.runtime.executable(resources).is_file()
        {
            let installed = profile.engine_installed(resources, data);
            status.push(EnginePackageStatus {
                id: "text2midi".into(),
                installed,
                installed_version: installed.then(|| {
                    EngineVersion::new(profile.runtime.revision.clone(), Some(&profile.runtime))
                }),
                install_command: profile.runtime.install_command(resources, data),
                ..Default::default()
            });
        }
    }
    status
}
