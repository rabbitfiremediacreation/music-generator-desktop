//! Shared offline title model for all music providers. Never changes generation parameters.
use crate::{
    download::{download_model, ensure_space, DownloadProgress},
    engine::process::OwnedProcess,
    error::{message, Error, Result},
    manifest::Model,
    verification::ModelVerifier,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub version: u32,
    pub revision: String,
    pub url: String,
    pub model: Model,
}
pub fn manifest() -> Manifest {
    serde_json::from_str(include_str!("../../models/title-model.json"))
        .expect("embedded title model")
}
pub fn executable(resources: &Path) -> PathBuf {
    resources.join("engine/title").join(if cfg!(windows) {
        "music-title.exe"
    } else {
        "music-title"
    })
}
pub fn status(root: &Path, verifier: &ModelVerifier) -> Value {
    let m = manifest().model;
    let path = root.join(&m.file);
    let mut value = json!(m);
    value["verified"] = json!(verifier.is_verified(&path, &m.sha256));
    value["present"] = json!(path.is_file());
    value["partial_bytes"] = json!(root
        .join(format!("{}.part", m.file))
        .metadata()
        .map(|v| v.len())
        .unwrap_or(0)
        .min(m.estimated_bytes));
    value
}
pub async fn install(
    data: &Path,
    root: &Path,
    cancel: &CancellationToken,
    progress: impl Fn(DownloadProgress),
) -> Result<()> {
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    let pin = manifest();
    tokio::fs::create_dir_all(root).await?;
    let mut verifier = ModelVerifier::open(data);
    if verifier.is_verified(&root.join(&pin.model.file), &pin.model.sha256) {
        return Ok(());
    }
    let partial = root
        .join(format!("{}.part", pin.model.file))
        .metadata()
        .map(|v| v.len())
        .unwrap_or(0);
    if !root.join(&pin.model.file).is_file() {
        ensure_space(
            root,
            pin.model.estimated_bytes.saturating_sub(partial) + 64 * 1024 * 1024,
        )?;
    }
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .read_timeout(Duration::from_secs(60))
        .build()?;
    download_model(
        &client,
        &pin.url,
        root,
        &pin.model,
        &mut verifier,
        cancel,
        progress,
    )
    .await
    .map(|_| ())
}

