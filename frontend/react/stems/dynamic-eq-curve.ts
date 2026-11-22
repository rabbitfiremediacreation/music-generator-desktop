import type { StemSpectrogram } from "../../stems";
import type { DynamicEqBand } from "./repair-tools";

const floorHz = 20;
const ceilingHz = 20000;
const logSpan = Math.log(ceilingHz / floorHz);

export const eqFrequencyAt = (position: number) => floorHz * Math.exp(position * logSpan);
export const eqFrequencyPosition = (hz: number) => Math.log(hz / floorHz) / logSpan;
export const eqCutPosition = (cut: number) => .09 + cut * (.82 / 24);
export const eqCutAt = (position: number) => (position - .09) * (24 / .82);

/** Magnitude of dry plus the attenuated band-pass used by the Rust repair engine. */
export function dynamicEqCut(band: DynamicEqBand, hz: number, rate: number): number {
  const center = 2 * Math.PI * band.frequency_hz / rate;
  const angle = 2 * Math.PI * hz / rate;
  const offset = Math.cos(angle) - Math.cos(center);
  const width = Math.sin(center) * Math.sin(angle) / (2 * band.q);
  const gain = 10 ** (-band.reduction_db / 20);
  return 20 * Math.log10(Math.hypot(offset, width) / Math.hypot(offset, gain * width));
}

/** Get the strongest level in each frequency row across the marked time range. */
export function eqSpectrum(image: StemSpectrogram, from: number, to: number) {
  const first = Math.max(0, Math.min(image.width - 1, Math.floor(from * image.width)));
  const end = Math.min(image.width, Math.max(first + 1, Math.ceil(to * image.width)));
  return Array.from({ length: image.height }, (_, row) => {
    let peak = 0;
    for (let column = first; column < end; column++) {
      peak = Math.max(peak, image.levels[row * image.width + column]);
    }
    const hz = image.max_hz * (image.min_hz / image.max_hz) ** ((row + .5) / image.height);
    return { x: eqFrequencyPosition(hz), level: peak / 255 };
  }).reverse();
}
