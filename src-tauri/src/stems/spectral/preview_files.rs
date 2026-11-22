use super::{audition, RepairRequest, AUDITION_CONTEXT, RATE};
use crate::{
    error::{Error, Result},
    state::AppState,
    stems::wave::{header, WaveFormat},
};
use serde::Serialize;
use std::{
    fs::File,
    io::{BufWriter, Write},
    path::PathBuf,
};
use tempfile::TempDir;
use tokio_util::sync::CancellationToken;

#[derive(Serialize)]
pub(crate) struct AuditionFiles {
    before: PathBuf,
    after: PathBuf,
    first_frame: u64,
    frames: u64,
    rate: u32,
}

/// Save the same excerpt used by desktop audition as two aligned stereo WAV files.
pub(crate) fn write_audition(
    state: &AppState,
    id: &str,
    role: &str,
    selection: &RepairRequest,
    directory: TempDir,
    cancel: &CancellationToken,
) -> Result<AuditionFiles> {
    let audio = audition(state, id, role, selection, cancel)?;
    let frames = (audio.len() / 16) as u64;
    let before = directory.path().join("before.wav");
    let after = directory.path().join("after.wav");
    let mut dry = BufWriter::new(File::create(&before)?);
    let mut wet = BufWriter::new(File::create(&after)?);
    header(&mut dry, WaveFormat::Float32, frames, RATE, 2)?;
    header(&mut wet, WaveFormat::Float32, frames, RATE, 2)?;
    for block in audio.chunks(4096 * 16) {
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        for frame in block.as_chunks::<16>().0 {
            dry.write_all(&frame[..8])?;
            wet.write_all(&frame[8..])?;
        }
    }
    dry.into_inner().map_err(|error| error.into_error())?;
    wet.into_inner().map_err(|error| error.into_error())?;
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    let _ = directory.keep();
    Ok(AuditionFiles {
        before,
        after,
        first_frame: selection.first.saturating_sub(AUDITION_CONTEXT),
        frames,
        rate: RATE,
    })
}
