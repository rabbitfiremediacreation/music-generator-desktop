import type { Pcm } from "./transport-core";

export interface StereoEnvelope {
  left: Float32Array;
  right: Float32Array;
  peak: number;
}

function channelEnvelope(samples: Float32Array, frames: number, bins: number) {
  const bounds = new Float32Array(bins * 2);
  let peak = 0;
  for (let bin = 0; bin < bins; bin++) {
    const start = Math.floor(bin * frames / bins);
    const end = Math.floor((bin + 1) * frames / bins);
    const available = Math.min(end, samples.length);
    const first = end <= samples.length ? samples[start] : 0;
    let low = first, high = first;
    for (let frame = start; frame < available; frame++) {
      const value = samples[frame];
      if (value < low) low = value;
      if (value > high) high = value;
    }
    bounds[bin * 2] = low;
    bounds[bin * 2 + 1] = high;
    peak = Math.max(peak, -low, high);
  }
  return { bounds, peak };
}

/** Keep signed min/max pairs for each side on the project clock, including any silent tail. */
export function stereoEnvelope(pcm: Pcm, frames: number, maxBins = 2048): StereoEnvelope {
  const bins = Math.min(frames, maxBins);
  const left = channelEnvelope(pcm.left, frames, bins);
  const right = pcm.left === pcm.right ? left : channelEnvelope(pcm.right, frames, bins);
  return { left: left.bounds, right: right.bounds, peak: Math.max(left.peak, right.peak) };
}
