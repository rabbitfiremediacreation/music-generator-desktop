import { maxEqBands, type DynamicEqBand, type DynamicEqSettings } from "../../stems";
import { bandPass, StereoFilter } from "./dsp-filters";
import { Smoothed } from "./dsp-smoothed";

interface Response {
  attackMs: number;
  releaseMs: number;
  slope: number;
}

const eqResponse: Response = { attackMs: 8, releaseMs: 100, slope: .65 };
const deEssResponse: Response = { attackMs: 1, releaseMs: 45, slope: .85 };

class LiveBand {
  private filter = new StereoFilter();
  private signal = new Float64Array(2);
  private threshold = new Smoothed(1);
  private depth = new Smoothed(0);
  private wet = new Smoothed(0);
  private envelope = 0;
  private attack: number;
  private release: number;

  constructor(private rate: number, private response: Response = eqResponse) {
    const coefficient = (ms: number) => 1 - Math.exp(-1000 / (ms * rate));
    this.attack = coefficient(response.attackMs);
    this.release = coefficient(response.releaseMs);
  }

  configure(settings: DynamicEqBand | undefined, bypass: boolean, instant: boolean) {
    const active = settings !== undefined && !bypass;
    if (settings) {
      const starting = this.wet.value === 0;
      this.filter.configure(bandPass(settings.frequency_hz, settings.q, this.rate), instant || starting);
      this.threshold.set(10 ** (settings.threshold_db / 20), instant || starting);
      this.depth.set(settings.reduction_db, instant || starting);
    }
    this.wet.set(active ? 1 : 0, instant);
    if (instant && !active) this.reset();
  }

  reset() {
    this.filter.reset();
    this.envelope = 0;
  }

  process(pair: Float64Array, smooth: number) {
    const wet = this.wet.next(smooth);
    if (!wet) {
      if (this.envelope !== 0) this.reset();
      return;
    }
    const signal = this.signal;
    signal[0] = pair[0]; signal[1] = pair[1];
    this.filter.process(signal, smooth);
    const level = Math.max(Math.abs(signal[0]), Math.abs(signal[1]));
    this.envelope += (level - this.envelope) * (level > this.envelope ? this.attack : this.release);
    const threshold = this.threshold.next(smooth), depth = this.depth.next(smooth);
    if (this.envelope <= threshold) return;
    const cut = Math.min(20 * Math.log10(this.envelope / threshold) * this.response.slope, depth);
    const gain = (10 ** (-cut / 20) - 1) * wet;
    pair[0] += signal[0] * gain;
    pair[1] += signal[1] * gain;
  }
}

/** Reconfigure band targets without restarting the playback clock. */
export class LiveFrequencyDynamics {
  private bands: LiveBand[] = [];
  private deEsser: LiveBand;
  constructor(private rate: number) {
    this.deEsser = new LiveBand(rate, deEssResponse);
  }

  configure(settings: DynamicEqSettings | undefined, deEssAmount: number, instant: boolean) {
    const bands = settings?.bands ?? [];
    const length = Math.min(bands.length, maxEqBands);
    while (this.bands.length < length) this.bands.push(new LiveBand(this.rate));
    for (let index = 0; index < this.bands.length; index++) {
      this.bands[index].configure(bands[index], settings?.bypass === true, instant);
    }
    const strength = deEssAmount / 100;
    this.deEsser.configure(strength > 0 ? {
      frequency_hz: 6500, q: .9, threshold_db: -18 - 20 * strength, reduction_db: 12 * strength,
    } : undefined, false, instant);
  }

  reset() {
    this.bands.forEach(band => band.reset());
    this.deEsser.reset();
  }

  process(pair: Float64Array, smooth: number) {
    for (let index = 0; index < this.bands.length; index++) this.bands[index].process(pair, smooth);
    this.deEsser.process(pair, smooth);
  }
}
