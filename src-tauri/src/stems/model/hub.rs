use super::{get, FilePin, Pin, Profile, PROFILES};
use crate::{
    error::{message, Error, Result},
    state::AppState,
};
use reqwest::{Client, Response, StatusCode, Url};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio_util::sync::CancellationToken;

#[derive(Clone, Deserialize)]
pub struct HubModel {
    pub id: String,
    sha: Option<String>,
    #[serde(default)]
    private: bool,
    #[serde(default)]
    gated: serde_json::Value,
    #[serde(rename = "cardData", default)]
    card: serde_json::Value,
    #[serde(default)]
    siblings: Vec<Sibling>,
}

#[derive(Clone, Deserialize)]
struct Sibling {
    rfilename: String,
    lfs: Option<Lfs>,
}

#[derive(Clone, Deserialize)]
struct Lfs {
    sha256: String,
    size: u64,
}

impl HubModel {
    pub fn candidate(&self, profile: &Profile) -> Option<(Pin, FilePin)> {
        let revision = self.sha.as_ref()?;
        if !valid_revision(revision) || repository_id(&self.id).as_deref() != Some(&self.id) {
            return None;
        }
        if self.id == profile.repository && revision == profile.revision {
            return Some((profile.pin(), profile.artifact.pinned()));
        }
        if !self
            .siblings
            .iter()
            .any(|file| file.rfilename == profile.configuration.file)
        {
            return None;
        }
        let file = self
            .siblings
            .iter()
            .find(|file| file.rfilename == profile.artifact.file)?;
        let lfs = file.lfs.as_ref()?;
        let artifact = FilePin {
            file: file.rfilename.clone(),
            bytes: lfs.size,
            sha256: lfs.sha256.clone(),
        };
        if !artifact.valid()
            || (self.id != profile.repository && artifact != profile.artifact.pinned())
        {
            return None;
        }
        Some((
            Pin {
                model: profile.id.into(),
                repository: self.id.clone(),
                revision: revision.clone(),
            },
            artifact,
        ))
    }
}

fn valid_revision(revision: &str) -> bool {
    revision.len() == 40 && revision.bytes().all(|b| b.is_ascii_hexdigit())
}

fn repository_id(value: &str) -> Option<String> {
    let path = if value.contains("://") {
        let url = Url::parse(value).ok()?;
        if !crate::hugging_face_token::is_hub(&url) {
            return None;
        }
        url.path().trim_matches('/').to_owned()
    } else {
        value.to_owned()
    };
    let (owner, model) = path.split_once('/')?;
    [owner, model]
        .iter()
        .all(|part| {
            !part.is_empty()
                && part.len() <= 96
                && !part.starts_with(['.', '-'])
                && !part.ends_with(['.', '-'])
                && !part.contains("..")
                && part
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
        })
        .then_some(path)
}

async fn hub_request(root: &Path, url: Url, cancel: &CancellationToken) -> Result<Response> {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()?;
    let response = tokio::select! {
        _ = cancel.cancelled() => return Err(Error::Cancelled),
        response = crate::hugging_face_token::get(&client, url.as_str(), root)?.send() =>
            response.map_err(|_| message("stem_hf_offline"))?,
    };
    verify_status(response.status())?;
    Ok(response)
}

fn verify_status(status: StatusCode) -> Result<()> {
    match status {
        StatusCode::OK => Ok(()),
        StatusCode::UNAUTHORIZED => Err(message("stem_hf_unauthorized")),
        StatusCode::FORBIDDEN => Err(message("stem_hf_forbidden")),
        StatusCode::NOT_FOUND => Err(message("stem_hf_missing")),
        StatusCode::TOO_MANY_REQUESTS => Err(message("stem_hf_rate")),
        _ => Err(message("stem_hf_unavailable")),
    }
}

async fn metadata<T: for<'a> Deserialize<'a>>(
    root: &Path,
    url: Url,
    cancel: &CancellationToken,
) -> Result<T> {
    let mut response = hub_request(root, url, cancel).await?;
    let mut body = Vec::new();
    while let Some(chunk) = tokio::select! {
        _ = cancel.cancelled() => return Err(Error::Cancelled),
        chunk = response.chunk() => chunk.map_err(|_| message("stem_hf_offline"))?,
    } {
        if body.len() + chunk.len() > 4 * 1024 * 1024 {
            return Err(message("stem_hf_unavailable"));
        }
        body.extend(&chunk);
    }
    Ok(serde_json::from_slice(&body)?)
}

pub async fn hub_info(
    root: &Path,
    repo: &str,
    revision: Option<&str>,
    cancel: &CancellationToken,
) -> Result<HubModel> {
    let repo = repository_id(repo).ok_or_else(|| message("stem_hf_repository"))?;
    let mut url =
        Url::parse(&format!("https://huggingface.co/api/models/{repo}")).expect("validated URL");
    if let Some(revision) = revision {
        if !valid_revision(revision) {
            return Err(message("stem_hf_repository"));
        }
        url.path_segments_mut()
            .expect("HTTPS URL")
            .extend(["revision", revision]);
    }
    url.query_pairs_mut().append_pair("blobs", "true");
    let model: HubModel = metadata(root, url, cancel).await?;
    if revision.is_some_and(|revision| model.sha.as_deref() != Some(revision)) {
        return Err(message("stem_model_unconfirmed"));
    }
    Ok(model)
}

