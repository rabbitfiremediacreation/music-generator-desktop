use super::{
    fft::{Transform, SIZE},
    read_window, whole, Processing, RepairRequest, AUDITION_CONTEXT, BIN_HZ, RATE,
};
use crate::{
    error::{Error, Result},
    stems::wave::{header, StereoWave, WaveFormat},
};
use std::{
    fs::File,
    io::{BufWriter, Write},
    ops::Range,
    path::Path,
};
use tokio_util::sync::CancellationToken;

const HOP: usize = SIZE / 4;

/// Return paired little-endian float32 frames in before L/R, after L/R order.
pub(super) fn audition(
    wave: &mut StereoWave,
    frames: u64,
    selection: &RepairRequest,
    cancel: &CancellationToken,
) -> Result<Vec<u8>> {
    let first = selection.first.saturating_sub(AUDITION_CONTEXT);
    let end = (selection.end + AUDITION_CONTEXT).min(frames);
    if selection.whole_track {
        return audition_whole(wave, frames, first..end, &selection.processing, cancel);
    }
    let (mut audio, excerpt) = read_window(wave, first, end, frames)?;
    let original = audio[excerpt.clone()].to_vec();
    let start = excerpt.start + (selection.first - first) as usize;
    let finish = excerpt.start + (selection.end - first) as usize;
    process(&mut audio, start..finish, &selection.processing, cancel)?;
    let mut bytes = Vec::with_capacity(original.len() * 16);
    for (before, after) in original.into_iter().zip(&audio[excerpt]) {
        for sample in before.iter().chain(after) {
            bytes.extend(sample.to_le_bytes());
        }
    }
    Ok(bytes)
}

fn audition_whole(
    wave: &mut StereoWave,
    frames: u64,
    excerpt: Range<u64>,
    processing: &Processing,
    cancel: &CancellationToken,
) -> Result<Vec<u8>> {
    let mut dry = vec![0; (excerpt.end - excerpt.start) as usize * 8];
    wave.seek(excerpt.start)?;
    wave.read(&mut dry)?;
    let mut original = dry.as_chunks::<8>().0.iter();
    let mut paired = Vec::with_capacity(dry.len() * 2);
    whole::process(wave, frames, excerpt, processing, cancel, |audio| {
        for frame in audio {
            paired.extend_from_slice(
                original
                    .next()
                    .expect("one dry frame for each processed frame"),
            );
            for sample in frame {
                paired.extend(sample.to_le_bytes());
            }
        }
        Ok(())
    })?;
    Ok(paired)
}

pub(super) fn render(
    wave: &mut StereoWave,
    path: &Path,
    frames: u64,
    selection: &RepairRequest,
    cancel: &CancellationToken,
) -> Result<()> {
    let mut target = BufWriter::new(File::create(path)?);
    header(&mut target, WaveFormat::Float32, frames, RATE, 2)?;
    if selection.whole_track {
        whole::process(
            wave,
            frames,
            0..frames,
            &selection.processing,
            cancel,
            |audio| write_audio(&mut target, audio),
        )?;
    } else {
        let (mut audio, range) = read_window(wave, selection.first, selection.end, frames)?;
        process(&mut audio, range.clone(), &selection.processing, cancel)?;
        copy(wave, &mut target, 0..selection.first, cancel)?;
        write_audio(&mut target, &audio[range])?;
        copy(wave, &mut target, selection.end..frames, cancel)?;
    }
    target.flush()?;
    Ok(())
}

fn write_audio(target: &mut impl Write, audio: &[[f32; 2]]) -> Result<()> {
    for pair in audio {
        for sample in pair {
            target.write_all(&sample.to_le_bytes())?;
        }
    }
    Ok(())
}

fn copy(
    wave: &mut StereoWave,
    output: &mut impl Write,
    range: Range<u64>,
    cancel: &CancellationToken,
) -> Result<()> {
    wave.seek(range.start)?;
    let mut bytes = [0; 4096 * 8];
    for first in range.clone().step_by(4096) {
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        let block = &mut bytes[..(range.end - first).min(4096) as usize * 8];
        wave.read(block)?;
        output.write_all(block)?;
    }
    Ok(())
}

pub(super) fn process(
    audio: &mut [[f32; 2]],
    range: Range<usize>,
    processing: &Processing,
    cancel: &CancellationToken,
) -> Result<()> {
    match processing {
        Processing::Effect { effect } => effect.process(audio, range, cancel),
        Processing::Attenuate {
            low_hz,
            high_hz,
            reduction_db,
        } => attenuate(audio, range, *low_hz, *high_hz, *reduction_db, cancel),
    }
}

