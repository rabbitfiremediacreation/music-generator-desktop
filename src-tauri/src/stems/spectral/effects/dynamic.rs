use crate::{
    error::{Error, Result},
    stems::{
        dsp::dynamic_eq::{BandSettings, DynamicBand, Response},
        model::RATE,
        spectral::fft::SIZE,
    },
};
use std::ops::Range;
use tokio_util::sync::CancellationToken;

/// Apply block-edge fades while using the same band processor as the mixer.
pub(super) fn reduce(
    audio: &mut [[f32; 2]],
    range: Range<usize>,
    settings: BandSettings,
    response: Response,
    cancel: &CancellationToken,
) -> Result<()> {
    let mut processor = DynamicBand::new(settings, response, f64::from(RATE));
    let warmup = range.start.saturating_sub(SIZE);
    let fade = (range.len() / 4).clamp(1, RATE as usize / 200);
    for (index, pair) in audio.iter_mut().enumerate().take(range.end).skip(warmup) {
        if index % 4096 == 0 && cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        let mut frame = pair.map(f64::from);
        let edge = index
            .saturating_sub(range.start)
            .min(range.end - 1 - index)
            .min(fade);
        processor.process(&mut frame, edge as f64 / fade as f64);
        *pair = frame.map(|sample| sample as f32);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::TAU;

    fn tone(hz: f64, frame: usize) -> f64 {
        (TAU * hz * frame as f64 / f64::from(RATE)).sin()
    }

    #[test]
    fn cuts_loud_band_energy_and_preserves_quiet_or_unselected_samples() {
        let rate = RATE as usize;
        let range = rate / 4..rate * 3 / 4;
        for (frequency, response) in [(3100.0, Response::eq(2.0)), (6200.0, Response::de_esser())] {
            let dry: Vec<_> = (0..rate)
                .map(|index| {
                    let loudness = if index < rate / 2 { 0.02 } else { 0.4 };
                    let dry_band = tone(frequency, index) * loudness;
                    let other = tone(200.0, index) * 0.1;
                    [(dry_band + other) as f32, (dry_band * 0.4 - other) as f32]
                })
                .collect();
            let mut wet = dry.clone();
            let band = BandSettings {
                frequency_hz: frequency,
                threshold_db: -23.0,
                reduction_db: 9.0,
            };
            reduce(
                &mut wet,
                range.clone(),
                band,
                response,
                &CancellationToken::new(),
            )
            .unwrap();
            assert_eq!(wet[..rate / 2], dry[..rate / 2]);
            assert_eq!(wet[range.end..], dry[range.end..]);
            let level = |audio: &[[f32; 2]], channel, hz| {
                ((rate * 6 / 10)..(rate * 7 / 10))
                    .map(|i| f64::from(audio[i][channel]) * tone(hz, i))
                    .sum::<f64>()
            };
            for channel in 0..2 {
                let ratio = level(&wet, channel, frequency) / level(&dry, channel, frequency);
                assert!(
                    (0.34..0.55).contains(&ratio),
                    "{frequency} Hz channel {channel}: {ratio}"
                );
                let other = level(&wet, channel, 200.0) / level(&dry, channel, 200.0);
                assert!(
                    (0.97..1.03).contains(&other),
                    "{frequency} Hz channel {channel}: {other}"
                );
            }
        }
    }
}
