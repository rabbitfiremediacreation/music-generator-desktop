//! Versioned provider/asset catalog. Only adapters implemented by this app can run.
use crate::{
    error::{message, Result},
    hardware::Hardware,
    manifest::Model,
    types::Settings,
    verification::{ModelVerifier, Verification},
};
use futures_util::{stream, StreamExt};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio_util::sync::CancellationToken;

pub(crate) mod hugging_face;
mod provider;
mod removal;
pub use provider::*;
pub use removal::{remove_installed, ModelRemoval};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub status: String,
    pub adapter: Option<String>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Asset {
    pub file: String,
    pub provider: String,
    pub role: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    pub family: String,
    pub precision: String,
    pub estimated_bytes: u64,
    pub sha256: String,
    pub recommended_steps: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<AssetSource>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub hf_discovered: bool,
}

impl Asset {
    pub fn download(&self) -> Model {
        Model {
            file: self.file.clone(),
            estimated_bytes: self.estimated_bytes,
            sha256: self.sha256.clone(),
            kind: self.role.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BasicModels {
    pub synthesis: Vec<String>,
    pub language: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Catalog {
    pub version: u32,
    pub revision: String,
    pub base_url: String,
    pub expert_families: Vec<String>,
    pub basic_models: BasicModels,
    pub providers: Vec<Provider>,
    pub models: Vec<Asset>,
    #[serde(default)]
    pub profiles: Vec<ProviderProfile>,
}

fn embedded_catalog() -> Catalog {
    serde_json::from_str(include_str!("../../models/catalog.json")).expect("embedded model catalog")
}

pub fn catalog() -> Catalog {
    let mut catalog = embedded_catalog();
    hugging_face::extend(&mut catalog);
    catalog
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Selection {
    pub provider: String,
    pub synthesis: String,
    #[serde(default)]
    pub language: String,
}

impl Selection {
    pub fn from_settings(settings: &Settings) -> Self {
        Self {
            provider: settings.model_provider.clone(),
            synthesis: if settings.synthesis_model.is_empty() {
                if settings.dit == "xl" {
                    "acestep-v15-xl-sft-Q8_0.gguf"
                } else {
                    "acestep-v15-sft-Q8_0.gguf"
                }
                .into()
            } else {
                settings.synthesis_model.clone()
            },
            language: settings.lm_model.clone(),
        }
    }

    pub fn apply(&self, settings: &mut Settings) -> Result<()> {
        required(self)?;
        let previous = Self::from_settings(settings);
        if previous.provider != self.provider && required(&previous).is_ok() {
            settings
                .model_profiles
                .insert(previous.provider.clone(), previous);
        }
        settings.model_provider = self.provider.clone();
        settings.synthesis_model = self.synthesis.clone();
        settings.lm_model = self.language.clone();
        settings.dit = if self.synthesis.contains("-xl-") {
            "xl"
        } else {
            "standard"
        }
        .into();
        Ok(())
    }
}

/// Resolve identifiers through the pinned catalog, never through user-provided paths/URLs.
pub fn required(selection: &Selection) -> Result<Vec<Asset>> {
    catalog().required(selection)
}

/// Admission policy applies to new work, never to restoration or already accepted queue rows.
pub fn ensure_allowed(selection: &Selection, expert_mode: bool) -> Result<()> {
    let catalog = catalog();
    let hardware = (!expert_mode).then(crate::hardware::inspect);
    catalog.ensure_allowed(selection, expert_mode, hardware)
}

impl Catalog {
    pub fn ensure_allowed(
        &self,
        selection: &Selection,
        expert_mode: bool,
        hardware: Option<&Hardware>,
    ) -> Result<()> {
        self.required(selection)?;
        if let Some(profile) = self.profile(selection) {
            profile.ensure_released()?;
            if profile.expert_only && !expert_mode {
                return Err(message("expert_mode_required"));
            }
            if let Some(hardware) = hardware {
                profile.platform(hardware)?;
            }
            return Ok(());
        }
        if !expert_mode
            && !hardware.is_some_and(|hw| self.recommended_profiles(hw).contains(selection))
        {
            return Err(message("expert_mode_required"));
        }
        Ok(())
    }

    /// Recommend compatible profiles and select a supported language model for each ACE-Step starter.
    pub fn recommended_profiles(&self, hardware: &Hardware) -> Vec<Selection> {
        let recommended = crate::manifest::lm_file(&hardware.recommended_lm);
        let Some(limit) = self
            .basic_models
            .language
            .iter()
            .position(|file| file == &recommended)
        else {
            return Vec::new();
        };
        let ace_step = self.basic_models.synthesis.iter().filter_map(|synthesis| {
            self.basic_models.language[..=limit]
                .iter()
                .rev()
                .find_map(|language| {
                    let selection = Selection {
                        provider: "ace-step".into(),
                        synthesis: synthesis.clone(),
                        language: language.clone(),
                    };
                    let models = self.required(&selection).ok()?;
                    (!models
                        .iter()
                        .any(|m| self.expert_families.contains(&m.family))
                        && memory_bytes(&models) <= hardware.ram_bytes)
                        .then_some(selection)
                })
        });
        let native = self
            .profiles
            .iter()
            .filter(|profile| {
                !profile.expert_only
                    && profile.ensure_released().is_ok()
                    && profile.platform(hardware).is_ok()
            })
            .map(|profile| profile.selection.clone());
        ace_step.chain(native).collect()
    }

    /// Keep hardware-compatible profiles discoverable while limiting recommendations to this build's runtimes.
    pub fn recommendations_for_build(
        &self,
        hardware: &Hardware,
        resources: &Path,
        data_root: &Path,
    ) -> Vec<Selection> {
        self.recommended_profiles(hardware)
            .into_iter()
            .filter(|selection| {
                self.profile(selection).map_or_else(
                    || {
                        crate::engine::engine_path(&crate::engine_packages::ace_resources(
                            resources, data_root,
                        ))
                        .is_file()
                    },
                    |profile| {
                        profile
                            .ensure_runtime(resources, data_root, hardware)
                            .is_ok()
                    },
                )
            })
            .collect()
    }

    pub fn required(&self, selection: &Selection) -> Result<Vec<Asset>> {
        if let Some(profile) = self.profile(selection) {
            if profile.files.is_empty()
                || !self.providers.iter().any(|provider| {
                    provider.id == selection.provider
                        && matches!(provider.status.as_str(), "available" | "preview")
                        && provider.adapter.is_some()
                })
            {
                return Err(message(
                    "This model profile has no supported engine adapter",
                ));
            }
            return profile
                .files
                .iter()
                .map(|file| {
                    self.models
                        .iter()
                        .find(|model| model.provider == selection.provider && &model.file == file)
                        .cloned()
                        .ok_or_else(|| message("Unknown model profile file"))
                })
                .collect();
        }
        if selection.provider != "ace-step"
            || !self.providers.iter().any(|p| {
                p.id == selection.provider
                    && p.status == "available"
                    && p.adapter.as_deref() == Some("acestep.cpp")
            })
        {
            return Err(message(
                "This model provider has no supported engine adapter yet",
            ));
        }
        let find = |file: &str, role: &str| {
            self.models
                .iter()
                .find(|m| m.file == file && m.role == role && m.provider == selection.provider)
                .cloned()
                .ok_or_else(|| message("Unknown model or incorrect model role"))
        };
        let mut models = vec![
            find(&selection.synthesis, "synthesis")?,
            find(&selection.language, "language")?,
        ];
        models.extend(
            self.models
                .iter()
                .filter(|m| m.provider == selection.provider && m.role == "dependency")
                .cloned(),
        );
        Ok(models)
    }
}

/// Check new default profiles without changing settings, resident engines or model files.
pub fn validate_activation(
    settings: &Settings,
    selection: &Selection,
    hardware: &Hardware,
) -> Result<()> {
    if !settings.setup_complete {
        return Err(message("Complete the first-run assistant first"));
    }
    catalog().ensure_allowed(selection, settings.expert_mode, Some(hardware))?;
    if !compatible(selection, hardware)? && selection != &Selection::from_settings(settings) {
        return Err(message(
            "This model combination exceeds the estimated RAM budget. Choose smaller models",
        ));
    }
    Ok(())
}

/// Activate verified local files only. Creator selection never downloads or repairs assets.
/// The caller holds an exclusive activation permit until the old engine has been released.
pub fn activate_cached_profile(
    db: &crate::db::Database,
    selection: &Selection,
    hardware: &Hardware,
) -> Result<()> {
    let mut settings = db.settings()?;
    validate_activation(&settings, selection, hardware)?;
    if !cached(
        selection,
        Path::new(&settings.models_dir),
        &ModelVerifier::open(&db.root),
    )? {
        return Err(message("model_setup_required"));
    }
    selection.apply(&mut settings)?;
    db.save_settings(&settings)
}

/// Prepare and activate an isolated profile for engine acceptance tests.
#[cfg(test)]
pub async fn install_profile(
    catalog: &Catalog,
    db: &crate::db::Database,
    selection: &Selection,
    cancel: &CancellationToken,
    progress: impl Fn(crate::download::DownloadProgress) + Sync,
) -> Result<()> {
    let mut settings = db.settings()?;
    prepare_profile(catalog, db, &settings, selection, cancel, progress).await?;
    activate_installed(db, &mut settings, selection, cancel)
}

/// Verify and cache a profile's assets without activating it.
pub(crate) async fn prepare_profile(
    catalog: &Catalog,
    db: &crate::db::Database,
    settings: &Settings,
    selection: &Selection,
    cancel: &CancellationToken,
    progress: impl Fn(crate::download::DownloadProgress) + Sync,
) -> Result<()> {
    catalog.ensure_allowed(
        selection,
        settings.expert_mode,
        (!settings.expert_mode).then(crate::hardware::inspect),
    )?;
    let models = catalog.required(selection)?;
    let root = Path::new(&settings.models_dir);
    let manual = catalog
        .profile(selection)
        .is_some_and(|profile| profile.acquisition == Acquisition::Manual);
    if manual {
        return verify_imported_files(db, root, &models, cancel, &progress).await;
    }
    tokio::fs::create_dir_all(root).await?;
    let missing: u64 = models
        .iter()
        .filter(|m| !root.join(&m.file).is_file())
        .map(|m| {
            m.estimated_bytes.saturating_sub(
                root.join(format!("{}.part", m.file))
                    .metadata()
                    .map(|m| m.len())
                    .unwrap_or(0),
            )
        })
        .sum();
    if missing > 0 {
        crate::download::ensure_space(root, missing.saturating_add(512 * 1024 * 1024))?;
    }
    let client = &crate::download::client()?;
    let progress = &progress;
    let results = stream::iter(models)
        .map(|model| async move {
            let mut verifier = ModelVerifier::open(&db.root);
            let pinned = model.download();
            let (url, bytes) = model.source.as_ref().map_or_else(
                || (format!("{}/{}", catalog.base_url, model.file), None),
                |source| (source.url(), Some(pinned.estimated_bytes)),
            );
            crate::download::fetch(
                || crate::hugging_face_token::get(&client, &url, &db.root),
                bytes,
                root,
                &pinned,
                &mut verifier,
                cancel,
                progress,
            )
            .await
            .map(|_| ())
        })
        .buffer_unordered(crate::download::queue::LIMIT)
        .collect::<Vec<_>>()
        .await;
    results.into_iter().collect()
}

/// Verify a manual import independently of whether its runtime can run on this device.
pub async fn verify_manual_profile(
    catalog: &Catalog,
    db: &crate::db::Database,
    selection: &Selection,
    cancel: &CancellationToken,
    progress: impl Fn(crate::download::DownloadProgress),
) -> Result<()> {
    if !catalog
        .profile(selection)
        .is_some_and(|profile| profile.acquisition == Acquisition::Manual)
    {
        return Err(message("This profile does not use local import"));
    }
    let settings = db.settings()?;
    verify_imported_files(
        db,
        Path::new(&settings.models_dir),
        &catalog.required(selection)?,
        cancel,
        &progress,
    )
    .await
}

async fn verify_imported_files(
    db: &crate::db::Database,
    root: &Path,
    models: &[Asset],
    cancel: &CancellationToken,
    progress: &impl Fn(crate::download::DownloadProgress),
) -> Result<()> {
    if cancel.is_cancelled() {
        return Err(crate::error::Error::Cancelled);
    }
    if models.iter().any(|model| !root.join(&model.file).is_file()) {
        return Err(message(
            "Place all imported model files in the model folder before verifying",
        ));
    }
    let mut verifier = ModelVerifier::open(&db.root);
    for model in models {
        crate::download::verify_model(
            &root.join(&model.file),
            &model.download(),
            &mut verifier,
            cancel,
            progress,
        )
        .await?;
    }
    Ok(())
}

#[cfg(test)]
fn activate_installed(
    db: &crate::db::Database,
    settings: &mut Settings,
    selection: &Selection,
    cancel: &CancellationToken,
) -> Result<()> {
    if cancel.is_cancelled() {
        return Err(crate::error::Error::Cancelled);
    }
    selection.apply(settings)?;
    db.save_settings(settings)
}

/// Conservative weight footprint plus runtime/OS headroom; duration can require more.
/// A small dedicated GPU does not make a model incompatible: the engine supports CPU.
pub fn memory_bytes(models: &[Asset]) -> u64 {
    let weights: u64 = models.iter().map(|m| m.estimated_bytes).sum();
    let reserve = if models
        .iter()
        .any(|m| m.role == "synthesis" && m.file.contains("-xl-"))
    {
        4
    } else {
        3
    };
    weights.saturating_add(reserve * 1024 * 1024 * 1024)
}

/// Jobs created before model snapshots always use an ACE-Step selection.
pub fn legacy_selection(settings: &Settings) -> Selection {
    if settings.model_provider == "ace-step" {
        return Selection::from_settings(settings);
    }
    settings
        .model_profiles
        .get("ace-step")
        .filter(|profile| required(profile).is_ok())
        .cloned()
        .unwrap_or_else(|| {
            Selection::from_settings(&Settings {
                lm_model: crate::manifest::lm_file("0.6B"),
                ..Default::default()
            })
        })
}

/// Restore a supported profile in memory; keep old songs, files and stored settings intact.
pub fn restore_supported_profile(settings: &mut Settings) -> Result<()> {
    if settings.model_provider == "ace-step"
        || required(&Selection::from_settings(settings)).is_ok()
    {
        return Ok(());
    }
    legacy_selection(settings).apply(settings)?;
    settings.setup_complete = false;
    Ok(())
}

pub fn compatible(selection: &Selection, hardware: &Hardware) -> Result<bool> {
    let catalog = catalog();
    if let Some(profile) = catalog.profile(selection) {
        return Ok(profile.platform(hardware).is_ok());
    }
    Ok(memory_bytes(&catalog.required(selection)?) <= hardware.ram_bytes)
}

pub fn cached(selection: &Selection, folder: &Path, verifier: &ModelVerifier) -> Result<bool> {
    Ok(required(selection)?
        .iter()
        .all(|m| verifier.is_verified(&folder.join(&m.file), &m.sha256)))
}

pub async fn verify(
    selection: &Selection,
    folder: &Path,
    verifier: &mut ModelVerifier,
    cancel: &CancellationToken,
) -> Result<bool> {
    for model in required(selection)? {
        let path = folder.join(&model.file);
        if !path.is_file()
            || verifier
                .verify(&path, &model.sha256, cancel, |_, _| {})
                .await?
                == Verification::Invalid
        {
            return Ok(false);
        }
    }
    Ok(true)
}
