use super::engine;
use crate::{
    download,
    error::{message, Result},
    manifest::Model,
    state::AppState,
    verification::ModelVerifier,
};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio_util::sync::CancellationToken;

pub const RATE: u32 = 44_100;
pub const ENGINE: &str = "demucs";
pub const ENGINE_VERSION: &str = "4.0.1";

#[derive(Clone, Serialize)]
pub struct Profile {
    pub id: &'static str,
    pub name: &'static str,
    pub author: &'static str,
    pub repository: &'static str,
    pub revision: &'static str,
    pub roles: &'static [&'static str],
    pub architecture: &'static str,
    pub engine: &'static str,
    pub engine_version: &'static str,
    pub code_license: &'static str,
    pub weights_license: &'static str,
    pub sample_rate: u32,
    pub input_channels: [u8; 2],
    pub backends: [&'static str; 1],
    pub artifact: Artifact,
    pub configuration: Artifact,
}

#[derive(Clone, Serialize)]
pub struct Artifact {
    pub file: &'static str,
    pub bytes: u64,
    pub sha256: &'static str,
}

const PROFILES: [Profile; 2] = [
    profile(
        "htdemucs",
        "HTDemucs",
        "adefossez/HTDemucs",
        "cbc8a9b1a87023b7fd74e7b3412e6321c0eab003",
        &["drums", "bass", "other", "vocals"],
        Artifact {
            file: "955717e8.safetensors",
            bytes: 84_025_440,
            sha256: "d9fa14133cfcc034a6758923bb3a8ca9f8dfd0b582134643bbf83f72c17576dd",
        },
        Artifact {
            file: "htdemucs.yaml",
            bytes: 21,
            sha256: "239c445d0b14454d541ad8bd9bb271c9e536d267e8a4625208744cbb2e7bb66c",
        },
    ),
    profile(
        "htdemucs-6s",
        "HTDemucs 6s",
        "adefossez/HTDemucs-6s",
        "3c5ee475be622df764938de97e4281a7b07ffa58",
        &["drums", "bass", "other", "vocals", "guitar", "piano"],
        Artifact {
            file: "5c90dfd2.safetensors",
            bytes: 54_885_744,
            sha256: "d2a1745f0744721f6b8ca5bf469b67c651ea5ed1b52998cab033b2158609d411",
        },
        Artifact {
            file: "htdemucs_6s.yaml",
            bytes: 21,
            sha256: "207405151270af8fd81c2373c25d27950916682ac91dca7884a11ce13dad6f58",
        },
    ),
];

const fn profile(
    id: &'static str,
    name: &'static str,
    repository: &'static str,
    revision: &'static str,
    roles: &'static [&'static str],
    artifact: Artifact,
    configuration: Artifact,
) -> Profile {
    Profile {
        id,
        name,
        repository,
        revision,
        roles,
        artifact,
        configuration,
        author: "Meta Platforms, Inc. and Alexandre Défossez",
        architecture: "Hybrid Transformer Demucs",
        engine: ENGINE,
        engine_version: ENGINE_VERSION,
        code_license: "MIT",
        weights_license:
            "Upstream Demucs release; HF model card does not declare a separate license",
        sample_rate: RATE,
        input_channels: [1, 2],
        backends: ["cpu"],
    }
}

