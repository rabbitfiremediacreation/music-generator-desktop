use super::{
    model::RATE,
    wave::{header, sample_value, StereoWave, WaveFormat},
};
use crate::error::{message, Error, Result};
use std::{
    fs::File,
    io::{BufWriter, Cursor, Write},
    path::Path,
};
use tokio_util::sync::CancellationToken;

const RADIUS: i64 = 24;
const BLOCK: u64 = 4096;

pub fn aligned_frames(frames: u64, rate: u32) -> u64 {
    (frames * u64::from(rate) + u64::from(RATE) / 2) / u64::from(RATE)
}

pub(super) struct WaveOutput {
    pub rate: u32,
    pub channels: u16,
    pub format: WaveFormat,
    pub clip_ceiling: Option<f32>,
}

pub(super) fn convert(
    from: &Path,
    to: &Path,
    frames: u64,
    output: WaveOutput,
    cancel: &CancellationToken,
) -> Result<f32> {
    let WaveOutput {
        rate,
        channels,
        format,
        clip_ceiling,
    } = output;
    let mut reader = StereoWave::open(from, frames)?;
    let mut writer = BufWriter::new(File::create(to)?);
    let output_frames = aligned_frames(frames, rate);
    header(&mut writer, format, output_frames, rate, channels)?;
    let filter = if rate == RATE {
        None
    } else {
        Some(Kernel::new(RATE, rate))
    };
    let mut peak = 0.0_f32;
    let mut data = Vec::new();
    let mut samples = Vec::new();
    for position in (0..output_frames).step_by(BLOCK as usize) {
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        let amount = (output_frames - position).min(BLOCK);
        let first = (position * u64::from(RATE) / u64::from(rate)).saturating_sub(RADIUS as u64);
        let end = ((position + amount) * u64::from(RATE) / u64::from(rate) + RADIUS as u64 + 1)
            .min(frames);
        data.resize((end - first) as usize * 8, 0);
        samples.clear();
        reader.seek(first)?;
        reader.read(&mut data)?;
        for frame in data.as_chunks::<8>().0 {
            samples.push([sample_value(&frame[..4])?, sample_value(&frame[4..])?]);
        }
        for position in position..position + amount {
            let time = position * u64::from(RATE);
            let source = time / u64::from(rate);
            let fraction = (time % u64::from(rate)) as u32;
            let pair = if let Some(kernel) = &filter {
                kernel.frame(&samples, source - first, fraction)
            } else {
                samples[(source - first) as usize]
            };
            let mono = [(pair[0] + pair[1]) * 0.5];
            let values: &[f32] = if channels == 1 { &mono } else { &pair };
            for &value in values {
                if !value.is_finite() {
                    return Err(message("stem_output_invalid"));
                }
                let value = if let Some(ceiling) = clip_ceiling {
                    value.clamp(-ceiling, ceiling)
                } else {
                    value
                };
                peak = peak.max(value.abs());
                format.write_sample(&mut writer, value)?;
            }
        }
    }
    let bytes_per_frame = u64::from(channels) * u64::from(format.encoding().1 / 8);
    if !(output_frames * bytes_per_frame).is_multiple_of(2) {
        writer.write_all(&[0])?;
    }
    writer.flush()?;
    writer.get_ref().sync_all()?;
    Ok(peak)
}

/// Align ACE-Step's stereo PCM output to the project timeline and pad any tail with silence.
pub(super) fn align_generated(
    audio: &[u8],
    to: &Path,
    project_frames: u64,
    cancel: &CancellationToken,
) -> Result<()> {
    let (facts, start) = crate::audio_facts::pcm16_data(&mut Cursor::new(audio))?;
    const ENGINE_RATE: u32 = 48_000;
    if facts.sample_rate_hz != ENGINE_RATE || facts.channels != 2 {
        return Err(message("stem_output_alignment"));
    }
    let aligned =
        (facts.frames * u64::from(RATE) + u64::from(ENGINE_RATE) / 2) / u64::from(ENGINE_RATE);
    // A few latent frames may be added or dropped when the engine quantizes the duration.
    if aligned.abs_diff(project_frames) > u64::from(RATE) / 2 {
        return Err(message("stem_layer_generated_length"));
    }
    let pcm = &audio[start as usize..][..facts.frames as usize * 4];
    let mut writer = BufWriter::new(File::create(to)?);
    let format = WaveFormat::Float32;
    header(&mut writer, format, project_frames, RATE, 2)?;
    let filter = Kernel::new(ENGINE_RATE, RATE);
    let mut samples = Vec::new();
    let generated_frames = aligned.min(project_frames);
    for position in (0..generated_frames).step_by(BLOCK as usize) {
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        let end = (position + BLOCK).min(generated_frames);
        let first =
            (position * u64::from(ENGINE_RATE) / u64::from(RATE)).saturating_sub(RADIUS as u64);
        let last =
            (end * u64::from(ENGINE_RATE) / u64::from(RATE) + RADIUS as u64 + 1).min(facts.frames);
        samples.clear();
        samples.extend(
            pcm[first as usize * 4..last as usize * 4]
                .chunks_exact(4)
                .map(|frame| {
                    let left = i16::from_le_bytes([frame[0], frame[1]]);
                    let right = i16::from_le_bytes([frame[2], frame[3]]);
                    [f32::from(left) / 32768.0, f32::from(right) / 32768.0]
                }),
        );
        for frame in position..end {
            let time = frame * u64::from(ENGINE_RATE);
            let center = time / u64::from(RATE) - first;
            let fraction = (time % u64::from(RATE)) as u32;
            for value in filter.frame(&samples, center, fraction) {
                format.write_sample(&mut writer, value)?;
            }
        }
    }
    let zeros = [0; BLOCK as usize * 8];
    for position in (generated_frames..project_frames).step_by(BLOCK as usize) {
        let count = (project_frames - position).min(BLOCK) as usize;
        writer.write_all(&zeros[..count * 8])?;
    }
    writer.flush()?;
    writer.get_ref().sync_all()?;
    Ok(())
}