/// Reconstruct only the removed frequencies, then apply the difference inside the selection.
fn attenuate(
    audio: &mut [[f32; 2]],
    range: Range<usize>,
    low_hz: f64,
    high_hz: f64,
    reduction_db: f64,
    cancel: &CancellationToken,
) -> Result<()> {
    let transform = Transform::new();
    let mut spectrum = [[0.0; 2]; SIZE];
    let mut difference: [Vec<f64>; 2] = std::array::from_fn(|_| vec![0.0; range.len()]);
    let reduction = 10.0_f64.powf(-reduction_db / 20.0) - 1.0;
    let weights: [f64; SIZE] = std::array::from_fn(|bin| {
        let hz = bin.min(SIZE - bin) as f64 * BIN_HZ;
        let distance = (low_hz - hz).max(hz - high_hz);
        reduction * (1.0 - distance / BIN_HZ).clamp(0.0, 1.0)
    });
    let first = range.start as isize - (SIZE - HOP) as isize;
    for start in (first..range.end as isize).step_by(HOP) {
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        for (channel, delta) in difference.iter_mut().enumerate() {
            transform.analyse(audio, start, channel, &mut spectrum);
            for ([real, imag], gain) in spectrum.iter_mut().zip(weights.iter()) {
                *real *= gain;
                *imag *= gain;
            }
            transform.inverse(&mut spectrum);
            let from = start.max(range.start as isize);
            let to = (start + SIZE as isize).min(range.end as isize);
            for frame in from..to {
                let bin = (frame - start) as usize;
                // Four periodic Hann windows squared sum to 1.5 at this hop size.
                delta[frame as usize - range.start] +=
                    spectrum[bin][0] * transform.window[bin] * (2.0 / 3.0);
            }
        }
    }
    let length = range.len();
    let fade = (length / 4).clamp(1, HOP);
    let [left, right] = difference;
    for (index, (pair, (left, right))) in audio[range]
        .iter_mut()
        .zip(left.into_iter().zip(right))
        .enumerate()
    {
        let weight = index.min(length - 1 - index).min(fade) as f64 / fade as f64;
        for (sample, delta) in pair.iter_mut().zip([left, right]) {
            *sample = (f64::from(*sample) + delta * weight) as f32;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::f64::consts::TAU;

    fn tone(bin: usize, frame: usize) -> f64 {
        (TAU * (bin * frame) as f64 / SIZE as f64).sin()
    }

    #[test]
    fn full_track_tools_process_past_twenty_seconds_and_match_audition_across_blocks() {
        let directory = tempfile::tempdir().unwrap();
        let dry_path = directory.path().join("dry.wav");
        let wet_path = directory.path().join("wet.wav");
        let frames = u64::from(RATE) * 21;
        let context = u64::from(RATE) / 4;
        let first = whole::BLOCK + 100 + context;
        let end = first + u64::from(RATE);
        let last_click = frames - 3000;
        let mut dry = Vec::new();
        header(&mut dry, WaveFormat::Float32, frames, RATE, 2).unwrap();
        let header_length = dry.len();
        let oscillation = |hz: f64, frame: u64| (TAU * hz * frame as f64 / f64::from(RATE)).sin();
        for frame in 0..frames {
            let impulse = if frame == last_click || frame == first + 3000 {
                0.9
            } else {
                0.0
            };
            let sample = (0.2 * oscillation(700.0, frame)
                + 0.12 * oscillation(6500.0, frame)
                + impulse) as f32;
            dry.extend(sample.to_le_bytes());
            dry.extend((-sample).to_le_bytes());
        }
        std::fs::write(&dry_path, &dry).unwrap();
        let settings = [
            json!({ "low_hz": 6200, "high_hz": 6800, "reduction_db": 9 }),
            json!({ "effect": { "kind": "de_click", "sensitivity": 50 } }),
            json!({ "effect": { "kind": "de_crackle", "sensitivity": 50 } }),
            json!({ "effect": { "kind": "dynamic_eq", "bands": [
                { "frequency_hz": 700, "threshold_db": -35, "q": 2, "reduction_db": 9 },
                { "frequency_hz": 6500, "threshold_db": -35, "q": 1.5, "reduction_db": 9 }
            ] } }),
            json!({ "effect": { "kind": "de_esser", "frequency_hz": 6500, "threshold_db": -35, "reduction_db": 8 } }),
        ];
        let cancel = CancellationToken::new();
        for mut options in settings {
            options["first"] = json!(first);
            options["end"] = json!(end);
            options["whole_track"] = json!(true);
            let selection: RepairRequest = serde_json::from_value(options).unwrap();
            super::super::validate_selection(&selection, frames).unwrap();
            let mut wave = StereoWave::open(&dry_path, frames).unwrap();
            let example = audition(&mut wave, frames, &selection, &cancel).unwrap();
            render(&mut wave, &wet_path, frames, &selection, &cancel).unwrap();
            let wet = std::fs::read(&wet_path).unwrap();
            assert_eq!(wet.len(), dry.len());
            let beyond_preview = header_length + last_click as usize * 8;
            assert_ne!(
                wet[beyond_preview..beyond_preview + 8],
                dry[beyond_preview..beyond_preview + 8]
            );
            assert_eq!(example.len(), (end - first + 2 * context) as usize * 16);
            for (offset, pair) in example.as_chunks::<16>().0.iter().enumerate() {
                let start = header_length + ((first - context) as usize + offset) * 8;
                assert_eq!(pair[..8], dry[start..start + 8]);
                assert_eq!(pair[8..], wet[start..start + 8]);
            }
            if matches!(
                &selection.processing,
                Processing::Effect {
                    effect: super::super::effects::Effect::DynamicEq { .. }
                }
            ) {
                let projection = |bytes: &[u8], hz| {
                    (frames - 4400..frames - 3200)
                        .map(|frame| {
                            let offset = header_length + frame as usize * 8;
                            f64::from(f32::from_le_bytes(
                                bytes[offset..offset + 4].try_into().unwrap(),
                            )) * oscillation(hz, frame)
                        })
                        .sum::<f64>()
                };
                for hz in [700.0, 6500.0] {
                    assert!(projection(&wet, hz) / projection(&dry, hz) < 0.55);
                }
            }
        }
    }

    #[test]
    fn all_restoration_tools_render_the_same_samples_as_their_excerpt() {
        let job = tempfile::tempdir().unwrap();
        let dry_path = job.path().join("dry.wav");
        let wet_path = job.path().join("wet.wav");
        let frame_count = 64_000;
        let first = 24_000;
        let end = 44_000;
        let mut dry = Vec::new();
        header(&mut dry, WaveFormat::Float32, frame_count, RATE, 2).unwrap();
        let header_length = dry.len();
        for frame in 0..frame_count {
            let tone = (std::f64::consts::TAU * 6500.0 * frame as f64 / f64::from(RATE)).sin();
            let impulse = if frame == 30_001 { 0.6 } else { 0.0 };
            let sample = if frame < 34_000 { impulse } else { 0.3 * tone };
            dry.extend((sample as f32).to_le_bytes());
            dry.extend((-sample as f32).to_le_bytes());
        }
        std::fs::write(&dry_path, &dry).unwrap();
        let cancel = CancellationToken::new();
        for effect in [
            json!({ "kind": "de_click", "sensitivity": 50 }),
            json!({ "kind": "de_crackle", "sensitivity": 50 }),
            json!({ "kind": "dynamic_eq", "frequency_hz": 6500, "threshold_db": -24, "q": 1.5, "reduction_db": 6 }),
            json!({ "kind": "de_esser", "frequency_hz": 6500, "threshold_db": -26, "reduction_db": 8 }),
        ] {
            let selection: RepairRequest =
                serde_json::from_value(json!({ "first": first, "end": end, "effect": effect }))
                    .unwrap();
            super::super::validate_selection(&selection, frame_count).unwrap();
            let mut wave = StereoWave::open(&dry_path, frame_count).unwrap();
            let excerpt = audition(&mut wave, frame_count, &selection, &cancel).unwrap();
            render(&mut wave, &wet_path, frame_count, &selection, &cancel).unwrap();
            let wet = std::fs::read(&wet_path).unwrap();
            let start_byte = header_length + first * 8;
            let end_byte = header_length + end * 8;
            assert_eq!(&wet[..start_byte], &dry[..start_byte]);
            assert_eq!(&wet[end_byte..], &dry[end_byte..]);
            assert_ne!(&wet[start_byte..end_byte], &dry[start_byte..end_byte]);
            let clip_start = first - RATE as usize / 4;
            for (index, pair) in excerpt.as_chunks::<16>().0.iter().enumerate() {
                let start = header_length + (clip_start + index) * 8;
                assert_eq!(pair[..8], dry[start..start + 8]);
                assert_eq!(pair[8..], wet[start..start + 8]);
            }
        }
    }

    #[test]
    fn attenuates_the_selected_band_in_both_channels_only_inside_the_selection() {
        let mut samples: Vec<_> = (0..4 * SIZE)
            .map(|i| {
                let low = tone(40, i);
                let high = tone(140, i);
                [
                    (0.4 * low + 0.3 * high) as f32,
                    (0.2 * low - 0.25 * high) as f32,
                ]
            })
            .collect();
        let original = samples.clone();
        let range = SIZE..3 * SIZE;
        attenuate(
            &mut samples,
            range.clone(),
            37.0 * BIN_HZ,
            43.0 * BIN_HZ,
            24.0,
            &CancellationToken::new(),
        )
        .unwrap();
        assert_eq!(samples[..range.start], original[..range.start]);
        assert_eq!(samples[range.end..], original[range.end..]);
        assert_eq!(samples[range.start], original[range.start]);
        assert_eq!(samples[range.end - 1], original[range.end - 1]);
        let gain = 10.0_f64.powf(-24.0 / 20.0);
        for channel in 0..2 {
            let centre = range.start + HOP..range.start + HOP + SIZE;
            for (bin, expected) in [(40, gain), (140, 1.0)] {
                let projection = |audio: &[[f32; 2]]| {
                    centre
                        .clone()
                        .map(|i| f64::from(audio[i][channel]) * tone(bin, i))
                        .sum::<f64>()
                };
                assert!((projection(&samples) / projection(&original) - expected).abs() < 0.002);
            }
        }
    }
}
