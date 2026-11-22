import { returnFader, type FxReturn, type FxSlot, type ReturnEffect } from "../../stem-returns";
import { DspStrip } from "./dsp-strip";

const tau = 2 * Math.PI;
const lowPass = (hz: number, rate: number) => 1 - Math.exp(-tau * hz / rate);
type Wet = Exclude<ReturnEffect, { kind: "off" }>;

class DelayLine {
  private readonly samples: Float64Array;
  private cursor = 0;

  constructor(rate: number, maxMs: number) {
    this.samples = new Float64Array(Math.ceil(maxMs * rate / 1000) + 2);
  }

  read(delay: number) {
    const length = this.samples.length;
    const position = this.cursor + length - delay;
    const first = Math.floor(position);
    const fraction = position - first;
    const value = this.samples[first % length];
    return value + (this.samples[(first + 1) % length] - value) * fraction;
  }

  push(value: number) {
    this.samples[this.cursor] = value;
    this.cursor = (this.cursor + 1) % this.samples.length;
  }

  reset() {
    this.samples.fill(0);
    this.cursor = 0;
  }
}

type EchoSettings = Extract<Wet, { kind: "delay" | "slap_delay" }>;

class Echo {
  readonly output = [0, 0];
  private readonly lines: DelayLine[];
  private time = 0;
  private spread = 0;
  private feedback = 0;
  private tone = 0;

  constructor(private readonly rate: number, kind: EchoSettings["kind"]) {
    this.lines = Array.from({ length: 2 }, () => new DelayLine(rate, kind === "delay" ? 1200 : 280));
  }

  configure(effect: EchoSettings) {
    this.time = effect.time_ms * this.rate / 1000;
    this.spread = effect.kind === "slap_delay" ? effect.spread_ms * this.rate / 1000 : 0;
    this.feedback = effect.kind === "delay" ? effect.feedback / 100 : 0;
    this.tone = lowPass(effect.damping_hz, this.rate);
  }

  process(left: number, right: number) {
    const output = this.output;
    output[0] += (this.lines[0].read(this.time) - output[0]) * this.tone;
    output[1] += (this.lines[1].read(this.time + this.spread) - output[1]) * this.tone;
    this.lines[0].push(left + output[0] * this.feedback);
    this.lines[1].push(right + output[1] * this.feedback);
  }

  reset() {
    this.lines.forEach(line => line.reset());
    this.output.fill(0);
  }
}

class Chorus {
  readonly output = [0, 0];
  private readonly lines: DelayLine[];
  private readonly center: number;
  private phase = 0;
  private step = 0;
  private depth = 0;
  private stereo = 0;

  constructor(private readonly rate: number) {
    this.lines = Array.from({ length: 2 }, () => new DelayLine(rate, 30));
    this.center = 18 * rate / 1000;
  }

  configure(effect: Extract<Wet, { kind: "chorus" }>) {
    this.step = tau * effect.rate_hz / this.rate;
    this.depth = effect.depth_ms * this.rate / 1000;
    this.stereo = Math.PI * effect.stereo / 100;
  }

  process(left: number, right: number) {
    this.output[0] = this.lines[0].read(this.center + Math.sin(this.phase) * this.depth);
    this.output[1] = this.lines[1].read(this.center + Math.sin(this.phase + this.stereo) * this.depth);
    this.lines[0].push(left);
    this.lines[1].push(right);
    this.phase += this.step;
    if (this.phase >= tau) this.phase -= tau;
  }

  reset() {
    this.lines.forEach(line => line.reset());
    this.output.fill(0);
    this.phase = 0;
  }
}

/** Four damped delay lines scatter reflections through an orthogonal feedback matrix. */
class Reverb {
  readonly output = [0, 0];
  private readonly lines: DelayLine[];
  private taps = [0, 0, 0, 0];
  private decay = [0, 0, 0, 0];
  private readonly damped = [0, 0, 0, 0];
  private tone = 0;

  constructor(private readonly rate: number) {
    this.lines = Array.from({ length: 4 }, () => new DelayLine(rate, 66));
  }

  configure(effect: Extract<Wet, { kind: "reverb" }>) {
    const times = [29.7, 37.1, 41.1, 43.7].map(ms => ms * effect.size / 100);
    this.taps = times.map(ms => ms * this.rate / 1000);
    this.decay = times.map(ms => 10 ** (-3 * ms / (1000 * effect.decay_s)));
    this.tone = lowPass(effect.damping_hz, this.rate);
  }

  process(left: number, right: number) {
    const lines = this.lines;
    const x = lines[0].read(this.taps[0]), y = lines[1].read(this.taps[1]);
    const z = lines[2].read(this.taps[2]), w = lines[3].read(this.taps[3]);
    const damped = this.damped;
    damped[0] += (x - damped[0]) * this.tone;
    damped[1] += (y - damped[1]) * this.tone;
    damped[2] += (z - damped[2]) * this.tone;
    damped[3] += (w - damped[3]) * this.tone;
    const [a, b, c, d] = damped;
    lines[0].push(left * 0.5 + (a + b + c + d) * 0.5 * this.decay[0]);
    lines[1].push(right * 0.5 + (a - b + c - d) * 0.5 * this.decay[1]);
    lines[2].push(left * 0.5 + (a + b - c - d) * 0.5 * this.decay[2]);
    lines[3].push(-right * 0.5 + (a - b - c + d) * 0.5 * this.decay[3]);
    this.output[0] = (x + z) * 0.5;
    this.output[1] = (y - w) * 0.5;
  }

  reset() {
    this.lines.forEach(line => line.reset());
    this.damped.fill(0);
    this.output.fill(0);
  }
}

/** A wet-only effect followed by a channel strip before summing to the master. */
export class EffectBus {
  left = 0;
  right = 0;
  private readonly strip: DspStrip;
  private kind?: Wet["kind"];
  private processor?: Echo | Chorus | Reverb;

  constructor(readonly slot: FxSlot, private readonly rate: number) {
    this.strip = new DspStrip(rate);
  }

  configure(settings: FxReturn, routed: boolean, audible: boolean, instant: boolean) {
    const { effect } = settings;
    if (settings.enabled === false || effect.kind === "off" || (!this.processor && !routed)) {
      if (this.processor) this.reset();
      this.processor = undefined;
      this.kind = undefined;
      return;
    }
    const previous = this.kind === effect.kind ? this.processor : undefined;
    this.strip.configure({ ...returnFader(settings), pan: 0, fx: settings.fx }, audible, instant || !previous);
    if (!previous) this.strip.reset();
    this.kind = effect.kind;
    switch (effect.kind) {
      case "reverb": {
        const processor = previous instanceof Reverb ? previous : new Reverb(this.rate);
        processor.configure(effect);
        this.processor = processor;
        break;
      }
      case "chorus": {
        const processor = previous instanceof Chorus ? previous : new Chorus(this.rate);
        processor.configure(effect);
        this.processor = processor;
        break;
      }
      default: {
        const processor = previous instanceof Echo ? previous : new Echo(this.rate, effect.kind);
        processor.configure(effect);
        this.processor = processor;
      }
    }
  }

  get active() { return Boolean(this.processor); }
  get reductionGain() { return this.strip.reductionGain; }

  process() {
    const processor = this.processor!;
    processor.process(this.left, this.right);
    this.strip.process(processor.output[0], processor.output[1], 1);
    this.left = this.strip.output[0];
    this.right = this.strip.output[1];
  }

  reset() { this.processor?.reset(); this.strip.reset(); }
}
