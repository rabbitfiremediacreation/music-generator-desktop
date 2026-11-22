mod effects;
mod fft;
mod preview_files;
mod repair;
mod suggest;
mod whole;

use super::{
    jobs,
    layer::{self, Layer, LayerStaging},
    model::RATE,
    wave::{sample_value, StereoWave},
};
use crate::{
    error::{message, Result},
    state::AppState,
};
use fft::{Transform, SIZE};
pub(crate) use preview_files::write_audition;
use serde::{Deserialize, Serialize};
use std::ops::Range;
use tokio_util::sync::CancellationToken;

const MAX_FRAMES: u64 = 20 * RATE as u64;
const AUDITION_CONTEXT: u64 = RATE as u64 / 4;
const BIN_HZ: f64 = RATE as f64 / SIZE as f64;
const MIN_HZ: f64 = 20.0;
const MAX_HZ: f64 = RATE as f64 / 2.0;

#[derive(Clone, Copy, Serialize)]
pub struct Selection {
    first: u64,
    end: u64,
    low_hz: f64,
    high_hz: f64,
    reduction_db: f64,
}

#[derive(Deserialize)]
pub struct RepairRequest {
    #[serde(default)]
    first: u64,
    #[serde(default)]
    end: u64,
    #[serde(default)]
    whole_track: bool,
    #[serde(flatten)]
    processing: Processing,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Processing {
    Effect {
        effect: effects::Effect,
    },
    Attenuate {
        low_hz: f64,
        high_hz: f64,
        reduction_db: f64,
    },
}

#[derive(Serialize)]
pub struct Spectrogram {
    width: usize,
    height: usize,
    levels: Vec<u8>,
    min_hz: f64,
    max_hz: f64,
    bin_hz: f64,
}

pub fn preview(
    state: &AppState,
    id: &str,
    role: &str,
    first: u64,
    end: u64,
) -> Result<Spectrogram> {
    let job = jobs::get(state, id)?;
    let frames = job.complete()?.frames;
    validate_time(first, end, frames)?;
    let mut wave = StereoWave::open_project(&layer::audio_path(state, &job, role)?, frames)?;
    let (audio, range) = read_window(&mut wave, first, end, frames)?;
    Ok(spectrogram(&audio, range))
}

pub fn scan(
    state: &AppState,
    id: &str,
    role: &str,
    cancel: &CancellationToken,
) -> Result<Vec<Selection>> {
    let job = jobs::get(state, id)?;
    let frames = job.complete()?.frames;
    let mut wave = StereoWave::open_project(&layer::audio_path(state, &job, role)?, frames)?;
    suggest::scan(&mut wave, frames, cancel)
}

pub fn audition(
    state: &AppState,
    id: &str,
    role: &str,
    selection: &RepairRequest,
    cancel: &CancellationToken,
) -> Result<Vec<u8>> {
    let job = jobs::get(state, id)?;
    let frames = job.complete()?.frames;
    validate_selection(selection, frames)?;
    let mut wave = StereoWave::open_project(&layer::audio_path(state, &job, role)?, frames)?;
    repair::audition(&mut wave, frames, selection, cancel)
}

pub fn apply(
    state: &AppState,
    id: &str,
    role: &str,
    selection: &RepairRequest,
    cancel: &CancellationToken,
) -> Result<Layer> {
    let job = jobs::get(state, id)?;
    let frames = job.complete()?.frames;
    if job.request.preview {
        return Err(message("stem_spectral_range"));
    }
    if selection.whole_track {
        validate_processing(selection)?;
    } else {
        validate_selection(selection, frames)?;
    }
    let mut wave = StereoWave::open_project(&layer::audio_path(state, &job, role)?, frames)?;
    let staging = LayerStaging::new(state, frames)?;
    repair::render(&mut wave, &staging.audio(), frames, selection, cancel)?;
    staging.publish(state, id, &job.source.id, job.source.name, frames, cancel)
}

fn validate_selection(selection: &RepairRequest, frames: u64) -> Result<()> {
    validate_time(selection.first, selection.end, frames)?;
    validate_processing(selection)
}

fn validate_processing(selection: &RepairRequest) -> Result<()> {
    let valid = match &selection.processing {
        Processing::Effect { effect } => effect.valid(),
        Processing::Attenuate {
            low_hz,
            high_hz,
            reduction_db,
        } => {
            (MIN_HZ..=MAX_HZ).contains(low_hz)
                && (MIN_HZ..=MAX_HZ).contains(high_hz)
                && high_hz - low_hz >= BIN_HZ
                && (1.0..=36.0).contains(reduction_db)
        }
    };
    if !valid {
        return Err(message("stem_spectral_range"));
    }
    Ok(())
}

fn validate_time(first: u64, end: u64, frames: u64) -> Result<()> {
    if first >= end || end > frames || end - first > MAX_FRAMES {
        return Err(message("stem_spectral_range"));
    }
    Ok(())
}

/// Include neighboring samples so the FFT can overlap both selection edges.
fn read_window(
    wave: &mut StereoWave,
    first: u64,
    end: u64,
    frames: u64,
) -> Result<(Vec<[f32; 2]>, Range<usize>)> {
    let offset = first.saturating_sub(SIZE as u64);
    let limit = end.saturating_add(SIZE as u64).min(frames);
    let mut bytes = vec![0; (limit - offset) as usize * 8];
    wave.seek(offset)?;
    wave.read(&mut bytes)?;
    let audio = bytes
        .as_chunks::<8>()
        .0
        .iter()
        .map(|frame| Ok([sample_value(&frame[..4])?, sample_value(&frame[4..])?]))
        .collect::<Result<_>>()?;
    Ok((audio, (first - offset) as usize..(end - offset) as usize))
}

const FULL_SCALE_POWER: f64 = (SIZE as f64 / 4.0) * (SIZE as f64 / 4.0);

fn spectrogram(audio: &[[f32; 2]], range: Range<usize>) -> Spectrogram {
    let (width, height) = (384.min(range.len()), 128);
    let mut levels = vec![0; width * height];
    let transform = Transform::new();
    let mut spectrum = [[0.0; 2]; SIZE];
    let mut power = [0.0; SIZE / 2 + 1];
    let edges: Vec<_> = (0..=height)
        .map(|row| {
            let hz = MAX_HZ * (MIN_HZ / MAX_HZ).powf(row as f64 / height as f64);
            (hz / BIN_HZ).round() as usize
        })
        .collect();

    for column in 0..width {
        let center = range.start + (2 * column + 1) * range.len() / (2 * width);
        transform.stereo_power(audio, center, &mut spectrum, &mut power);
        for (row, band) in edges.windows(2).enumerate() {
            let peak = power[band[1]..=band[0]].iter().copied().fold(0.0, f64::max);
            let db = 10.0 * (peak / FULL_SCALE_POWER).log10();
            levels[row * width + column] = ((db + 80.0).clamp(0.0, 80.0) * (255.0 / 80.0)) as u8;
        }
    }
    Spectrogram {
        width,
        height,
        levels,
        min_hz: MIN_HZ,
        max_hz: MAX_HZ,
        bin_hz: BIN_HZ,
    }
}
