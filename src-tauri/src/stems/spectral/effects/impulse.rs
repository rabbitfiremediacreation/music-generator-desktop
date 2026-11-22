use crate::error::{Error, Result};
use std::ops::Range;
use tokio_util::sync::CancellationToken;

const BLOCK: usize = 128;

pub(super) struct Settings {
    floor: f64,
    threshold: f64,
    max_width: usize,
    gap: usize,
}

impl Settings {
    pub(super) fn click(sensitivity: f64) -> Self {
        let amount = sensitivity / 100.0;
        Self {
            floor: 0.048 * (1.25 - amount),
            threshold: 12.0 - 7.0 * amount,
            max_width: 64,
            gap: 8,
        }
    }

    pub(super) fn crackle(sensitivity: f64) -> Self {
        let amount = sensitivity / 100.0;
        Self {
            floor: 0.010 * (1.25 - amount),
            threshold: 8.0 - 5.0 * amount,
            max_width: 12,
            gap: 3,
        }
    }
}

/// Detect short local prediction errors and interpolate the surrounding clean samples.
pub(super) fn repair(
    audio: &mut [[f32; 2]],
    range: Range<usize>,
    settings: Settings,
    cancel: &CancellationToken,
) -> Result<()> {
    let margin = settings.max_width + settings.gap;
    let first = range.start.saturating_sub(margin).max(1);
    let end = (range.end + margin).min(audio.len().saturating_sub(1));
    if end <= first {
        return Ok(());
    }
    for channel in 0..2 {
        let residual: Vec<_> = audio
            .windows(3)
            .map(|window| {
                let [left, middle, right] =
                    [window[0], window[1], window[2]].map(|pair| f64::from(pair[channel]));
                (middle - (left + right) / 2.0).abs()
            })
            .collect();
        let mut run = None;
        for block in (first..end).step_by(BLOCK) {
            if cancel.is_cancelled() {
                return Err(Error::Cancelled);
            }
            let min = baseline(&residual, block - 1, settings.threshold).max(settings.floor);
            for frame in block..(block + BLOCK).min(end) {
                if residual[frame - 1] < min {
                    continue;
                }
                run = match run {
                    Some((start, last)) if frame - last <= settings.gap => Some((start, frame)),
                    previous => {
                        if let Some((start, last)) = previous {
                            interpolate(
                                audio,
                                channel,
                                start..last + 1,
                                &range,
                                settings.max_width,
                            );
                        }
                        Some((frame, frame))
                    }
                };
            }
        }
        if let Some((start, last)) = run {
            interpolate(audio, channel, start..last + 1, &range, settings.max_width);
        }
    }
    Ok(())
}

fn baseline(residual: &[f64], block: usize, threshold: f64) -> f64 {
    let mut local: [f64; BLOCK] = std::array::from_fn(|index| {
        let offset = (block + 2 * index)
            .saturating_sub(BLOCK / 2)
            .min(residual.len() - 1);
        residual[offset]
    });
    let (_, median, _) = local.select_nth_unstable_by(BLOCK / 2, f64::total_cmp);
    *median * threshold
}

fn interpolate(
    audio: &mut [[f32; 2]],
    channel: usize,
    impulse: Range<usize>,
    selection: &Range<usize>,
    max_width: usize,
) {
    let width = impulse.len();
    if width > max_width {
        return;
    }
    let left = f64::from(audio[impulse.start - 1][channel]);
    let right = f64::from(audio[impulse.end][channel]);
    let first = impulse.start.max(selection.start);
    let end = impulse.end.min(selection.end);
    if end <= first {
        return;
    }
    for (index, pair) in audio[first..end].iter_mut().enumerate() {
        let position = (first + index + 1 - impulse.start) as f64 / (width + 1) as f64;
        pair[channel] = (left + (right - left) * position) as f32;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn click_and_crackle_presets_repair_different_impulse_levels_without_changing_the_other_channel(
    ) {
        let clean: Vec<_> = (0..2000)
            .map(|i| {
                let value = ((i as f64 * 0.02).sin() * 0.2) as f32;
                [value, -value]
            })
            .collect();
        let mut audio = clean.clone();
        audio[199][0] += 0.8;
        audio[600][0] += 0.7;
        let ticks = [900, 924, 955];
        for tick in ticks {
            audio[tick][0] += 0.018;
        }
        let cancel = CancellationToken::new();
        repair(&mut audio, 200..1800, Settings::click(50.0), &cancel).unwrap();
        assert!((audio[600][0] - clean[600][0]).abs() < 0.001);
        assert!((audio[199][0] - clean[199][0]).abs() > 0.7);
        assert!((audio[200][0] - clean[200][0]).abs() < 0.001);
        assert!((audio[900][0] - clean[900][0]).abs() > 0.017);
        repair(&mut audio, 800..1000, Settings::crackle(50.0), &cancel).unwrap();
        for tick in ticks {
            assert!((audio[tick][0] - clean[tick][0]).abs() < 0.002);
        }
        assert!(audio.iter().zip(&clean).all(|(wet, dry)| wet[1] == dry[1]));
        assert_eq!(audio[1200..], clean[1200..]);
    }
}
