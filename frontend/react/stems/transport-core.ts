import { audibleTracks, type StemMix } from "../../stems";
import { amplitude, DspMaster, DspStrip } from "./dsp-strip";

export interface Pcm { left: Float32Array; right: Float32Array }
export type StereoPeak = [number, number];
export interface Position {
  frame: number; playing: boolean; playRevision: number; peaks: number[]; master: number;
  stereo: StereoPeak[]; masterStereo: StereoPeak;
}
export type PlaybackSnapshot = Pick<Position, "frame" | "playing" | "playRevision">;
export type TransportMessage =
  | { type: "audio"; index: number; pcm: Pcm }
  | { type: "mix"; mix: StemMix }
  | { type: "seek"; frame: number }
  | { type: "compare"; original: boolean }
  | { type: "mono"; mono: boolean }
  | { type: "play"; playing: boolean; revision?: number };
export type WorkletCommand = TransportMessage | { type: "freeze" };
export type WorkletReport = Position | { type: "frozen"; position: PlaybackSnapshot };

interface Channel { pcm?: Pcm; dsp: DspStrip; fadeIn: number; fadeOut: number }

/** Both monitor paths share the same sample clock, even at a different device rate. */
export class StemTransport {
  private frame = 0;
  private playing = false;
  private first = 0;
  private end: number;
  private loop = false;
  private original?: Pcm;
  private channels: Channel[];
  private master: DspMaster;
  private comparison = 0;
  private compareTarget = 0;
  private mono = 0;
  private monoTarget = 0;
  private increment: number;
  private transition: number;
  private status: Position;

  constructor(private rate: number, private frames: number, tracks: number, outputRate = rate) {
    this.end = frames;
    this.increment = rate / outputRate;
    this.transition = 1 / (outputRate * .008);
    this.master = new DspMaster(outputRate);
    this.channels = Array.from({ length: tracks }, () => ({ dsp: new DspStrip(outputRate), fadeIn: 0, fadeOut: 0 }));
    this.status = { frame: 0, playing: false, playRevision: 0, peaks: Array(tracks).fill(0), master: 0,
      stereo: Array.from({ length: tracks }, () => [0, 0]), masterStereo: [0, 0] };
  }

  receive(message: TransportMessage) {
    switch (message.type) {
      case "audio": {
        if (message.index === -1) this.original = message.pcm;
        else this.channels[message.index].pcm = message.pcm;
        break;
      }
      case "mix": this.configure(message.mix); break;
      case "seek":
        this.frame = Math.max(this.first, Math.min(this.end, Math.round(message.frame)));
        this.reset();
        break;
      case "compare":
        this.compareTarget = Number(message.original);
        if (!this.playing) this.comparison = this.compareTarget;
        break;
      case "mono":
        this.monoTarget = Number(message.mono);
        if (!this.playing) this.mono = this.monoTarget;
        break;
      case "play":
        if (message.playing && this.frame >= this.end) { this.frame = this.first; this.reset(); }
        this.playing = message.playing;
        this.status.playRevision = message.revision ?? 0;
        break;
    }
  }

  /** Stop at the audio clock's current frame and return its state immediately before stopping. */
  freeze(): PlaybackSnapshot {
    const snapshot = {
      frame: Math.floor(Math.min(this.frame, this.end)),
      playing: this.playing && (this.loop || this.frame < this.end),
      playRevision: this.status.playRevision,
    };
    this.playing = false;
    return snapshot;
  }

  private reset() {
    for (const channel of this.channels) channel.dsp.reset();
    this.master.reset();
  }

  private configure(mix: StemMix) {
    const changed = mix.first !== this.first || mix.end !== this.end;
    this.first = mix.first;
    this.end = Math.min(this.frames, mix.end);
    this.loop = mix.looping;
    if (this.frame < this.first || this.frame > this.end || (changed && this.frame === this.end)) {
      this.frame = this.first;
      this.reset();
    }
    const audible = new Set(audibleTracks(mix).map(track => track.role));
    this.master.configure(mix.master_off ? 0 : amplitude(mix.master_db), mix.master_comp ?? 0, mix.master_limit ?? 0, !this.playing);
    for (const [index, track] of mix.tracks.entries()) {
      const channel = this.channels[index];
      channel.dsp.configure(track, audible.has(track.role), !this.playing);
      channel.fadeIn = track.fade_in * this.rate;
      channel.fadeOut = track.fade_out * this.rate;
    }
  }

