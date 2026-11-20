use super::{catalog, required, Catalog, Selection};
use crate::{
    error::{message, Result},
    hardware::Hardware,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AssetSource {
    /// Hugging Face repository in owner/name form.
    pub repository: String,
    pub revision: String,
    pub path: String,
}

impl AssetSource {
    pub fn url(&self) -> String {
        format!(
            "https://huggingface.co/{}/resolve/{}/{}",
            self.repository, self.revision, self.path
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpstreamSource {
    pub id: String,
    pub role: String,
    pub repository: String,
    pub revision: String,
    pub license: String,
    pub license_url: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub gated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GenerationCapabilities {
    pub min_duration: u32,
    pub max_duration: u32,
    pub max_variants: u32,
    pub prompt: bool,
    pub lyrics: bool,
    pub lyrics_required: bool,
    pub instrumental: bool,
    pub bpm: bool,
    pub advanced: bool,
    pub analysis: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_seed: Option<u32>,
}

impl GenerationCapabilities {
    pub fn ace_step() -> Self {
        Self {
            min_duration: 10,
            max_duration: 600,
            max_variants: 50,
            prompt: true,
            lyrics: true,
            lyrics_required: false,
            instrumental: true,
            bpm: true,
            advanced: true,
            analysis: true,
            max_seed: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NativeRuntime {
    pub name: String,
    pub revision: String,
    pub source: String,
    pub license: String,
    pub license_url: String,
    /// Path within the application's resource directory, without the Windows suffix.
    pub executable: String,
}

impl NativeRuntime {
    pub fn executable(&self, resources: &Path) -> PathBuf {
        let executable = resources.join(&self.executable);
        if cfg!(windows) {
            executable.with_extension("exe")
        } else {
            executable
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Usage {
    pub model_use: String,
    pub redistribution: String,
    pub outputs: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub policy_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestedPlatform {
    pub os: String,
    pub arch: String,
    pub backend: String,
    pub minimum_ram_bytes: u64,
    pub minimum_vram_bytes: Option<u64>,
}

impl TestedPlatform {
    pub fn matches(&self, hardware: &Hardware) -> bool {
        self.os == hardware.platform
            && self.arch == std::env::consts::ARCH
            && hardware.ram_bytes >= self.minimum_ram_bytes
            && self.minimum_vram_bytes.is_none_or(|min| {
                hardware
                    .vram_bytes
                    .is_some_and(|available| available >= min)
            })
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Acquisition {
    #[default]
    Download,
    Manual,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderProfile {
    pub selection: Selection,
    pub name: String,
    pub files: Vec<String>,
    pub capabilities: GenerationCapabilities,
    pub runtime: NativeRuntime,
    pub upstream_sources: Vec<UpstreamSource>,
    pub usage: Usage,
    pub platforms: Vec<TestedPlatform>,
    #[serde(default)]
    pub acquisition: Acquisition,
}

impl ProviderProfile {
    pub fn platform(&self, hardware: &Hardware) -> Result<&TestedPlatform> {
        self.platforms
            .iter()
            .find(|platform| platform.matches(hardware))
            .ok_or_else(|| {
                message("This model profile has no tested runtime for this platform and hardware")
            })
    }

    pub fn ensure_runtime(&self, resources: &Path, hardware: &Hardware) -> Result<()> {
        self.platform(hardware)?;
        if !self.runtime.executable(resources).is_file() {
            return Err(message(
                "The native runtime for this model is missing from this app build",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelPin {
    pub file: String,
    pub sha256: String,
    pub bytes: u64,
    pub source: Option<AssetSource>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GenerationProfile {
    pub provider: String,
    pub runtime: String,
    pub runtime_revision: String,
    pub model_revision: String,
    pub capabilities: GenerationCapabilities,
    pub files: Vec<ModelPin>,
}

impl Catalog {
    pub fn profile(&self, selection: &Selection) -> Option<&ProviderProfile> {
        self.profiles
            .iter()
            .find(|profile| &profile.selection == selection)
    }
}

pub fn capabilities(selection: &Selection) -> Result<GenerationCapabilities> {
    if selection.provider == "ace-step" {
        return Ok(GenerationCapabilities::ace_step());
    }
    catalog()
        .profile(selection)
        .map(|profile| profile.capabilities.clone())
        .ok_or_else(|| message("Unknown model profile"))
}

pub fn ensure_runtime(selection: &Selection, resources: &Path) -> Result<()> {
    if selection.provider == "ace-step" {
        return Ok(());
    }
    let catalog = catalog();
    catalog
        .profile(selection)
        .ok_or_else(|| message("Unknown model profile"))?
        .ensure_runtime(resources, crate::hardware::inspect())
}

pub fn generation_profile(selection: &Selection) -> Result<GenerationProfile> {
    let catalog = catalog();
    let (runtime, runtime_revision, model_revision) =
        if let Some(profile) = catalog.profile(selection) {
            (
                profile.runtime.name.clone(),
                profile.runtime.revision.clone(),
                profile
                    .upstream_sources
                    .first()
                    .map(|source| source.revision.clone())
                    .unwrap_or_else(|| catalog.revision.clone()),
            )
        } else {
            let manifest = crate::manifest::manifest();
            (
                "acestep.cpp".into(),
                manifest.engines[std::env::consts::OS]["revision"]
                    .as_str()
                    .ok_or_else(|| message("Unknown ACE-Step runtime platform"))?
                    .into(),
                catalog.revision,
            )
        };
    Ok(GenerationProfile {
        provider: selection.provider.clone(),
        runtime,
        runtime_revision,
        model_revision,
        capabilities: capabilities(selection)?,
        files: required(selection)?
            .into_iter()
            .map(|model| ModelPin {
                file: model.file,
                sha256: model.sha256,
                bytes: model.estimated_bytes,
                source: model.source,
            })
            .collect(),
    })
}
