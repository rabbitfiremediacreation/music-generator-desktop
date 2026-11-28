use crate::{
    db::safe_song_path,
    download::DownloadProgress,
    error::{message, Error, Result},
    manifest::Model,
    types::Song,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::Cursor,
    path::{Path, PathBuf},
    sync::OnceLock,
};
use tokio_util::sync::CancellationToken;

mod assets;
pub(super) mod batch;
pub(super) mod desktop;
mod inference;
#[cfg(test)]
mod tests;
pub(super) mod thumbnail;

const SIDE: u32 = 512;
pub(super) const EXTENSION: &str = "cover.png";

#[derive(Deserialize)]
struct Manifest {
    model: Checkpoint,
    engine_version: String,
    engines: HashMap<String, Model>,
}

#[derive(Deserialize)]
struct Checkpoint {
    url: String,
    revision: String,
    #[serde(flatten)]
    file: Model,
}

fn manifest() -> &'static Manifest {
    static MANIFEST: OnceLock<Manifest> = OnceLock::new();
    MANIFEST.get_or_init(|| {
        serde_json::from_str(include_str!("../../models/cover-art.json"))
            .expect("embedded cover art manifest")
    })
}

pub(crate) fn supported() -> bool {
    static SUPPORTED: OnceLock<bool> = OnceLock::new();
    *SUPPORTED.get_or_init(assets::supported)
}

pub(crate) fn installed(data: &Path, resources: &Path) -> bool {
    let root = data.join("cover-art");
    supported()
        && assets::engines()
            .last()
            .is_some_and(|(cpu, _)| assets::executable(&root, resources, cpu).is_file())
        && assets::installed_model(&root).is_some()
}

/// Acquire the fixed model and a CPU runtime, plus the GPU runtime where available.
async fn install(
    data: &Path,
    resources: &Path,
    cancel: &CancellationToken,
    progress: impl Fn(DownloadProgress),
) -> Result<()> {
    let Some(((cpu, _), accelerated)) = assets::engines().split_last().filter(|_| supported())
    else {
        return Err(message("cover_art_unsupported"));
    };
    let root = data.join("cover-art");
    let work = assets::Work::new(&root, cancel, progress).await?;
    for &(engine, _) in accelerated.iter().filter(|(engine, _)| engine != cpu) {
        match work.engine(resources, engine).await {
            Ok(_) => (),
            Err(Error::Cancelled) => return Err(Error::Cancelled),
            Err(error) => tracing::warn!(%error, engine, "Optional GPU cover engine unavailable"),
        }
    }
    work.engine(resources, cpu).await?;
    work.model().await?;
    Ok(())
}

pub(crate) fn output_path(root: &Path, id: &str, generated: bool) -> Option<PathBuf> {
    if !generated {
        return None;
    }
    let path = safe_song_path(root, &filename(id)?).ok()?;
    path.is_file().then_some(path)
}

fn filename(id: &str) -> Option<String> {
    (!id.is_empty()
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte)))
    .then(|| format!("{id}.{EXTENSION}"))
}

pub(super) struct Artwork {
    pub(super) png: Vec<u8>,
    pub(super) provenance: Value,
}

/// Prefer the finished description and user-provided title when building the picture prompt.
pub(super) async fn generate_for_song(
    data: &Path,
    resources: &Path,
    song: &Song,
    metadata: &Value,
    cancel: &CancellationToken,
) -> Result<Artwork> {
    let title = song
        .title
        .as_deref()
        .filter(|title| !title.trim().is_empty())
        .or_else(|| metadata["generated_title"].as_str())
        .unwrap_or_default();
    let caption = metadata["caption"]
        .as_str()
        .filter(|caption| !caption.trim().is_empty())
        .unwrap_or(&song.caption);
    generate(data, resources, title, caption, song.seed, cancel).await
}

/// Render original artwork from the song's title and musical description.
pub(super) async fn generate(
    data: &Path,
    resources: &Path,
    title: &str,
    caption: &str,
    seed: i64,
    cancel: &CancellationToken,
) -> Result<Artwork> {
    if !supported() {
        return Err(message("cover_art_unsupported"));
    }
    let root = data.join("cover-art");
    let weights =
        assets::installed_model(&root).ok_or_else(|| message("cover_art_install_required"))?;
    let seed = seed.max(0);
    let title: String = title.chars().take(96).collect();
    let caption: String = caption.chars().take(400).collect();
    let prompt = [
        "Square album cover artwork",
        title.trim(),
        caption.trim(),
        "expressive composition, no text, no lettering",
    ]
    .into_iter()
    .filter(|part| !part.is_empty())
    .collect::<Vec<_>>()
    .join(", ")
    .replace('\0', " ");
    let pin = manifest();
    let mut last_error = message(if cfg!(target_os = "macos") {
        "cover_art_engine_missing"
    } else {
        "cover_art_install_required"
    });
    for (engine, device_prefix) in assets::engines() {
        let executable = assets::executable(&root, resources, engine);
        if !executable.is_file() {
            continue;
        }
        let backend = match inference::device(&executable, &root, device_prefix, cancel).await {
            Ok(ready) => ready,
            Err(Error::Cancelled) => return Err(Error::Cancelled),
            Err(error) => {
                tracing::warn!(%error, engine, device_prefix, "Cover art engine unavailable");
                last_error = error;
                continue;
            }
        };
        let render = inference::render(
            &root,
            &executable,
            &weights,
            &backend,
            &prompt,
            seed,
            cancel,
        )
        .await;
        match render {
            Ok(png) => {
                return Ok(Artwork {
                    png,
                    provenance: json!({
                        "model": "SDXS-512 DreamShaper",
                        "revision": pin.model.revision,
                        "engine_version": pin.engine_version,
                        "backend": backend,
                        "seed": seed,
                    }),
                })
            }
            Err(Error::Cancelled) => return Err(Error::Cancelled),
            Err(error) => {
                tracing::warn!(%error, engine, device_prefix, "Cover art attempt failed");
                last_error = error;
            }
        }
    }
    Err(last_error)
}

fn validate_png(bytes: &[u8]) -> Result<()> {
    let read = || -> std::result::Result<_, png::DecodingError> {
        png::Decoder::new(Cursor::new(bytes)).read_info()
    };
    let invalid = || message("Cover engine returned an invalid 512 × 512 PNG");
    let mut reader = read().map_err(|_| invalid())?;
    if reader.info().size() != (SIDE, SIDE) || reader.info().animation_control.is_some() {
        return Err(invalid());
    }
    let mut pixels = vec![0; reader.output_buffer_size().ok_or_else(invalid)?];
    reader.next_frame(&mut pixels).map_err(|_| invalid())?;
    reader.finish().map_err(|_| invalid())?;
    Ok(())
}
