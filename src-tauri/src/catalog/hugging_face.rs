//! Discover files in engine-specific Hub repositories and retain explicitly accepted pins.
use super::{embedded_catalog, Asset, AssetSource, Catalog, ProviderProfile, Selection};
use crate::error::{message, Result};
use reqwest::{header, Client, Response, StatusCode};
use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    io::{Read, Write},
    path::Path,
    sync::{Mutex, MutexGuard, OnceLock},
    time::Duration,
};

const ACE: &str = "Serveurperso/ACE-Step-1.5-GGUF";
const YUE: &str = "Serveurperso/YuE2-GGUF";
const AUDIO_CPP: &str = "audio-cpp/audio.cpp-gguf";
const HEARTMULA_HNY: &str = "themindstudio/HeartMuLa-GGUF";
const REPOSITORIES: [&str; 4] = [ACE, YUE, AUDIO_CPP, HEARTMULA_HNY];
const MAX_METADATA: usize = 4 * 1024 * 1024;
const HEADER_BYTES: usize = 64 * 1024;
const REGISTRY_FILE: &str = "hugging-face-models.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct Pin {
    source: AssetSource,
    bytes: u64,
    sha256: String,
}

#[derive(Serialize)]
pub(crate) struct Candidate {
    pin: Pin,
    provider: String,
    role: String,
    family: String,
    precision: String,
    estimated_ram_bytes: Option<u64>,
    selection: Option<Selection>,
}

#[derive(Serialize)]
pub(crate) struct Discovery {
    candidates: Vec<Candidate>,
    unavailable_repositories: Vec<&'static str>,
}

#[derive(Deserialize)]
struct Repository {
    sha: String,
    siblings: Vec<Sibling>,
}

#[derive(Deserialize)]
struct Sibling {
    rfilename: String,
    size: Option<u64>,
    lfs: Option<Lfs>,
}

#[derive(Deserialize)]
struct Lfs {
    size: u64,
    sha256: String,
}

impl Repository {
    fn pins(self, repository: &str) -> impl Iterator<Item = Pin> + '_ {
        self.siblings.into_iter().filter_map(move |sibling| {
            let lfs = sibling.lfs?;
            (sibling.size? == lfs.size).then(|| Pin {
                source: AssetSource {
                    repository: repository.into(),
                    revision: self.sha.clone(),
                    path: sibling.rfilename,
                },
                bytes: lfs.size,
                sha256: lfs.sha256,
            })
        })
    }
}

struct Variant {
    canonical_file: String,
    asset: Asset,
    profile: Option<ProviderProfile>,
    architecture: &'static str,
    package_family: Option<&'static str>,
}

const STABLE_AUDIO: [(&str, &str); 3] = [
    (
        "Stable-Audio-3-Small-Music-GGUF",
        "stable-audio-3-small-music",
    ),
    ("Stable-Audio-3-Medium-GGUF", "stable-audio-3-medium"),
    ("Stable-Audio-3-Small-SFX-GGUF", "stable-audio-3-small-sfx"),
];