#[derive(Serialize)]
pub struct Hit {
    repository: String,
    revision: Option<String>,
    license: Option<String>,
    restricted: bool,
    pin: Option<Pin>,
    artifact: Option<FilePin>,
    adapter_check_required: bool,
}

impl From<HubModel> for Hit {
    fn from(model: HubModel) -> Self {
        let candidate = PROFILES.iter().find_map(|profile| {
            let (pin, artifact) = model.candidate(profile)?;
            let changed = artifact != profile.artifact.pinned();
            Some((pin, artifact, changed))
        });
        let (pin, artifact, adapter_check_required) = candidate
            .map_or((None, None, false), |(pin, artifact, changed)| {
                (Some(pin), Some(artifact), changed)
            });
        Self {
            repository: model.id,
            revision: model.sha,
            pin,
            artifact,
            adapter_check_required,
            license: model.card["license"].as_str().map(str::to_owned),
            restricted: model.private
                || model
                    .gated
                    .as_bool()
                    .unwrap_or_else(|| model.gated.is_string()),
        }
    }
}

pub async fn search(
    root: &Path,
    query: &str,
    limit: u8,
    cancel: &CancellationToken,
) -> Result<Vec<Hit>> {
    if let Some(repo) = repository_id(query) {
        return Ok(vec![hub_info(root, &repo, None, cancel).await?.into()]);
    }
    if query.contains("://") {
        return Err(message("stem_hf_repository"));
    }
    let mut url = Url::parse("https://huggingface.co/api/models").unwrap();
    let limit = limit.clamp(15, 60).to_string();
    url.query_pairs_mut()
        .append_pair("search", &query.chars().take(120).collect::<String>())
        .append_pair("filter", "music-source-separation")
        .append_pair("full", "true")
        .append_pair("cardData", "true")
        .append_pair("limit", &limit);
    let models: Vec<HubModel> = metadata(root, url, cancel).await?;
    Ok(models.into_iter().map(Into::into).collect())
}

pub async fn check_connection(root: &Path, cancel: &CancellationToken) -> Result<()> {
    if !crate::hugging_face_token::configured(root)? {
        return Err(message("stem_hf_unauthorized"));
    }
    hub_request(
        root,
        Url::parse("https://huggingface.co/api/whoami-v2").unwrap(),
        cancel,
    )
    .await?;
    Ok(())
}

pub async fn update(state: &AppState, id: &str, cancel: &CancellationToken) -> Result<Hit> {
    let profile = get(id)?;
    let repository: Option<String> = state
        .db
        .lock()
        .query_row(
            "SELECT repository FROM stem_models WHERE model=?1 AND active=1",
            [id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(hub_info(
        &state.db.root,
        repository.as_deref().unwrap_or(profile.repository),
        None,
        cancel,
    )
    .await?
    .into())
}

pub(super) fn download_error(error: Error) -> Error {
    match error {
        Error::Http(ref source) if source.status() == Some(StatusCode::TOO_MANY_REQUESTS) => {
            message("stem_hf_rate")
        }
        Error::Http(ref source) if source.is_connect() || source.is_timeout() => {
            message("stem_hf_offline")
        }
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compatibility_requires_exact_artifact_and_a_fixed_revision() {
        let profile = &PROFILES[0];
        let mut model = HubModel {
            id: "someone/weights".into(),
            sha: Some(profile.revision.into()),
            private: false,
            gated: serde_json::Value::Null,
            card: serde_json::Value::Null,
            siblings: vec![],
        };
        assert!(model.candidate(profile).is_none());
        model.siblings.push(Sibling {
            rfilename: profile.configuration.file.into(),
            lfs: None,
        });
        model.siblings.push(Sibling {
            rfilename: profile.artifact.file.into(),
            lfs: Some(Lfs {
                sha256: profile.artifact.sha256.into(),
                size: profile.artifact.bytes,
            }),
        });
        assert!(model.candidate(profile).is_some());
        model.sha = Some("main".into());
        assert!(model.candidate(profile).is_none());
    }

    #[test]
    fn hugging_face_errors_suggest_distinct_recovery_actions() {
        for (status, key) in [
            (StatusCode::UNAUTHORIZED, "stem_hf_unauthorized"),
            (StatusCode::FORBIDDEN, "stem_hf_forbidden"),
            (StatusCode::TOO_MANY_REQUESTS, "stem_hf_rate"),
        ] {
            assert_eq!(verify_status(status).unwrap_err().to_string(), key);
        }
    }

    #[test]
    fn model_urls_cannot_retarget_hub_requests_or_escape_model_paths() {
        assert_eq!(
            repository_id("https://huggingface.co/adefossez/HTDemucs").as_deref(),
            Some("adefossez/HTDemucs")
        );
        for path in [
            "../model",
            "name/../model",
            "a/repo%2Ffile",
            "https://huggingface.co:444/a/b",
            "https://huggingface.co.evil.test/a/b",
            "http://huggingface.co/a/b",
        ] {
            assert!(repository_id(path).is_none(), "{path}");
        }
    }
}