  render(left: Float32Array, right: Float32Array): Position {
    const { stereo, masterStereo, peaks } = this.status;
    masterStereo[0] = masterStereo[1] = 0;
    for (const peak of stereo) peak[0] = peak[1] = 0;
    for (let sample = 0; sample < left.length; sample++) {
      if (this.frame >= this.end) {
        if (this.playing && this.loop) { this.frame = this.first + (this.frame - this.end) % (this.end - this.first); this.reset(); }
        else { this.frame = this.end; this.playing = false; }
      }
      if (!this.playing) {
        left.fill(0, sample);
        right.fill(0, sample);
        break;
      }
      const index = Math.floor(this.frame);
      const fraction = this.frame - index;
      const next = index + 1 < this.end ? index + 1 : this.loop ? this.first : index;
      let l = 0, r = 0;
      for (let ch = 0; ch < this.channels.length; ch++) {
        const channel = this.channels[ch];
        if (!channel.pcm) continue;
        const rising = channel.fadeIn > 0 ? Math.min(1, (this.frame - this.first) / channel.fadeIn) : 1;
        const falling = channel.fadeOut > 0 ? Math.max(0, Math.min(1, (this.end - this.frame - 1) / channel.fadeOut)) : 1;
        channel.dsp.process(at(channel.pcm.left, index, next, fraction), at(channel.pcm.right, index, next, fraction), rising * falling);
        const pair = channel.dsp.output;
        stereo[ch][0] = Math.max(stereo[ch][0], Math.abs(pair[0]));
        stereo[ch][1] = Math.max(stereo[ch][1], Math.abs(pair[1]));
        l += pair[0]; r += pair[1];
      }
      this.master.process(l, r);
      l = this.master.output[0];
      r = this.master.output[1];
      masterStereo[0] = Math.max(masterStereo[0], Math.abs(l));
      masterStereo[1] = Math.max(masterStereo[1], Math.abs(r));
      this.comparison = approach(this.comparison, this.compareTarget, this.transition);
      if (this.original && this.comparison) {
        l += (at(this.original.left, index, next, fraction) - l) * this.comparison;
        r += (at(this.original.right, index, next, fraction) - r) * this.comparison;
      }
      this.mono = approach(this.mono, this.monoTarget, this.transition);
      const mid = (l + r) / 2;
      left[sample] = l + (mid - l) * this.mono;
      right[sample] = r + (mid - r) * this.mono;
      this.frame += this.increment;
    }
    for (let index = 0; index < peaks.length; index++) peaks[index] = Math.max(stereo[index][0], stereo[index][1]);
    this.status.master = Math.max(...masterStereo);
    this.status.frame = Math.floor(Math.min(this.frame, this.end));
    this.status.playing = this.playing;
    return this.status;
  }
}

function at(channel: Float32Array, index: number, next: number, fraction: number) {
  const a = channel[index] ?? 0;
  return fraction ? a + ((channel[next] ?? 0) - a) * fraction : a;
}

function approach(value: number, target: number, step: number) {
  return value < target ? Math.min(target, value + step) : Math.max(target, value - step);
}

export function readStereoWave(bytes: ArrayBuffer, frames: number, rate: number): Pcm {
  const data = new DataView(bytes);
  if (bytes.byteLength < 44 || data.getUint32(0) !== 0x52494646 || data.getUint32(8) !== 0x57415645) throw new Error("stem_output_invalid");
  const end = data.getUint32(4, true) + 8;
  if (end > bytes.byteLength) throw new Error("stem_output_invalid");
  let channels = 0;
  let sampleRate = 0;
  let audio: { body: number; size: number } | undefined;
  for (let start = 12; start < end;) {
    if (start + 8 > end) throw new Error("stem_output_invalid");
    const kind = data.getUint32(start);
    const size = data.getUint32(start + 4, true);
    const body = start + 8;
    start = body + size + (size % 2);
    if (start > end) throw new Error("stem_output_invalid");
    if (kind === 0x666d7420) {
      if (size < 16 || channels) throw new Error("stem_output_invalid");
      channels = data.getUint16(body + 2, true);
      sampleRate = data.getUint32(body + 4, true);
      if (!channels || !sampleRate || data.getUint16(body, true) !== 3 || data.getUint16(body + 14, true) !== 32
        || data.getUint16(body + 12, true) !== channels * 4 || data.getUint32(body + 8, true) !== sampleRate * channels * 4) {
        throw new Error("stem_output_invalid");
      }
    } else if (kind === 0x64617461) {
      if (audio) throw new Error("stem_output_invalid");
      audio = { body, size };
    }
  }
  const stride = channels * 4;
  if (!audio || !channels || !audio.size || audio.size % stride) throw new Error("stem_output_invalid");
  const count = audio.size / stride;
  if (sampleRate !== rate || (channels !== 1 && channels !== 2) || count > frames) throw new Error("stem_output_alignment");
  const left = new Float32Array(count);
  const right = new Float32Array(count);
  for (let index = 0; index < count; index++) {
    const offset = audio.body + index * stride;
    left[index] = data.getFloat32(offset, true);
    right[index] = channels === 2 ? data.getFloat32(offset + 4, true) : left[index];
    if (!(Number.isFinite(left[index]) && Number.isFinite(right[index]))) throw new Error("stem_output_invalid");
  }
  return { left, right };
}
