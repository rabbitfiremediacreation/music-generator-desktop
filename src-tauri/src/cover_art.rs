use crate::{
    db::safe_song_path,
    download::DownloadProgress,
    engine::progress::Progress,
    error::{message, Error, Result},
    manifest::Model,
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
mod inference;
#[cfg(test)]
mod tests;

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

pub(crate) fn output_path(root: &Path, id: &str, generated: bool) -> Option<PathBuf> {
    if !generated
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
    {
        return None;
    }
    let path = safe_song_path(root, &format!("{id}.{EXTENSION}")).ok()?;
    path.is_file().then_some(path)
}

pub(super) struct Artwork {
    pub(super) png: Vec<u8>,
    pub(super) provenance: Value,
}

/// Render original artwork from the song's title and musical description.
pub(super) async fn generate(
    data: &Path,
    title: &str,
    caption: &str,
    seed: i64,
    cancel: &CancellationToken,
    report: impl Fn(Progress),
    transfer: impl Fn(DownloadProgress),
) -> Result<Artwork> {
    if !supported() {
        return Err(message("Cover art is unavailable on this operating system"));
    }
    let root = data.join("cover-art");
    let work = assets::Work::new(&root, cancel, transfer).await?;
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
    let mut model = None;
    let mut last_error = message("No compatible cover art engine");
    for (engine, device_prefix) in assets::engines() {
        let ready = async {
            report(Progress::new("cover_art_download"));
            let executable = work.engine(engine).await?;
            let backend = inference::device(&executable, &root, device_prefix, cancel).await?;
            Ok((executable, backend))
        }
        .await;
        let (executable, backend) = match ready {
            Ok(ready) => ready,
            Err(Error::Cancelled) => return Err(Error::Cancelled),
            Err(error) => {
                tracing::warn!(%error, engine, device_prefix, "Cover art engine unavailable");
                last_error = error;
                continue;
            }
        };
        let weights = match &model {
            Some(weights) => weights,
            None => model.insert(work.model().await?),
        };
        report(Progress::new("cover_art"));
        let render =
            inference::render(&root, &executable, weights, &backend, &prompt, seed, cancel).await;
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
