import {
  brickwallSetting, compressorDefaults, compressorMakeup, compressorMode, compressorRatio, compressorTuning, fetDefaults, neutralFx, vcaDefaults,
  type DynamicsSettings, type Track,
} from "../../stems";
import { equalizer, filterCoefficients, StereoFilter } from "./dsp-filters";
import { LiveFrequencyDynamics } from "./dsp-frequency-dynamics";
import { Smoothed } from "./dsp-smoothed";

export const amplitude = (db: number) => 10 ** (db / 20);
const ceiling = amplitude(-1);

/** Stereo-linked soft-knee compression and an independent output clipper. */
export class Dynamics {
  private comp = new Smoothed(0);
  private mix = new Smoothed(0);
  private drive = new Smoothed(1);
  private wet = new Smoothed(0);
  private makeup = new Smoothed(1);
  private reduction = 0;
  private optical = false;
  private opticalMemory = 0;
  private opticalCharge = 0;
  private opticalRelease = 0;
  private programRelease?: { mode: "fet" | "vca"; pressure: number; tracking: number; slow: number; depth: number };
  private limitGain = 1;
  private compressorGain = 1;
  private limiterGain = 1;
  private limitEnabled = false;
  private clipCeiling?: number;
  private attack = 0;
  private release = 0;
  private limitRelease = 0;
  private halfKnee = 0;
  private curve?: { threshold: number; slope: number };
  private smooth: number;

  constructor(private rate: number) {
    this.smooth = 1 - Math.exp(-1 / (rate * .008));
  }

  configure(comp: number, limit: number, settings: DynamicsSettings | undefined, instant: boolean) {
    const { attack_ms, release_ms, knee_db } = { ...compressorDefaults, ...settings };
    const coefficient = (ms: number) => 1 - Math.exp(-1 / (this.rate * ms / 1000));
    const mode = compressorMode(settings);
    const optical = mode === "optical";
    const fet = mode === "fet";
    const vca = mode === "vca";
    if (this.optical && !optical) this.reduction = this.envelope;
    if (!this.optical && optical) this.opticalMemory = this.reduction;
    this.optical = optical;
    const attack = fet ? (settings?.fet_attack_us ?? fetDefaults.fet_attack_us) / 1000
      : vca ? settings?.vca_attack_ms ?? vcaDefaults.vca_attack_ms : attack_ms;
    const vcaRelease = settings?.vca_release_ms ?? vcaDefaults.vca_release_ms;
    const release = fet ? settings?.fet_release_ms ?? fetDefaults.fet_release_ms : vca ? vcaRelease || 100 : release_ms;
    this.attack = coefficient(attack);
    this.release = coefficient(optical ? release / 4 : release);
    this.programRelease = fet || (vca && vcaRelease === 0) ? {
      mode, pressure: this.programRelease?.mode === mode ? this.programRelease.pressure : 0,
      tracking: coefficient(vca ? 250 : 150), slow: coefficient(vca ? 1200 : release * 3), depth: vca ? 6 : 12,
    } : undefined;
    this.opticalCharge = coefficient(250);
    this.opticalRelease = coefficient(release_ms * 8);
    this.limitRelease = coefficient(settings?.release_ms ?? (limit > 0 ? 80 : release_ms));
    this.comp.set(comp / 100, instant);
    const tuning = compressorTuning(comp, settings);
    const brickwall = brickwallSetting(settings);
    this.clipCeiling = brickwall ? amplitude(tuning.threshold_db) : undefined;
    const parallel = fet || vca || settings?.auto_gain || settings?.mix !== undefined || settings?.ratio !== undefined ||
      settings?.threshold_db !== undefined;
    const ratio = compressorRatio(tuning.ratio, settings);
    this.halfKnee = knee_db / 2 * (vca ? 1 + 2 / ratio : 1);
    this.curve = parallel ? { threshold: tuning.threshold_db, slope: 1 / ratio - 1 } : undefined;
    this.mix.set(tuning.mix / 100, instant || !parallel);
    this.makeup.set(amplitude(compressorMakeup(tuning.threshold_db, ratio, settings)), instant);
    this.drive.set(amplitude(12 * limit / 100), instant);
    this.limitEnabled = brickwall === undefined && (settings?.limiter ?? limit > 0);
    const limitInstant = instant || brickwall !== undefined;
    this.wet.set(this.limitEnabled ? 1 : 0, limitInstant);
    if (instant && (parallel ? tuning.mix === 0 : comp === 0)) this.resetEnvelope();
    if (limitInstant && !this.limitEnabled) this.limitGain = 1;
  }

  get reductionGain() { return this.compressorGain * this.limiterGain; }

  /** The slow envelope prolongs recovery after sustained compression without slowing the attack. */
  private get envelope() {
    return this.optical ? (this.reduction + Math.min(this.reduction, this.opticalMemory)) / 2 : this.reduction;
  }

  private resetEnvelope() {
    this.reduction = this.opticalMemory = 0;
    if (this.programRelease) this.programRelease.pressure = 0;
  }

  reset() { this.resetEnvelope(); this.limitGain = 1; this.compressorGain = 1; this.limiterGain = 1; }

