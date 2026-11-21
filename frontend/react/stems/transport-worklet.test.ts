import { afterEach, expect, it, vi } from "vitest";
import type { WorkletCommand, WorkletReport } from "./transport-core";

afterEach(() => vi.unstubAllGlobals());

it("reports the natural end immediately when the graph is frozen between meter updates", async () => {
  const report = vi.fn<(status: WorkletReport) => void>();
  class AudioProcessor {
    port = { postMessage: report, onmessage: (_event: { data: WorkletCommand }) => {} };
  }
  type Processor = new (options: { processorOptions: { rate: number; frames: number; tracks: number } }) => AudioProcessor & {
    process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean;
  };
  let Processor!: Processor;
  vi.stubGlobal("sampleRate", 44100);
  vi.stubGlobal("AudioWorkletProcessor", AudioProcessor);
  vi.stubGlobal("registerProcessor", (_name: string, actual: Processor) => { Processor = actual; });
  await import("./transport-worklet");

  const processor = new Processor({ processorOptions: { rate: 44100, frames: 128, tracks: 1 } });
  const samples = new Float32Array(128).fill(.25);
  processor.port.onmessage({ data: { type: "audio", index: 0, pcm: { left: samples, right: samples } } });
  processor.port.onmessage({ data: { type: "play", playing: true, revision: 3 } });
  const left = new Float32Array(128), right = new Float32Array(128);
  processor.process([], [[left, right]]);
  expect(left).toEqual(samples);
  expect(report).toHaveBeenCalledTimes(1);

  processor.port.onmessage({ data: { type: "freeze" } });
  expect(report).toHaveBeenLastCalledWith({ type: "frozen", position: { frame: 128, playing: false, playRevision: 3 } });
  processor.process([], [[left, right]]);
  expect(left).toEqual(new Float32Array(128));
  expect(right).toEqual(left);
});
