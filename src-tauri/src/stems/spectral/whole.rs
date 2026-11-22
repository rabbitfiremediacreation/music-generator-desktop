use super::{read_window, repair, Processing};
use crate::{
    error::{Error, Result},
    stems::wave::StereoWave,
};
use std::ops::Range;
use tokio_util::sync::CancellationToken;

// Multiples of the spectral FFT hop keep adjoining repair windows on the same grid.
pub(super) const BLOCK: u64 = 384 * 512;
const CONTEXT: u64 = 64 * 512;
const BLEND: u64 = 512;

/// Use identical absolute blocks for full rendering and for any requested excerpt.
pub(super) fn process(
    wave: &mut StereoWave,
    frames: u64,
    output: Range<u64>,
    processing: &Processing,
    cancel: &CancellationToken,
    mut write: impl FnMut(&[[f32; 2]]) -> Result<()>,
) -> Result<()> {
    let first = output.start / BLOCK;
    let previous = u64::from(output.start % BLOCK < BLEND);
    let mut tail = Vec::new();
    for block in first.saturating_sub(previous)..output.end.div_ceil(BLOCK) {
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        let start = block * BLOCK;
        let end = (start + BLOCK).min(frames);
        let leading = start.saturating_sub(CONTEXT);
        let trailing = (end + BLEND + CONTEXT).min(frames);
        let (mut audio, range) = read_window(wave, leading, trailing, frames)?;
        let offset = range.start + (start - leading) as usize;
        repair::process(&mut audio, range, processing, cancel)?;
        let (core, overlap) = audio[offset..offset + ((end + BLEND).min(frames) - start) as usize]
            .split_at_mut((end - start) as usize);
        crossfade(core, &tail);
        let from = output.start.max(start);
        let to = output.end.min(end);
        if from < to {
            write(&core[(from - start) as usize..(to - start) as usize])?;
        }
        tail.clear();
        tail.extend_from_slice(overlap);
    }
    Ok(())
}

fn crossfade(core: &mut [[f32; 2]], previous: &[[f32; 2]]) {
    for (index, (next, earlier)) in core.iter_mut().zip(previous).enumerate() {
        let fraction = index as f64 / BLEND as f64;
        for (wet, dry) in next.iter_mut().zip(earlier) {
            *wet = (f64::from(*dry) * (1.0 - fraction) + f64::from(*wet) * fraction) as f32;
        }
    }
}
