import { neutralFx, type Track } from "../../stems";
import { equalizer, filterCoefficients, StereoFilter } from "./dsp-filters";

export const amplitude = (db: number) => 10 ** (db / 20);
const ceiling = amplitude(-1);

class Smoothed {
  constructor(public value: number, private target = value) {}
  set(target: number, instant: boolean) {
    this.target = target;
    if (instant) this.value = target;
  }
  next(step: number) {
    const delta = this.target - this.value;
    this.value = Math.abs(delta) < 1e-9 ? this.target : this.value + delta * step;
    return this.value;
  }
}

/** Stereo-linked soft-knee compression and zero-lookahead peak limiting. */
export class Dynamics {
  private comp = new Smoothed(0);
  private drive = new Smoothed(1);
  private wet = new Smoothed(0);
  private reduction = 0;
  private limitGain = 1;
  private limitEnabled = false;
  private attack: number;
  private release: number;
  private limitRelease: number;
  private smooth: number;

  constructor(rate: number) {
    this.attack = 1 - Math.exp(-1 / (rate * .010));
    this.release = 1 - Math.exp(-1 / (rate * .120));
    this.limitRelease = 1 - Math.exp(-1 / (rate * .080));
    this.smooth = 1 - Math.exp(-1 / (rate * .008));
  }

  configure(comp: number, limit: number, instant: boolean) {
    this.comp.set(comp / 100, instant);
    this.drive.set(amplitude(12 * limit / 100), instant);
    this.limitEnabled = limit > 0;
    this.wet.set(this.limitEnabled ? 1 : 0, instant);
    if (instant && comp === 0) this.reduction = 0;
    if (instant && limit === 0) this.limitGain = 1;
  }

  reset() { this.reduction = 0; this.limitGain = 1; }

  compress(pair: Float64Array) {
    const amount = this.comp.next(this.smooth);
    if (amount === 0 && this.reduction === 0) return;
    const peak = Math.max(Math.abs(pair[0]), Math.abs(pair[1]));
    const over = peak > 0 ? 20 * Math.log10(peak) + 36 * amount : -Infinity;
    const slope = 1 / (1 + 7 * amount) - 1;
    const wanted = over <= -3 ? 0 : slope * (over >= 3 ? over : (over + 3) ** 2 / 12);
    this.reduction += (wanted - this.reduction) * (wanted < this.reduction ? this.attack : this.release);
    if (Math.abs(this.reduction) < 1e-9) this.reduction = 0;
    const gain = amplitude(this.reduction);
    pair[0] *= gain; pair[1] *= gain;
  }

  limit(pair: Float64Array) {
    const wet = this.wet.next(this.smooth);
    const drive = this.drive.next(this.smooth);
    if (wet === 0) { this.limitGain = 1; return; }
    const inputPeak = Math.max(Math.abs(pair[0]), Math.abs(pair[1]));
    const peak = inputPeak * drive;
    this.limitGain = Math.min(peak > ceiling ? ceiling / peak : 1, this.limitGain + (1 - this.limitGain) * this.limitRelease);
    const blended = 1 + (drive * this.limitGain - 1) * wet;
    const gain = this.limitEnabled && inputPeak > 0 ? Math.min(blended, ceiling / inputPeak) : blended;
    pair[0] *= gain; pair[1] *= gain;
  }
}

export class DspStrip {
  private filters = [new StereoFilter(), new StereoFilter(), new StereoFilter(), new StereoFilter()];
  private dynamics: Dynamics;
  private width = new Smoothed(1);
  private left = new Smoothed(1);
  private right = new Smoothed(1);
  private gate = new Smoothed(1);
  private smooth: number;
  readonly output = new Float64Array(2);

  constructor(private rate: number) {
    this.dynamics = new Dynamics(rate);
    this.smooth = 1 - Math.exp(-1 / (rate * .008));
  }

  configure(track: Track, audible: boolean, instant: boolean) {
    const fx = { ...neutralFx, ...track.fx };
    this.filters[0].configure(filterCoefficients(fx.filter, this.rate), instant);
    this.filters[1].configure(equalizer("low", 100, fx.low_db, this.rate), instant);
    this.filters[2].configure(equalizer("mid", 1000, fx.mid_db, this.rate), instant);
    this.filters[3].configure(equalizer("high", 10000, fx.high_db, this.rate), instant);
    this.dynamics.configure(fx.comp, fx.limit, instant);
    this.width.set(fx.width / 100, instant);
    const gain = track.gain_off ? 0 : amplitude(track.gain_db);
    this.left.set(gain * (1 - Math.max(0, track.pan)), instant);
    this.right.set(gain * (1 + Math.min(0, track.pan)), instant);
    this.gate.set(audible ? 1 : 0, instant);
  }

  reset() { this.filters.forEach(filter => filter.reset()); this.dynamics.reset(); }

  process(left: number, right: number, fade: number) {
    const pair = this.output;
    pair[0] = left; pair[1] = right;
    for (let i = 0; i < this.filters.length; i++) this.filters[i].process(pair, this.smooth);
    this.dynamics.compress(pair);
    const width = this.width.next(this.smooth);
    if (width !== 1) {
      const mid = (pair[0] + pair[1]) / 2, side = (pair[0] - pair[1]) * width / 2;
      pair[0] = mid + side; pair[1] = mid - side;
    }
    pair[0] *= this.left.next(this.smooth) * fade;
    pair[1] *= this.right.next(this.smooth) * fade;
    this.dynamics.limit(pair);
    const gate = this.gate.next(this.smooth);
    pair[0] *= gate; pair[1] *= gate;
  }
}

export class DspMaster {
  private dynamics: Dynamics;
  private level = new Smoothed(1);
  private smooth: number;
  readonly output = new Float64Array(2);

  constructor(rate: number) {
    this.dynamics = new Dynamics(rate);
    this.smooth = 1 - Math.exp(-1 / (rate * .008));
  }

  configure(gain: number, comp: number, limit: number, instant: boolean) {
    this.level.set(gain, instant);
    this.dynamics.configure(comp, limit, instant);
  }

  reset() { this.dynamics.reset(); }

  process(left: number, right: number) {
    const pair = this.output;
    pair[0] = left; pair[1] = right;
    this.dynamics.compress(pair);
    const level = this.level.next(this.smooth);
    pair[0] *= level; pair[1] *= level;
    this.dynamics.limit(pair);
  }
}
