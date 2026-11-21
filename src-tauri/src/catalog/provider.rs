use super::{catalog, required, Catalog, Selection};
use crate::{
    error::{message, Result},
    hardware::Hardware,
    types::OutputKind,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub gated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GenerationCapabilities {
    pub min_duration: u32,
    pub max_duration: u32,
    pub max_variants: u32,
    pub prompt: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub style_description: bool,
    pub lyrics: bool,
    pub lyrics_required: bool,
    pub instrumental: bool,
    pub bpm: bool,
    pub advanced: bool,
    pub analysis: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub reference_audio: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub yue2_options: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_seed: Option<u32>,
    #[serde(default, skip_serializing_if = "OutputKind::is_audio")]
    pub output_kind: OutputKind,
    /// For metered profiles, allowed counts of 4/4 bars.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bars: Option<Vec<u32>>,
}

impl GenerationCapabilities {
    pub fn ace_step() -> Self {
        Self {
            min_duration: 10,
            max_duration: 600,
            max_variants: 50,
            prompt: true,
            style_description: false,
            lyrics: true,
            lyrics_required: false,
            instrumental: true,
            bpm: true,
            advanced: true,
            analysis: true,
            reference_audio: false,
            yue2_options: false,
            max_seed: None,
            output_kind: OutputKind::Audio,
            bars: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeComponent {
    pub name: String,
    pub revision: String,
    pub source: String,
    pub license: String,
    pub license_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NativeRuntime {
    pub name: String,
    pub revision: String,
    pub source: String,
    pub license: String,
    pub license_url: String,
    /// Path within the application's resource directory. Native executables omit the Windows suffix.
    pub executable: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub components: Vec<RuntimeComponent>,
    /// Optional Python venv interpreter, relative to the application data directory.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interpreter: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub installer: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub required_files: Vec<String>,
}

impl NativeRuntime {
    pub fn executable(&self, resources: &Path) -> PathBuf {
        let executable = resources.join(&self.executable);
        if cfg!(windows) && self.interpreter.is_none() {
            executable.with_extension("exe")
        } else {
            executable
        }
    }

    pub fn interpreter(&self, data_root: &Path) -> Option<PathBuf> {
        self.interpreter.as_ref().map(|path| data_root.join(path))
    }

    fn interpreter_ready(&self, data_root: &Path) -> bool {
        let Some(executable) = self.interpreter(data_root) else {
            return true;
        };
        let Some(venv) = executable.parent().and_then(Path::parent) else {
            return false;
        };
        // A Homebrew upgrade can remove the exact CPython used to initialize the venv.
        executable.is_file()
            && std::fs::read_to_string(venv.join("pyvenv.cfg")).is_ok_and(|config| {
                config
                    .lines()
                    .find_map(|line| line.strip_prefix("executable = "))
                    .is_some_and(|base| Path::new(base).is_file())
            })
    }

    pub fn install_command(&self, resources: &Path, data_root: &Path) -> Option<String> {
        fn quote(path: &Path) -> String {
            format!("'{}'", path.to_string_lossy().replace('\'', "'\\''"))
        }
        let setup = resources.join(self.installer.as_ref()?);
        (setup.is_file() && !self.interpreter_ready(data_root))
            .then(|| format!("/bin/bash {} {}", quote(&setup), quote(data_root)))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Usage {
    pub model_use: String,
    pub redistribution: String,
    pub outputs: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub noncommercial_evaluation: bool,
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
            && (self.backend != "cuda" || hardware.has_nvidia())
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
    /// Planning estimate for this weight set, including inference and system headroom.
    pub estimated_ram_bytes: u64,
    pub files: Vec<String>,
    pub capabilities: GenerationCapabilities,
    pub runtime: NativeRuntime,
    pub upstream_sources: Vec<UpstreamSource>,
    pub usage: Usage,
    pub platforms: Vec<TestedPlatform>,
    /// Targets for explicitly packaged evaluation builds whose hardware acceptance is pending.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub evaluation_platforms: Vec<TestedPlatform>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_note: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_hold: Option<String>,
    #[serde(default)]
    pub acquisition: Acquisition,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub expert_only: bool,
}

impl ProviderProfile {
    pub(super) fn ensure_released(&self) -> Result<()> {
        if let Some(reason) = &self.release_hold {
            return Err(message(reason.clone()));
        }
        Ok(())
    }

    pub fn platform(&self, hardware: &Hardware) -> Result<&TestedPlatform> {
        self.platforms
            .iter()
            .chain(&self.evaluation_platforms)
            .find(|platform| platform.matches(hardware))
            .ok_or_else(|| {
                if !self.evaluation_platforms.is_empty() {
                    return message(
                        "This computer does not match an evaluation target for this profile.",
                    );
                }
                message("This model profile has no tested runtime for this platform and hardware")
            })
    }

    pub fn ensure_runtime(
        &self,
        resources: &Path,
        data_root: &Path,
        hardware: &Hardware,
    ) -> Result<()> {
        self.ensure_released()?;
        self.platform(hardware)?;
        if !self.runtime.executable(resources).is_file()
            || self
                .runtime
                .required_files
                .iter()
                .any(|file| !resources.join(file).is_file())
        {
            if !self.evaluation_platforms.is_empty() {
                return Err(message(
                    "This build does not include the optional evaluation runner.",
                ));
            }
            return Err(message(
                "The native runtime for this model is missing from this app build",
            ));
        }
        if !self.runtime.interpreter_ready(data_root) {
            return Err(message("text2midi_runtime_required"));
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

pub fn ensure_runtime(selection: &Selection, resources: &Path, data_root: &Path) -> Result<()> {
    if selection.provider == "ace-step" {
        return Ok(());
    }
    let catalog = catalog();
    catalog
        .profile(selection)
        .ok_or_else(|| message("Unknown model profile"))?
        .ensure_runtime(resources, data_root, crate::hardware::inspect())
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