fn hex(value: &str, len: usize) -> bool {
    value.len() == len
        && value
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

fn variant(catalog: &Catalog, pin: &Pin) -> Option<Variant> {
    if !hex(&pin.source.revision, 40)
        || !hex(&pin.sha256, 64)
        || !(HEADER_BYTES as u64..=64 * 1024_u64.pow(3)).contains(&pin.bytes)
    {
        return None;
    }
    let path = pin.source.path.as_str();
    let name = path.strip_suffix(".gguf")?;
    let (template, file, precision, profile_id, architecture, package_family) =
        match pin.source.repository.as_str() {
            ACE => {
                let (family, precision) = name.rsplit_once('-')?;
                let template = catalog.models.iter().find(|asset| {
                    asset.provider == "ace-step"
                        && asset.family == family
                        && asset.precision == "Q8_0"
                        && matches!(asset.role.as_str(), "synthesis" | "language")
                })?;
                let architecture = if template.role == "synthesis" {
                    if !matches!(precision, "BF16" | "Q4_K_M" | "Q5_K_M" | "Q6_K" | "Q8_0") {
                        return None;
                    }
                    "acestep-dit"
                } else {
                    // Lower-bit LM variants can break the model's audio-code output.
                    if !matches!(precision, "BF16" | "Q8_0")
                        && !(family == "acestep-5Hz-lm-4B"
                            && matches!(precision, "Q5_K_M" | "Q6_K"))
                    {
                        return None;
                    }
                    "acestep-lm"
                };
                (
                    template.file.as_str(),
                    path.into(),
                    precision,
                    None,
                    architecture,
                    None,
                )
            }
            YUE => {
                let precision = name.strip_prefix("YuE2-3B-")?;
                if !matches!(precision, "BF16" | "Q5_K_M" | "Q6_K" | "Q8_0") {
                    return None;
                }
                let template = "yue2/YuE2-3B-Q8_0.gguf";
                (
                    template,
                    format!("yue2/{path}"),
                    precision,
                    Some(template),
                    "yue2",
                    None,
                )
            }
            HEARTMULA_HNY if path == "heartmula-q8_0.gguf" => {
                let file = "heartmula-gguf/HeartMuLa-oss-3B-HNY-Q8_0.gguf";
                (
                    file,
                    file.into(),
                    "Q8_0",
                    Some("heartmula-oss-3b-hny-q8_0"),
                    "audiocpp",
                    Some("heartmula"),
                )
            }
            AUDIO_CPP => {
                let (folder, filename) = name.split_once('/')?;
                let (stem, precision) = filename.rsplit_once('-')?;
                let precision = match precision {
                    "f16" => "F16",
                    "q8_0" => "Q8_0",
                    _ => return None,
                };
                if (folder, stem) == ("MuLaCover-GGUF", "mulacover") {
                    (
                        "mulacover/MuLaCover-Q8_0.gguf",
                        format!("mulacover/MuLaCover-{precision}.gguf"),
                        precision,
                        Some("mulacover-noncommercial"),
                        "audiocpp",
                        Some("mulacover"),
                    )
                } else if (folder, stem) == ("HeartMuLa-GGUF", "heartmula") {
                    (
                        "heartmula-gguf/HeartMuLa-oss-3B-Q8_0.gguf",
                        format!("heartmula-gguf/HeartMuLa-oss-3B-{precision}.gguf"),
                        precision,
                        Some("heartmula-oss-3b-q8_0"),
                        "audiocpp",
                        Some("heartmula"),
                    )
                } else {
                    STABLE_AUDIO
                        .iter()
                        .find(|entry| **entry == (folder, stem))?;
                    let profile = catalog.profiles.iter().find(|p| {
                        p.selection.provider == "stable-audio-3"
                            && p.selection.synthesis.strip_suffix("-q8_0") == Some(stem)
                    })?;
                    (
                        profile.files.first()?.as_str(),
                        format!("{stem}/{filename}.gguf"),
                        precision,
                        Some(profile.selection.synthesis.as_str()),
                        "audiocpp",
                        Some("stable_audio"),
                    )
                }
            }
            _ => return None,
        };
    let mut asset = catalog
        .models
        .iter()
        .find(|asset| asset.file == file)
        .or_else(|| catalog.models.iter().find(|asset| asset.file == template))?
        .clone();
    let canonical_file = file;
    let digest = &pin.sha256[..16];
    // Keep accepted files addressable when the Hub publishes replacement weights
    // or a later app release ships a curated pin using the original filename.
    let file = format!("{}-hf-{digest}.gguf", canonical_file.strip_suffix(".gguf")?);
    let profile = match profile_id {
        None => None,
        Some(id) => {
            let mut profile = catalog
                .profiles
                .iter()
                .find(|p| p.selection.provider == asset.provider && p.files.contains(&asset.file))?
                .clone();
            let weight = profile.files.iter_mut().find(|f| **f == asset.file)?;
            *weight = file.clone();
            profile.selection.synthesis = match pin.source.repository.as_str() {
                YUE => file.clone(),
                _ if asset.provider == "mulacover" => {
                    format!("{id}-{}-hf-{digest}", precision.to_ascii_lowercase())
                }
                _ if asset.provider == "heartmula" => {
                    if let Some(source) = profile.upstream_sources.first_mut() {
                        source.revision.clone_from(&pin.source.revision);
                        source.source_url = Some(format!(
                            "https://huggingface.co/{}/blob/{}/{}",
                            pin.source.repository, pin.source.revision, pin.source.path
                        ));
                    }
                    file.clone()
                }
                _ => format!(
                    "{}-{}-hf-{digest}",
                    asset.family,
                    precision.to_ascii_lowercase()
                ),
            };
            let extra_bytes = pin.bytes.saturating_sub(asset.estimated_bytes);
            profile.estimated_ram_bytes = profile
                .estimated_ram_bytes
                .saturating_sub(asset.estimated_bytes)
                .saturating_add(pin.bytes);
            for platform in profile
                .platforms
                .iter_mut()
                .chain(&mut profile.evaluation_platforms)
            {
                platform.minimum_ram_bytes = platform.minimum_ram_bytes.saturating_add(extra_bytes);
                platform.minimum_vram_bytes = platform
                    .minimum_vram_bytes
                    .map(|bytes| bytes.saturating_add(extra_bytes));
            }
            profile.expert_only = true;
            Some(profile)
        }
    };
    asset.file = file;
    asset.precision = precision.into();
    asset.estimated_bytes = pin.bytes;
    asset.sha256 = pin.sha256.clone();
    asset.source = Some(pin.source.clone());
    asset.hf_discovered = true;
    Some(Variant {
        canonical_file,
        asset,
        profile,
        architecture,
        package_family,
    })
}

fn known(catalog: &Catalog, variant: &Variant, current: &Selection) -> Result<Option<Selection>> {
    let same_bytes = |asset: &Asset| {
        asset.sha256 == variant.asset.sha256
            && asset.estimated_bytes == variant.asset.estimated_bytes
    };
    let registered = catalog
        .models
        .iter()
        .find(|asset| asset.file == variant.asset.file);
    if registered.is_some_and(|asset| !same_bytes(asset)) {
        return Err(message("hf_model_conflict"));
    }
    let Some(asset) = registered.or_else(|| {
        catalog
            .models
            .iter()
            .find(|asset| asset.file == variant.canonical_file && same_bytes(asset))
    }) else {
        if variant
            .profile
            .as_ref()
            .is_some_and(|p| catalog.profile(&p.selection).is_some())
        {
            return Err(message("hf_model_conflict"));
        }
        return Ok(None);
    };
    let selection = if asset.provider == "ace-step" {
        let mut selection = if current.provider == "ace-step" && catalog.required(current).is_ok() {
            current.clone()
        } else {
            Selection {
                provider: asset.provider.clone(),
                synthesis: catalog
                    .basic_models
                    .synthesis
                    .first()
                    .cloned()
                    .unwrap_or_default(),
                language: catalog
                    .basic_models
                    .language
                    .first()
                    .cloned()
                    .unwrap_or_default(),
            }
        };
        if asset.role == "synthesis" {
            selection.synthesis.clone_from(&asset.file);
        } else {
            selection.language.clone_from(&asset.file);
        }
        selection
    } else {
        catalog
            .profiles
            .iter()
            .find(|profile| {
                profile.selection.provider == asset.provider && profile.files.contains(&asset.file)
            })
            .ok_or_else(|| message("hf_model_unsupported"))?
            .selection
            .clone()
    };
    catalog.required(&selection)?;
    Ok(Some(selection))
}

fn append(catalog: &mut Catalog, variant: Variant) {
    catalog.models.push(variant.asset);
    catalog.profiles.extend(variant.profile);
}

#[derive(Default, Serialize, Deserialize)]
struct Registry {
    pins: Vec<Pin>,
}

impl Registry {
    fn load(root: &Path) -> std::io::Result<Self> {
        let file = match File::open(root.join(REGISTRY_FILE)) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self::default())
            }
            Err(error) => return Err(error),
        };
        Ok(serde_json::from_reader(file.take(MAX_METADATA as u64))?)
    }

    fn extend(&self, catalog: &mut Catalog) {
        for pin in &self.pins {
            if let Some(candidate) = variant(catalog, pin) {
                if !catalog
                    .models
                    .iter()
                    .any(|asset| asset.file == candidate.asset.file)
                    && candidate
                        .profile
                        .as_ref()
                        .is_none_or(|p| catalog.profile(&p.selection).is_none())
                {
                    append(catalog, candidate);
                }
            }
        }
    }

    fn store(&self, root: &Path) -> Result<()> {
        let mut file = tempfile::NamedTempFile::new_in(root)?;
        serde_json::to_writer(&mut file, self)?;
        file.flush()?;
        file.as_file().sync_all()?;
        file.persist(root.join(REGISTRY_FILE))
            .map_err(|error| error.error)?;
        Ok(())
    }
}

