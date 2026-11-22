import { StemTransport, type Position, type StereoPeak, type WorkletCommand, type WorkletReport } from "./transport-core";
import { fxSlots, mapFxSlots } from "../../stem-returns";

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare const sampleRate: number;
type Options = { processorOptions: { rate: number; frames: number; tracks: number } };
declare function registerProcessor(name: string, processor: new (options: Options) => AudioWorkletProcessor): void;

class StemProcessor extends AudioWorkletProcessor {
  private transport: StemTransport;
  private counter = 0;
  private stereo: StereoPeak[];
  private master: StereoPeak = [0, 0];
  private returnStereo = mapFxSlots<StereoPeak>(() => [0, 0]);
  private reduction: number[];
  private masterReduction = 0;
  private returnReduction = mapFxSlots(() => 0);

  constructor(options: Options) {
    super();
    const { rate, frames, tracks } = options.processorOptions;
    this.transport = new StemTransport(rate, frames, tracks, sampleRate);
    this.stereo = Array.from({ length: tracks }, () => [0, 0]);
    this.reduction = Array(tracks).fill(0);
    this.port.onmessage = (event: MessageEvent<WorkletCommand>) => {
      if (event.data.type === "freeze") {
        this.port.postMessage({ type: "frozen", position: this.transport.freeze() } satisfies WorkletReport);
        return;
      }
      this.transport.receive(event.data);
      if (event.data.type === "seek" || event.data.type === "play") {
        this.counter = 10;
        this.reduction.fill(0);
        this.masterReduction = 0;
        this.returnReduction.fill(0);
      }
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
    const [left, right] = outputs[0];
    const status = this.transport.render(left, right);
    for (let i = 0; i < this.stereo.length; i++) {
      this.stereo[i][0] = Math.max(this.stereo[i][0], status.stereo[i][0]);
      this.stereo[i][1] = Math.max(this.stereo[i][1], status.stereo[i][1]);
      this.reduction[i] = Math.max(this.reduction[i], status.reduction[i]);
    }
    this.master[0] = Math.max(this.master[0], status.masterStereo[0]);
    this.master[1] = Math.max(this.master[1], status.masterStereo[1]);
    this.masterReduction = Math.max(this.masterReduction, status.masterReduction);
    for (const slot of fxSlots) {
      const peak = this.returnStereo[slot];
      const current = status.returnStereo[slot];
      peak[0] = Math.max(peak[0], current[0]);
      peak[1] = Math.max(peak[1], current[1]);
      this.returnReduction[slot] = Math.max(this.returnReduction[slot], status.returnReduction[slot]);
    }
    if (++this.counter >= 10) {
      this.port.postMessage({ frame: status.frame, playing: status.playing, playRevision: status.playRevision, stereo: this.stereo, masterStereo: this.master,
        peaks: this.stereo.map(([l, r]) => Math.max(l, r)), master: Math.max(this.master[0], this.master[1]),
        reduction: this.reduction, masterReduction: this.masterReduction,
        returnStereo: this.returnStereo, returnReduction: this.returnReduction } satisfies Position);
      this.counter = 0;
      for (const pair of this.stereo) pair[0] = pair[1] = 0;
      for (const pair of this.returnStereo) pair[0] = pair[1] = 0;
      this.master[0] = this.master[1] = 0;
      this.reduction.fill(0);
      this.masterReduction = 0;
      this.returnReduction.fill(0);
    }
    return true;
  }
}

registerProcessor("stem-transport", StemProcessor);