/// Window the low-pass sinc and cache each rational resampling phase.
struct Kernel {
    phases: Vec<[f32; (RADIUS * 2) as usize]>,
    divisor: u32,
}

impl Kernel {
    fn new(source_rate: u32, rate: u32) -> Self {
        let mut divisor = source_rate;
        let mut modulo = rate;
        while modulo != 0 {
            (divisor, modulo) = (modulo, divisor % modulo);
        }
        let phase_count = rate / divisor;
        let cutoff = (f64::from(rate) / f64::from(source_rate)).min(1.0) * 0.95;
        let phases = (0..phase_count)
            .map(|phase| {
                let fraction = f64::from(phase) / f64::from(phase_count);
                let mut taps = std::array::from_fn(|index| {
                    let delta = (index as i64 - RADIUS + 1) as f64 - fraction;
                    let angle = std::f64::consts::PI * delta;
                    let window = 0.5 + 0.5 * (angle / RADIUS as f64).cos();
                    let sinc = if delta.abs() < f64::EPSILON {
                        cutoff
                    } else {
                        (angle * cutoff).sin() / angle
                    };
                    (sinc * window) as f32
                });
                let total: f32 = taps.iter().sum();
                taps.iter_mut().for_each(|tap| *tap /= total);
                taps
            })
            .collect();
        Self { phases, divisor }
    }

    fn frame(&self, samples: &[[f32; 2]], center: u64, fraction: u32) -> [f32; 2] {
        let taps = &self.phases[(fraction / self.divisor) as usize];
        let mut summed = [0.0; 2];
        for (index, gain) in taps.iter().enumerate() {
            let input = (center as i64 + index as i64 - RADIUS + 1)
                .clamp(0, samples.len() as i64 - 1) as usize;
            summed[0] += samples[input][0] * gain;
            summed[1] += samples[input][1] * gain;
        }
        summed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_pcm_aligns_stereo_and_preserves_project_length() {
        let mut input = Vec::new();
        let frames = 480;
        header(&mut input, WaveFormat::Pcm16, frames, 48_000, 2).unwrap();
        for _ in 0..frames {
            input.extend(8192i16.to_le_bytes());
            input.extend((-16384i16).to_le_bytes());
        }
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("layer.wav");
        let cancel = CancellationToken::new();
        let project_frames = 445;
        align_generated(&input, &path, project_frames, &cancel).unwrap();
        let mut wave = StereoWave::open(&path, project_frames).unwrap();
        let mut data = [0; 16];
        wave.seek(440).unwrap();
        wave.read(&mut data).unwrap();
        assert!((sample_value(&data[..4]).unwrap() - 0.25).abs() < 1e-6);
        assert!((sample_value(&data[4..8]).unwrap() + 0.5).abs() < 1e-6);
        assert_eq!(data[8..], [0; 8]);
        assert_eq!(
            align_generated(&input, &path, u64::from(RATE), &cancel)
                .unwrap_err()
                .to_string(),
            "stem_layer_generated_length"
        );
    }

    #[test]
    fn rate_conversion_uses_one_shared_frame_count_and_preserves_dc() {
        assert_eq!(aligned_frames(44_100, 48_000), 48_000);
        assert_eq!(aligned_frames(1_100, 48_000), 1_197);
        let kernel = Kernel::new(RATE, 48_000);
        for phase in 0..160 {
            let frame = kernel.frame(&[[0.5, 0.125]; 64], 32, phase * kernel.divisor);
            assert!((frame[0] - 0.5).abs() < 1e-6);
            assert!((frame[1] - 0.125).abs() < 1e-6);
        }
    }

    #[test]
    fn rate_conversion_clamps_overshoots_at_the_output_ceiling() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source.wav");
        let output = root.path().join("converted.wav");
        let mut file = File::create(&source).unwrap();
        let frames = 128;
        header(&mut file, WaveFormat::Float32, frames, RATE, 2).unwrap();
        for frame in 0..frames {
            let value = if frame < frames / 2 { 0.5_f32 } else { 0.0_f32 };
            file.write_all(&value.to_le_bytes()).unwrap();
            file.write_all(&(-value).to_le_bytes()).unwrap();
        }
        drop(file);
        let cancel = CancellationToken::new();
        let convert_peak = |clip_ceiling| {
            convert(
                &source,
                &output,
                frames,
                WaveOutput {
                    rate: 48_000,
                    channels: 2,
                    format: WaveFormat::Float32,
                    clip_ceiling,
                },
                &cancel,
            )
            .unwrap()
        };
        assert!(convert_peak(None) > 0.5);
        assert_eq!(convert_peak(Some(0.5)), 0.5);
    }
}
