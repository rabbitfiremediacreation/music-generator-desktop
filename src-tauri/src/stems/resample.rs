use super::{
    model::RATE,
    wave::{header, sample_value, StereoWave, WaveFormat},
};
use crate::error::{message, Error, Result};
use std::{
    fs::File,
    io::{BufWriter, Write},
    path::Path,
};
use tokio_util::sync::CancellationToken;

const RADIUS: i64 = 24;
const BLOCK: u64 = 4096;

pub fn aligned_frames(frames: u64, rate: u32) -> u64 {
    (frames * u64::from(rate) + u64::from(RATE) / 2) / u64::from(RATE)
}

pub fn convert(
    from: &Path,
    to: &Path,
    frames: u64,
    rate: u32,
    channels: u16,
    format: WaveFormat,
    cancel: &CancellationToken,
) -> Result<f32> {
    let mut reader = StereoWave::open(from, frames)?;
    let mut writer = BufWriter::new(File::create(to)?);
    let output_frames = aligned_frames(frames, rate);
    header(&mut writer, format, output_frames, rate, channels)?;
    let filter = if rate == RATE {
        None
    } else {
        Some(Kernel::new(rate))
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

/// Window the low-pass sinc and cache each rational resampling phase.
struct Kernel {
    phases: Vec<[f32; (RADIUS * 2) as usize]>,
    divisor: u32,
}

impl Kernel {
    fn new(rate: u32) -> Self {
        let mut divisor = RATE;
        let mut modulo = rate;
        while modulo != 0 {
            (divisor, modulo) = (modulo, divisor % modulo);
        }
        let phase_count = rate / divisor;
        let cutoff = (f64::from(rate) / f64::from(RATE)).min(1.0) * 0.95;
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
    fn rate_conversion_uses_one_shared_frame_count_and_preserves_dc() {
        assert_eq!(aligned_frames(44_100, 48_000), 48_000);
        assert_eq!(aligned_frames(1_100, 48_000), 1_197);
        let kernel = Kernel::new(48_000);
        for phase in 0..160 {
            let frame = kernel.frame(&[[0.5, 0.125]; 64], 32, phase * kernel.divisor);
            assert!((frame[0] - 0.5).abs() < 1e-6);
            assert!((frame[1] - 0.125).abs() < 1e-6);
        }
    }
}