static REGISTRY: OnceLock<Mutex<Option<Registry>>> = OnceLock::new();

fn registry() -> MutexGuard<'static, Option<Registry>> {
    REGISTRY
        .get_or_init(|| Mutex::new(None))
        .lock()
        .unwrap_or_else(|error| error.into_inner())
}

pub(crate) fn initialize(root: &Path) {
    match Registry::load(root) {
        Ok(loaded) => *registry() = Some(loaded),
        Err(error) => tracing::warn!(%error, "Could not read Hugging Face model pins"),
    }
}

pub(super) fn extend(catalog: &mut Catalog) {
    if let Some(registry) = registry().as_ref() {
        registry.extend(catalog);
    }
}

fn client() -> Result<Client> {
    Ok(Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let url = attempt.url();
            let allowed = url.host_str().is_some_and(|host| {
                matches!(host, "huggingface.co" | "cas-bridge.xethub.hf.co")
                    || host.ends_with(".cdn.hf.co")
                    || (host.starts_with("cdn-lfs")
                        && (host.ends_with(".huggingface.co") || host.ends_with(".hf.co")))
            });
            if url.scheme() == "https" && allowed && attempt.previous().len() < 4 {
                attempt.follow()
            } else {
                attempt.error("Unapproved Hugging Face redirect")
            }
        }))
        .build()?)
}