pub fn get(id: &str) -> Result<&'static Profile> {
    PROFILES
        .iter()
        .find(|profile| profile.id == id)
        .ok_or_else(|| message("stem_model_unknown"))
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pin {
    pub model: String,
    pub repository: String,
    pub revision: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FilePin {
    pub file: String,
    pub bytes: u64,
    pub sha256: String,
}

impl FilePin {
    fn specification(&self) -> Model {
        Model {
            file: self.file.clone(),
            estimated_bytes: self.bytes,
            sha256: self.sha256.clone(),
            kind: "stem-separation".into(),
        }
    }

    fn valid(&self) -> bool {
        (self.file.ends_with(".safetensors") || self.file.ends_with(".yaml"))
            && !self.file.starts_with('.')
            && self
                .file
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"_.-".contains(&byte))
            && self.sha256.len() == 64
            && self.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
            && (1..=256 * 1024 * 1024).contains(&self.bytes)
    }

    pub fn folder(&self, models: &Path) -> PathBuf {
        models.join("stem-separation").join(&self.sha256)
    }

    pub fn path(&self, models: &Path) -> PathBuf {
        self.folder(models).join(&self.file)
    }

    fn partial(&self, models: &Path) -> PathBuf {
        self.folder(models).join(format!("{}.part", self.file))
    }

    fn received(&self, models: &Path) -> u64 {
        if self.checked_path(models).is_err() {
            return 0;
        }
        self.path(models)
            .metadata()
            .or_else(|_| self.partial(models).metadata())
            .map_or(0, |metadata| metadata.len().min(self.bytes))
    }

    fn checked_path(&self, models: &Path) -> Result<PathBuf> {
        if !self.valid() || !models.is_absolute() {
            return Err(message("stem_model_path"));
        }
        let namespace = models.join("stem-separation");
        let directory = self.folder(models);
        let file = self.path(models);
        let partial = self.partial(models);
        for (path, kind) in [
            (&namespace, true),
            (&directory, true),
            (&file, false),
            (&partial, false),
        ] {
            match path.symlink_metadata() {
                Ok(metadata) if (kind && metadata.is_dir()) || (!kind && metadata.is_file()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                _ => return Err(message("stem_model_path")),
            }
        }
        Ok(file)
    }
}

impl Artifact {
    pub fn pinned(&self) -> FilePin {
        FilePin {
            file: self.file.into(),
            bytes: self.bytes,
            sha256: self.sha256.into(),
        }
    }
}

impl Profile {
    fn files(&self, weights: &FilePin) -> [FilePin; 2] {
        [self.configuration.pinned(), weights.clone()]
    }

    pub fn pin(&self) -> Pin {
        Pin {
            model: self.id.into(),
            repository: self.repository.into(),
            revision: self.revision.into(),
        }
    }
}

#[derive(Clone, Serialize)]
pub struct Revision {
    #[serde(flatten)]
    pub pin: Pin,
    pub artifact: FilePin,
}

#[derive(Serialize)]
pub struct Catalog {
    pub engine_ready: bool,
    pub python_required: bool,
    pub platform_supported: bool,
    pub models: Vec<ModelState>,
}

#[derive(Serialize)]
pub struct ModelState {
    #[serde(flatten)]
    pub profile: Profile,
    pub installed: Vec<Revision>,
    pub active: Option<Revision>,
    pub pending: Option<Revision>,
    pub status: &'static str,
    pub downloaded: u64,
    pub error: Option<String>,
}

fn revision(row: &rusqlite::Row<'_>, model: &str) -> rusqlite::Result<Revision> {
    Ok(Revision {
        pin: Pin {
            model: model.into(),
            repository: row.get(0)?,
            revision: row.get(1)?,
        },
        artifact: crate::db::parse_json(row.get(2)?)?,
    })
}

pub fn catalog(state: &AppState) -> Result<Catalog> {
    let settings = state.db.settings()?;
    let models_dir = Path::new(&settings.models_dir);
    let verifier = ModelVerifier::open(&state.db.root);
    let engine_ready = engine::installed(state);
    let transfers = PROFILES
        .iter()
        .map(|profile| state.runtime.is_transferring("stems", profile.id))
        .collect::<Vec<_>>();
    let con = state.db.lock();
    let mut installed = con.prepare(
        "SELECT repository,revision,artifact,active FROM stem_models WHERE model=?1 ORDER BY installed_at DESC",
    )?;
    let mut pending = con.prepare(
        "SELECT repository,revision,artifact,error FROM stem_model_transfers WHERE model=?1",
    )?;
    let mut models = Vec::new();
    for (profile, transferring) in PROFILES.iter().zip(transfers) {
        let revisions = installed
            .query_map([profile.id], |row| {
                Ok((revision(row, profile.id)?, row.get::<_, bool>(3)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let active = revisions
            .iter()
            .find(|(_, active)| *active)
            .map(|(revision, _)| revision.clone());
        let (pending, error) = pending
            .query_row([profile.id], |row| {
                Ok((
                    Some(revision(row, profile.id)?),
                    row.get::<_, Option<String>>(3)?,
                ))
            })
            .optional()?
            .unwrap_or_default();
        let downloaded = pending.as_ref().map_or(0, |rev| {
            profile
                .files(&rev.artifact)
                .iter()
                .map(|file| file.received(models_dir))
                .sum()
        });
        let status = if !engine::supported() {
            "unsupported"
        } else if !engine_ready {
            "engine_missing_status"
        } else if transferring {
            "installing"
        } else if let Some(active) = &active {
            if profile
                .files(&active.artifact)
                .iter()
                .all(|file| artifact_verified(&verifier, file, models_dir))
            {
                "ready"
            } else {
                "damaged"
            }
        } else if error.is_some() {
            "install_failed"
        } else if downloaded > 0 {
            "paused"
        } else {
            "available"
        };
        models.push(ModelState {
            profile: profile.clone(),
            installed: revisions
                .into_iter()
                .map(|(revision, _)| revision)
                .collect(),
            active,
            pending,
            status,
            downloaded,
            error,
        });
    }
    Ok(Catalog {
        engine_ready,
        python_required: engine::external_python_required(state),
        platform_supported: engine::supported(),
        models,
    })
}

fn artifact_verified(verifier: &ModelVerifier, artifact: &FilePin, models: &Path) -> bool {
    artifact
        .checked_path(models)
        .is_ok_and(|path| verifier.is_verified(&path, &artifact.sha256))
}

fn installed_file(state: &AppState, pin: &Pin) -> Result<Option<FilePin>> {
    state
        .db
        .lock()
        .query_row(
            "SELECT artifact FROM stem_models WHERE model=?1 AND repository=?2 AND revision=?3",
            params![pin.model, pin.repository, pin.revision],
            |row| crate::db::parse_json(row.get(0)?),
        )
        .optional()
        .map_err(Into::into)
}

pub fn require_pin(state: &AppState, pin: &Pin) -> Result<FilePin> {
    get(&pin.model)?;
    if !engine::installed(state) {
        return Err(message("stem_engine_missing"));
    }
    installed_file(state, pin)?.ok_or_else(|| message("stem_model_missing"))
}

pub fn ready_file(state: &AppState, pin: &Pin) -> Result<FilePin> {
    let artifact = require_pin(state, pin)?;
    let models = state.db.settings()?.models_dir;
    let verifier = ModelVerifier::open(&state.db.root);
    if !get(&pin.model)?
        .files(&artifact)
        .iter()
        .all(|file| artifact_verified(&verifier, file, Path::new(&models)))
    {
        return Err(message("stem_model_damaged"));
    }
    Ok(artifact)
}

pub async fn verify(
    state: &AppState,
    pin: &Pin,
    cancel: &CancellationToken,
) -> Result<(PathBuf, FilePin)> {
    let artifact = require_pin(state, pin)?;
    let models = state.db.settings()?.models_dir;
    let models = Path::new(&models);
    let path = artifact.checked_path(models)?;
    let mut verifier = ModelVerifier::open(&state.db.root);
    for file in get(&pin.model)?.files(&artifact) {
        let path = file.checked_path(models)?;
        download::verify_model(&path, &file.specification(), &mut verifier, cancel, |_| {}).await?;
    }
    Ok((path, artifact))
}

pub fn activate(state: &AppState, pin: &Pin) -> Result<()> {
    ready_file(state, pin)?;
    let mut con = state.db.lock();
    let tx = con.transaction()?;
    tx.execute(
        "UPDATE stem_models SET active=0 WHERE model=?1",
        [&pin.model],
    )?;
    tx.execute(
        "UPDATE stem_models SET active=1 WHERE model=?1 AND repository=?2 AND revision=?3",
        params![pin.model, pin.repository, pin.revision],
    )?;
    tx.commit()?;
    Ok(())
}

mod hub;
mod install;
mod removal;
pub use hub::{check_connection, search, update, Hit};
pub use install::{discard, install};
pub use removal::{removal, remove, Removal};