/// Generated lyrics describe the finished song. Section labels/instrumental markers are not lyrics.
pub fn request(params: &Value, meta: &Value) -> Value {
    let meaningful = |s: &str| {
        s.lines().any(|l| {
            let l = l.trim();
            !l.is_empty()
                && !(l.starts_with('[') && l.ends_with(']'))
                && l.chars().any(char::is_alphabetic)
        })
    };
    let lyrics = if params["instrumental"].as_bool().unwrap_or(false) {
        ""
    } else {
        meta["lyrics"]
            .as_str()
            .filter(|s| meaningful(s))
            .or_else(|| params["lyrics"].as_str().filter(|s| meaningful(s)))
            .unwrap_or("")
    };
    let prompt = params["caption"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| params["prompt"].as_str())
        .unwrap_or("");
    // Bound UTF-8 before JSON encoding; preserve both ends, including the final chorus.
    fn bound(s: &str, n: usize) -> String {
        let chars: Vec<char> = s.chars().collect();
        if chars.len() <= n {
            s.into()
        } else {
            chars[..n * 2 / 3]
                .iter()
                .chain(chars[chars.len() - n / 3..].iter())
                .collect()
        }
    }
    json!({"lyrics":bound(lyrics,8000),"prompt":bound(prompt,1200)})
}
/// Removes model labels and surrounding punctuation without altering title contents.
pub fn clean(output: &str) -> Result<String> {
    let line = output
        .lines()
        .map(str::trim)
        .find(|s| !s.is_empty())
        .ok_or_else(|| message("Title model returned no title"))?;
    let line = ["The song title is", "Title:", "Titel:"]
        .into_iter()
        .find_map(|prefix| {
            let label = line.get(..prefix.len())?;
            let title = line.get(prefix.len()..)?;
            if !label.eq_ignore_ascii_case(prefix)
                || (!prefix.ends_with(':')
                    && title
                        .chars()
                        .next()
                        .is_some_and(|ch| ch.is_alphanumeric() || ch == '_'))
            {
                return None;
            }
            Some(title.trim().trim_start_matches(':').trim())
        })
        .unwrap_or(line);
    let wrapper = |ch: char| {
        ch.is_whitespace()
            || matches!(
                ch,
                '"' | '\'' | '“' | '”' | '„' | '‘' | '’' | '«' | '»' | '`'
            )
    };
    let line = line
        .trim_start_matches(wrapper)
        .trim_end_matches(|ch| wrapper(ch) || ch == '.');
    if line.is_empty()
        || !line.chars().any(char::is_alphanumeric)
        || line.contains(['<', '>'])
        || line.chars().any(char::is_control)
        || line.chars().count() > 120
    {
        return Err(message("Title model returned an invalid title"));
    }
    Ok(line.into())
}
pub async fn probe(resources: &Path, cancel: &CancellationToken) -> Result<String> {
    let mut command = tokio::process::Command::new(executable(resources));
    command.arg("--self-test").kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let output = tokio::select! { _=cancel.cancelled()=>return Err(Error::Cancelled), r=tokio::time::timeout(Duration::from_secs(30),command.output())=>r.map_err(|_|message("Title runtime test timed out"))?? };
    if !output.status.success() {
        return Err(message("Title runtime test failed"));
    }
    Ok(format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    ))
}
pub async fn generate(
    resources: &Path,
    data: &Path,
    models: &Path,
    input: &Value,
    cancel: &CancellationToken,
    progress: impl Fn(crate::engine::progress::Progress),
) -> Result<String> {
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    let pin = manifest();
    let mut verifier = ModelVerifier::open(data);
    if verifier
        .verify(
            &models.join(&pin.model.file),
            &pin.model.sha256,
            cancel,
            |_, _| {},
        )
        .await?
        == crate::verification::Verification::Invalid
    {
        return Err(message(
            "Title model is missing or invalid. Download it in the ModelPicker",
        ));
    }
    let folder = data.join("title-work").join(crate::types::id());
    tokio::fs::create_dir_all(&folder).await?;
    let result=async {
        let request=folder.join("request.json"); let output=folder.join("title.txt");
        tokio::fs::write(&request,serde_json::to_vec(input)?).await?;
        tokio::fs::create_dir_all(data.join("logs")).await?;
        let args=vec!["--model".into(),models.join(&pin.model.file).to_string_lossy().into(),"--request".into(),request.to_string_lossy().into(),"--out".into(),output.to_string_lossy().into()];
        let mut process=OwnedProcess::spawn(&executable(resources),&args,true,&data.join("logs/title.log"))?;
        let started=Instant::now();
        loop {
            if cancel.is_cancelled() { return Err(Error::Cancelled); }
            if started.elapsed()>=Duration::from_secs(90) { return Err(message("Automatic title generation timed out")); }
            if let Some(status)=process.status()? { if !status.success() { return Err(message("Automatic title generation failed. See title.log")); } break; }
            let mut update=crate::engine::progress::Progress::new("title"); update.elapsed_seconds=started.elapsed().as_secs(); progress(update);
            tokio::select! { _=cancel.cancelled()=>return Err(Error::Cancelled), _=tokio::time::sleep(Duration::from_millis(250))=>{} }
        }
        let raw=tokio::fs::read(&output).await?;
        if raw.len()>1024 { return Err(message("Title model output is too long")); }
        clean(std::str::from_utf8(&raw).map_err(|_|message("Title model output is not UTF-8"))?)
    }.await;
    let _ = tokio::fs::remove_dir_all(folder).await;
    result
}