async fn bounded_body(mut response: Response, limit: usize) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if chunk.len() > limit - bytes.len() {
            return Err(message("Hugging Face response exceeds size limit"));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

async fn repository(client: &Client, name: &str, revision: Option<&str>) -> Result<Repository> {
    let base = format!("https://huggingface.co/api/models/{name}");
    let url = revision.map_or(base.clone(), |revision| {
        format!("{base}/revision/{revision}")
    });
    let response = client
        .get(url)
        .query(&[("blobs", "true")])
        .send()
        .await?
        .error_for_status()?;
    let data: Repository = serde_json::from_slice(&bounded_body(response, MAX_METADATA).await?)?;
    if !hex(&data.sha, 40) || revision.is_some_and(|revision| data.sha != revision) {
        return Err(message("Invalid Hugging Face revision"));
    }
    Ok(data)
}

pub(crate) async fn discover(current: &Selection) -> Result<Discovery> {
    let client = client()?;
    let (ace, yue, audio, heartmula) = tokio::join!(
        repository(&client, ACE, None),
        repository(&client, YUE, None),
        repository(&client, AUDIO_CPP, None),
        repository(&client, HEARTMULA_HNY, None),
    );
    let mut discovery = Discovery {
        candidates: Vec::new(),
        unavailable_repositories: Vec::new(),
    };
    let catalog = super::catalog();
    for (name, data) in REPOSITORIES.into_iter().zip([ace, yue, audio, heartmula]) {
        let data = match data {
            Ok(data) => data,
            Err(_) => {
                // HTTP errors can include signed redirect URLs. Keep them out of diagnostics.
                tracing::warn!(repository = name, "Hugging Face repository unavailable");
                discovery.unavailable_repositories.push(name);
                continue;
            }
        };
        discovery
            .candidates
            .extend(data.pins(name).filter_map(|pin| {
                let candidate = variant(&catalog, &pin)?;
                let selection = known(&catalog, &candidate, current).ok()?;
                Some(Candidate {
                    pin,
                    provider: candidate.asset.provider,
                    role: candidate.asset.role,
                    family: candidate.asset.family,
                    precision: candidate.asset.precision,
                    estimated_ram_bytes: candidate
                        .profile
                        .map(|profile| profile.estimated_ram_bytes),
                    selection,
                })
            }));
    }
    discovery.candidates.sort_by(|a, b| {
        a.selection
            .is_some()
            .cmp(&b.selection.is_some())
            .then_with(|| a.family.cmp(&b.family))
            .then_with(|| a.precision.cmp(&b.precision))
    });
    Ok(discovery)
}

pub(crate) async fn adopt(
    root: &Path,
    pin: Pin,
    current: &Selection,
    expert: bool,
) -> Result<Selection> {
    let catalog = super::catalog();
    let candidate = variant(&catalog, &pin).ok_or_else(|| message("hf_model_unsupported"))?;
    if let Some(selection) = known(&catalog, &candidate, current)? {
        return Ok(selection);
    }
    if !expert {
        return Err(message("expert_mode_required"));
    }
    let client = client()?;
    let metadata = repository(&client, &pin.source.repository, Some(&pin.source.revision))
        .await
        .map_err(|_| message("hf_metadata_unavailable"))?;
    if !metadata
        .pins(&pin.source.repository)
        .any(|published| published == pin)
    {
        return Err(message("hf_model_changed"));
    }
    validate_header(&client, &pin, &candidate).await?;

    let mut guard = registry();
    let registry = guard
        .as_mut()
        .ok_or_else(|| message("hf_pins_unavailable"))?;
    let mut catalog = embedded_catalog();
    registry.extend(&mut catalog);
    if let Some(selection) = known(&catalog, &candidate, current)? {
        return Ok(selection);
    }
    let mut next = Registry {
        pins: registry.pins.clone(),
    };
    next.pins.push(pin);
    let mut updated = catalog.clone();
    next.extend(&mut updated);
    let selection =
        known(&updated, &candidate, current)?.ok_or_else(|| message("hf_model_unsupported"))?;
    next.store(root)?;
    *registry = next;
    Ok(selection)
}

async fn validate_header(client: &Client, pin: &Pin, candidate: &Variant) -> Result<()> {
    let last = HEADER_BYTES - 1;
    let response = client
        .get(pin.source.url())
        .header(header::RANGE, format!("bytes=0-{last}"))
        .send()
        .await
        .map_err(|_| message("hf_metadata_unavailable"))?;
    let expected_range = format!("bytes 0-{last}/{}", pin.bytes);
    if response.status() != StatusCode::PARTIAL_CONTENT
        || response
            .headers()
            .get(header::CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
            != Some(&expected_range)
    {
        return Err(message("hf_model_header"));
    }
    let body = bounded_body(response, HEADER_BYTES)
        .await
        .map_err(|_| message("hf_model_header"))?;
    let model_name = match candidate.asset.family.as_str() {
        "heartmula-hny" => Some("HeartMuLa-oss-3B-happy-new-year"),
        "heartmula-oss-3b" => Some("HeartMuLa"),
        _ => None,
    };
    if body.len() != HEADER_BYTES
        || !gguf::matches(
            &body,
            candidate.architecture,
            candidate.package_family,
            &candidate.asset.precision,
            model_name,
        )
    {
        return Err(message("hf_model_header"));
    }
    Ok(())
}

mod gguf;

#[cfg(test)]
mod tests {
    use super::*;

    fn pin(repository: &str, path: &str) -> Pin {
        Pin {
            source: AssetSource {
                repository: repository.into(),
                revision: "a".repeat(40),
                path: path.into(),
            },
            bytes: 3 * 1024_u64.pow(3),
            sha256: "b".repeat(64),
        }
    }

    fn starter() -> Selection {
        Selection {
            provider: "ace-step".into(),
            synthesis: "acestep-v15-sft-Q8_0.gguf".into(),
            language: "acestep-5Hz-lm-0.6B-Q8_0.gguf".into(),
        }
    }

    #[test]
    fn accepts_only_weight_files_matching_engine_and_quantization() {
        let catalog = embedded_catalog();
        for (repo, path) in [
            (ACE, "acestep-v15-sftturbo50-Q5_K_M.gguf"),
            (ACE, "acestep-5Hz-lm-4B-Q6_K.gguf"),
            (YUE, "YuE2-3B-BF16.gguf"),
            (
                AUDIO_CPP,
                "Stable-Audio-3-Small-SFX-GGUF/stable-audio-3-small-sfx-q8_0.gguf",
            ),
            (AUDIO_CPP, "MuLaCover-GGUF/mulacover-f16.gguf"),
        ] {
            assert!(variant(&catalog, &pin(repo, path)).is_some(), "{path}");
        }
        for (repo, path) in [
            ("somewhere/else", "acestep-v15-sft-Q8_0.gguf"),
            (ACE, "../acestep-v15-sft-Q8_0.gguf"),
            (ACE, "acestep-5Hz-lm-0.6B-Q5_K_M.gguf"),
            (ACE, "acestep-5Hz-lm-4B-Q4_K_M.gguf"),
            (ACE, "Qwen3-Embedding-0.6B-Q8_0.gguf"),
            (YUE, "YuE2-Vae-F32.gguf"),
            (YUE, "YuE2-3B-Q8_0-00001-of-00002.gguf"),
            (
                AUDIO_CPP,
                "Stable-Audio-3-Medium-GGUF/stable-audio-3-small-music-f16.gguf",
            ),
            (
                AUDIO_CPP,
                "Stable-Audio-3-Medium-GGUF/stable-audio-3-medium-Q4_K_M.gguf",
            ),
            (AUDIO_CPP, "MiDashengLM-GGUF/midashenglm-f16.gguf"),
        ] {
            assert!(variant(&catalog, &pin(repo, path)).is_none(), "{path}");
        }
    }

    #[test]
    fn persisted_variant_restores_dependencies_and_stays_out_of_recommendations() {
        let root = tempfile::tempdir().unwrap();
        let accepted = pin(ACE, "acestep-v15-sftturbo50-Q5_K_M.gguf");
        let curated = embedded_catalog();
        let base_settings = starter();
        let hardware = crate::hardware::inspect();
        let mut replacement = accepted.clone();
        replacement.source.revision = "d".repeat(40);
        replacement.sha256 = "c".repeat(64);
        let mut conflicting = accepted.clone();
        conflicting.sha256.replace_range(16.., &"e".repeat(48));
        Registry {
            pins: vec![accepted.clone(), replacement.clone(), conflicting.clone()],
        }
        .store(root.path())
        .unwrap();

        let mut restored = embedded_catalog();
        Registry::load(root.path()).unwrap().extend(&mut restored);
        let candidate = variant(&restored, &accepted).unwrap();
        let selection = known(&restored, &candidate, &base_settings)
            .unwrap()
            .unwrap();
        assert_eq!(selection.language, base_settings.language);
        let required = restored.required(&selection).unwrap();
        let weight = &required[0];
        assert_eq!(weight.source.as_ref(), Some(&accepted.source));
        assert_eq!(weight.sha256, accepted.sha256);
        assert_eq!(weight.estimated_bytes, accepted.bytes);
        let replacement_selection = known(
            &restored,
            &variant(&restored, &replacement).unwrap(),
            &base_settings,
        )
        .unwrap()
        .unwrap();
        assert_ne!(selection.synthesis, replacement_selection.synthesis);
        let replacement_weight = &restored.required(&replacement_selection).unwrap()[0];
        assert_eq!(
            replacement_weight.source.as_ref(),
            Some(&replacement.source)
        );
        assert_eq!(
            &required[1..]
                .iter()
                .map(|asset| &asset.file)
                .collect::<Vec<_>>(),
            &curated.required(&base_settings).unwrap()[1..]
                .iter()
                .map(|asset| &asset.file)
                .collect::<Vec<_>>()
        );
        assert_eq!(
            restored.recommended_profiles(hardware),
            curated.recommended_profiles(hardware)
        );
        assert!(restored
            .ensure_allowed(&selection, false, Some(hardware))
            .is_err());
        assert!(restored.ensure_allowed(&selection, true, None).is_ok());
        assert!(known(
            &restored,
            &variant(&restored, &conflicting).unwrap(),
            &base_settings
        )
        .is_err());
    }

    #[test]
    fn native_variants_keep_runtime_dependencies_and_policy() {
        let mut catalog = embedded_catalog();
        let yue = pin(YUE, "YuE2-3B-Q8_0.gguf");
        let stable = pin(
            AUDIO_CPP,
            "Stable-Audio-3-Small-Music-GGUF/stable-audio-3-small-music-q8_0.gguf",
        );
        let registry = Registry {
            pins: vec![yue.clone(), stable.clone()],
        };
        for pin in &registry.pins {
            assert!(
                known(&catalog, &variant(&catalog, pin).unwrap(), &starter())
                    .unwrap()
                    .is_none()
            );
        }
        registry.extend(&mut catalog);
        let select = |pin| {
            known(&catalog, &variant(&catalog, pin).unwrap(), &starter())
                .unwrap()
                .unwrap()
        };
        let yue = select(&yue);
        let stable = select(&stable);
        assert!(catalog.profile(&yue).unwrap().expert_only);
        let yue_files = catalog.required(&yue).unwrap();
        assert_eq!(yue_files[0].file, yue.synthesis);
        assert_eq!(yue_files[1].file, "yue2/YuE2-Vae-F32.gguf");
        let yue_curated = catalog
            .profiles
            .iter()
            .find(|p| p.selection.synthesis == "yue2/YuE2-3B-Q8_0.gguf")
            .unwrap();
        let original_weight = catalog.required(&yue_curated.selection).unwrap()[0].estimated_bytes;
        assert_eq!(
            catalog.profile(&yue).unwrap().estimated_ram_bytes,
            yue_curated.estimated_ram_bytes - original_weight + yue_files[0].estimated_bytes
        );
        assert!(catalog.profile(&stable).unwrap().expert_only);
        assert_eq!(
            catalog.profile(&stable).unwrap().acquisition,
            super::super::Acquisition::Manual
        );
    }

    #[tokio::test]
    #[ignore = "requires access to Hugging Face"]
    async fn live_repository_metadata_and_gguf_prefixes() {
        let catalog = embedded_catalog();
        let found = discover(&starter()).await.unwrap();
        assert!(
            found.unavailable_repositories.is_empty(),
            "{:?}",
            found.unavailable_repositories
        );
        let client = client().unwrap();
        for path in [
            "acestep-v15-sft-Q8_0.gguf",
            "acestep-5Hz-lm-0.6B-Q8_0.gguf",
            "YuE2-3B-Q8_0.gguf",
            "Stable-Audio-3-Small-Music-GGUF/stable-audio-3-small-music-q8_0.gguf",
            "Stable-Audio-3-Medium-GGUF/stable-audio-3-medium-f16.gguf",
            "Stable-Audio-3-Small-SFX-GGUF/stable-audio-3-small-sfx-f16.gguf",
            "MuLaCover-GGUF/mulacover-f16.gguf",
            "HeartMuLa-GGUF/heartmula-f16.gguf",
            "HeartMuLa-GGUF/heartmula-q8_0.gguf",
            "heartmula-q8_0.gguf",
        ] {
            let row = found
                .candidates
                .iter()
                .find(|row| row.pin.source.path == path)
                .unwrap_or_else(|| panic!("Missing {path}"));
            assert!(row.selection.is_some());
            let candidate = variant(&catalog, &row.pin).unwrap();
            validate_header(&client, &row.pin, &candidate)
                .await
                .unwrap_or_else(|error| panic!("{path}: {error}"));
        }
        let pin = &found.candidates[0].pin;
        assert!(
            repository(&client, &pin.source.repository, Some(&pin.source.revision))
                .await
                .unwrap()
                .pins(&pin.source.repository)
                .any(|published| published == *pin)
        );
        let new_count = found
            .candidates
            .iter()
            .filter(|row| row.selection.is_none())
            .count();
        eprintln!(
            "{} compatible files across {} repositories, {new_count} new variants",
            found.candidates.len(),
            REPOSITORIES.len()
        );
    }
}
