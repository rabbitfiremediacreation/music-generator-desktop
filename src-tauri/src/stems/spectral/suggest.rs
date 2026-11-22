use super::{
    fft::{Power, Transform, SIZE},
    read_window, Selection, BIN_HZ, FULL_SCALE_POWER, RATE,
};
use crate::{
    error::{Error, Result},
    stems::wave::StereoWave,
};
use tokio_util::sync::CancellationToken;

const MIN_HZ: f64 = 2500.0;
const MAX_HZ: f64 = 15_000.0;
const MIN_DURATION: f64 = 0.060;
const MAX_DURATION: f64 = 0.450;
const HOP: usize = SIZE / 2;
const BLOCK: usize = HOP * 128;
const MARGIN: u64 = RATE as u64 / 50;

/// Stream the track in overlapping read windows while keeping one fixed detection grid.
pub(super) fn scan(
    wave: &mut StereoWave,
    frames: u64,
    cancel: &CancellationToken,
) -> Result<Vec<Selection>> {
    let transform = Transform::new();
    let mut spectrum = [[0.0; 2]; SIZE];
    let mut power = [0.0; SIZE / 2 + 1];
    let first_bin = (MIN_HZ / BIN_HZ).ceil() as usize;
    let last_bin = (MAX_HZ / BIN_HZ) as usize;
    let mut ongoing = vec![None; last_bin + 1];
    let mut hits = Vec::new();
    for first in (0..frames).step_by(BLOCK) {
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        let end = (first + BLOCK as u64).min(frames);
        let (audio, range) = read_window(wave, first, end, frames)?;
        for frame in (first..end).step_by(HOP) {
            let center = (frame + HOP as u64 / 2).min(frames - 1);
            transform.stereo_power(
                &audio,
                range.start + (center - first) as usize,
                &mut spectrum,
                &mut power,
            );
            for (bin, start) in ongoing.iter_mut().enumerate().skip(first_bin) {
                if isolated_peak(&power, bin) {
                    start.get_or_insert(frame);
                } else if let Some(hit) = start
                    .take()
                    .and_then(|start| finish(bin, start, frame, frames))
                {
                    hits.push(hit);
                }
            }
        }
    }
    hits.extend(
        ongoing
            .into_iter()
            .enumerate()
            .skip(first_bin)
            .filter_map(|(bin, start)| start.and_then(|start| finish(bin, start, frames, frames))),
    );
    hits.sort_by(|a, b| a.first.cmp(&b.first).then(a.low_hz.total_cmp(&b.low_hz)));
    Ok(hits)
}

fn finish(bin: usize, first: u64, end: u64, frames: u64) -> Option<Selection> {
    let seconds = (end - first) as f64 / f64::from(RATE);
    if !(MIN_DURATION..=MAX_DURATION).contains(&seconds) || end - first == frames {
        return None;
    }
    Some(Selection {
        first: first.saturating_sub(MARGIN),
        end: (end + MARGIN).min(frames),
        low_hz: ((bin as f64 - 2.5) * BIN_HZ).floor(),
        high_hz: ((bin as f64 + 2.5) * BIN_HZ).ceil(),
        reduction_db: 9.0,
    })
}

fn isolated_peak(power: &Power, bin: usize) -> bool {
    let peak = power[bin];
    let floor = FULL_SCALE_POWER * 0.000_003_162_277_66;
    if peak < floor || peak < power[bin - 1] || peak <= power[bin + 1] {
        return false;
    }
    let sides = maximum(&power[bin - 8..=bin - 4]).max(maximum(&power[bin + 4..=bin + 8]));
    if peak < 16.0 * sides {
        return false;
    }
    !(2..=4).any(|harmonic| {
        let fundamental = (bin + harmonic / 2) / harmonic;
        maximum(&power[fundamental - 2..=fundamental + 2]) >= peak * 0.25
    })
}

fn maximum(values: &[f64]) -> f64 {
    values.iter().copied().fold(0.0, f64::max)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stems::wave::{header, WaveFormat};
    use std::{
        f64::consts::TAU,
        io::{BufWriter, Write},
    };

    fn scan_audio(frames: u64, sample_at: impl Fn(u64) -> f32) -> Vec<Selection> {
        let file = tempfile::NamedTempFile::new().unwrap();
        let mut output = BufWriter::new(file.as_file());
        header(&mut output, WaveFormat::Float32, frames, RATE, 2).unwrap();
        for frame in 0..frames {
            let sample = sample_at(frame);
            output.write_all(&sample.to_le_bytes()).unwrap();
            output.write_all(&(-sample).to_le_bytes()).unwrap();
        }
        output.flush().unwrap();
        let mut wave = StereoWave::open(file.path(), frames).unwrap();
        scan(&mut wave, frames, &CancellationToken::new()).unwrap()
    }

    fn tone(bin: u64, frame: u64) -> f32 {
        (TAU * (bin * frame) as f64 / SIZE as f64).sin() as f32
    }

    #[test]
    fn finds_a_short_isolated_whistle_and_leaves_sustained_or_harmonic_tones_unmarked() {
        let frames = u64::from(RATE);
        let bin = 238;
        let fixture = |frame| {
            let spur = if (frames / 4..frames * 3 / 8).contains(&frame) {
                tone(bin, frame) * 0.08
            } else {
                0.0
            };
            tone(352, frame) * 0.16 + spur
        };
        let results = scan_audio(frames, fixture);
        assert_eq!(results.len(), 1);
        let result = results[0];
        assert!(result.first < frames / 4);
        assert!(result.end > frames * 3 / 8);
        let hz = bin as f64 * BIN_HZ;
        assert!(result.low_hz < hz && hz < result.high_hz);

        let harmonic = scan_audio(frames, |frame| fixture(frame) + tone(bin / 2, frame) * 0.14);
        assert!(harmonic.is_empty());
    }

    #[test]
    fn scans_beyond_the_view_and_marks_a_whistle_crossing_a_read_boundary_once() {
        let frames = 21 * u64::from(RATE);
        let boundary = BLOCK as u64;
        let events = [
            (1024..7000, 238),
            (boundary - 3000..boundary + 3000, 315),
            (frames - 5500..frames, 460),
        ];
        let hits = scan_audio(frames, |frame| {
            events
                .iter()
                .find(|(range, _)| range.contains(&frame))
                .map_or(0.0, |(_, bin)| tone(*bin, frame) * 0.13)
        });
        assert_eq!(hits.len(), events.len());
        for (hit, (range, bin)) in hits.iter().zip(events) {
            let hz = bin as f64 * BIN_HZ;
            assert!(hit.first <= range.start && hit.end >= range.end);
            assert!(hit.low_hz < hz && hz < hit.high_hz);
        }
    }
}