  compress(pair: Float64Array) {
    const amount = this.comp.next(this.smooth);
    const wet = this.curve ? this.mix.next(this.smooth) : 1;
    if (this.curve ? wet > 0 : amount !== 0 || this.reduction !== 0) {
      const peak = Math.max(Math.abs(pair[0]), Math.abs(pair[1]));
      const over = 20 * Math.log10(peak) - (this.curve?.threshold ?? -36 * amount);
      const slope = this.curve?.slope ?? 1 / (1 + 7 * amount) - 1;
      const knee = this.halfKnee;
      const wanted = over <= -knee ? 0 : slope * (over >= knee ? over : (over + knee) ** 2 / (4 * knee));
      let release = this.release;
      const program = this.programRelease;
      if (program) {
        const pressure = Math.min(1, -wanted / program.depth);
        program.pressure += (pressure - program.pressure) * program.tracking;
        if (program.pressure < 1e-9) program.pressure = 0;
        release += (program.slow - release) * program.pressure;
      }
      this.reduction += (wanted - this.reduction) * (wanted < this.reduction ? this.attack : release);
      if (Math.abs(this.reduction) < 1e-9) this.reduction = 0;
      if (this.optical) {
        this.opticalMemory += (wanted - this.opticalMemory) * (wanted < this.opticalMemory ? this.opticalCharge : this.opticalRelease);
        if (Math.abs(this.opticalMemory) < 1e-9) this.opticalMemory = 0;
      }
    } else {
      this.resetEnvelope();
    }
    const envelope = this.envelope;
    const reduced = envelope === 0 ? 1 : amplitude(envelope);
    this.compressorGain = blendGain(reduced, wet);
    const gain = blendGain(reduced * this.makeup.next(this.smooth), wet);
    pair[0] *= gain; pair[1] *= gain;
  }

  limit(pair: Float64Array) {
    const clip = this.clipCeiling;
    if (clip !== undefined) {
      const peak = Math.max(Math.abs(pair[0]), Math.abs(pair[1]));
      this.limiterGain = peak > clip ? clip / peak : 1;
      pair[0] = Math.max(-clip, Math.min(clip, pair[0]));
      pair[1] = Math.max(-clip, Math.min(clip, pair[1]));
      return;
    }
    const wet = this.wet.next(this.smooth);
    const drive = this.drive.next(this.smooth);
    if (wet === 0) { this.limitGain = 1; this.limiterGain = 1; return; }
    const inputPeak = Math.max(Math.abs(pair[0]), Math.abs(pair[1]));
    const peak = inputPeak * drive;
    this.limitGain = Math.min(peak > ceiling ? ceiling / peak : 1, this.limitGain + (1 - this.limitGain) * this.limitRelease);
    const blended = 1 + (drive * this.limitGain - 1) * wet;
    const gain = this.limitEnabled && inputPeak > 0 ? Math.min(blended, ceiling / inputPeak) : blended;
    this.limiterGain = Math.min(1, gain / (1 + (drive - 1) * wet));
    pair[0] *= gain; pair[1] *= gain;
  }
}

function blendGain(gain: number, wet: number) {
  return wet === 1 ? gain : 1 + (gain - 1) * wet;
}

export class DspStrip {
  private filters = [new StereoFilter(), new StereoFilter(), new StereoFilter(), new StereoFilter()];
  private dynamics: Dynamics;
  private frequencyDynamics: LiveFrequencyDynamics;
  private width = new Smoothed(1);
  private left = new Smoothed(1);
  private right = new Smoothed(1);
  private gate = new Smoothed(1);
  private smooth: number;
  readonly output = new Float64Array(2);
  get reductionGain() { return this.gate.value === 0 ? 1 : this.dynamics.reductionGain; }

  constructor(private rate: number) {
    this.dynamics = new Dynamics(rate);
    this.frequencyDynamics = new LiveFrequencyDynamics(rate);
    this.smooth = 1 - Math.exp(-1 / (rate * .008));
  }

  configure(track: Pick<Track, "fx" | "dynamic_eq" | "gain_db" | "gain_off" | "pan">, audible: boolean, instant: boolean) {
    const fx = { ...neutralFx, ...track.fx };
    this.filters[0].configure(filterCoefficients(fx.filter, this.rate), instant);
    this.filters[1].configure(equalizer("low", 100, fx.low_db, this.rate), instant);
    this.filters[2].configure(equalizer("mid", 1000, fx.mid_db, this.rate), instant);
    this.filters[3].configure(equalizer("high", 10000, fx.high_db, this.rate), instant);
    this.frequencyDynamics.configure(track.dynamic_eq, fx.de_ess, instant);
    this.dynamics.configure(fx.comp, fx.limit, fx.dynamics, instant);
    this.width.set(fx.width / 100, instant);
    const gain = track.gain_off ? 0 : amplitude(track.gain_db);
    this.left.set(gain * (1 - Math.max(0, track.pan)), instant);
    this.right.set(gain * (1 + Math.min(0, track.pan)), instant);
    this.gate.set(audible ? 1 : 0, instant);
  }

  reset() { this.filters.forEach(filter => filter.reset()); this.frequencyDynamics.reset(); this.dynamics.reset(); }

  process(left: number, right: number, fade: number) {
    const pair = this.output;
    pair[0] = left; pair[1] = right;
    for (let i = 0; i < this.filters.length; i++) this.filters[i].process(pair, this.smooth);
    this.frequencyDynamics.process(pair, this.smooth);
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
  get reductionGain() { return this.level.value === 0 ? 1 : this.dynamics.reductionGain; }

  constructor(rate: number) {
    this.dynamics = new Dynamics(rate);
    this.smooth = 1 - Math.exp(-1 / (rate * .008));
  }

  configure(gain: number, comp: number, limit: number, settings: DynamicsSettings | undefined, instant: boolean) {
    this.level.set(gain, instant);
    this.dynamics.configure(comp, limit, settings, instant);
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
