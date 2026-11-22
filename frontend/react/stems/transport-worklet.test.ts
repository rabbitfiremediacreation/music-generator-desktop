import { afterEach, expect, it, vi } from "vitest";
import { defaultFxReturns, mapFxSlots } from "../../stem-returns";
import { defaultTrack } from "../../stems";
import type { Position, WorkletCommand, WorkletReport } from "./transport-core";

afterEach(() => vi.unstubAllGlobals());

async function createProcessor(frames: number, report: (status: WorkletReport) => void) {
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
  vi.resetModules();
  await import("./transport-worklet");
  return new Processor({ processorOptions: { rate: 44100, frames, tracks: 1 } });
}

it("reports the natural end immediately when the graph is frozen between meter updates", async () => {
  const report = vi.fn<(status: WorkletReport) => void>();
  const processor = await createProcessor(128, report);
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

it("reports return peaks and compression even when they occur between meter updates", async () => {
  const frames = 2048;
  const reports: Position[] = [];
  const processor = await createProcessor(frames, report => {
    if (!("type" in report)) reports.push(structuredClone(report));
  });
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  left[0] = .5;
  right[0] = .125;
  processor.port.onmessage({ data: { type: "audio", index: 0, pcm: { left, right } } });
  processor.port.onmessage({ data: { type: "mix", mix: {
    tracks: [{ ...defaultTrack("vocals"), sends: [0, 100, 0, 0] }], first: 0, end: frames, looping: false, master_db: 0,
    fx_returns: mapFxSlots(slot => slot === 1 ? {
      effect: { kind: "delay", time_ms: 10, feedback: 0, damping_hz: 8000 }, level: 100,
      fx: { dynamics: { mix: 100, attack_ms: .1, threshold_db: -36, ratio: 4 } },
    } : defaultFxReturns[slot]),
  } } });
  processor.port.onmessage({ data: { type: "play", playing: true } });
  const output = [new Float32Array(128), new Float32Array(128)];
  for (let block = 0; block < 11; block++) processor.process([], [output]);
  expect(reports).toHaveLength(2);
  expect(reports[0].returnStereo[1]).toEqual([0, 0]);
  expect(reports[1].returnStereo[1][0]).toBeGreaterThan(.1);
  expect(reports[1].returnStereo[1][1]).toBeCloseTo(reports[1].returnStereo[1][0] / 4, 6);
  expect(reports[1].returnReduction[1]).toBeGreaterThan(0);
});
