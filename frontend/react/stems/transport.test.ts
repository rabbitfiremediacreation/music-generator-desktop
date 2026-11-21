import { describe, expect, it } from "vitest";
import { defaultTrack } from "../../stems";
import { readStereoWave, StemTransport } from "./transport-core";

function transport() {
  const graph = new StemTransport(44100, 8, 2);
  for (const [index, value] of [[-1, 0.5], [0, 0.125], [1, 0.25]]) {
    graph.receive({ type: "audio", index, pcm: { left: new Float32Array(8).fill(value), right: new Float32Array(8).fill(value * 2) } });
  }
  return { graph, capture: (length: number) => {
    const left = new Float32Array(length);
    const right = new Float32Array(length);
    const position = graph.render(left, right);
    return { left: Array.from(left), right: Array.from(right), ...position };
  } };
}

describe("stem clock", () => {
  it("uses one phase for start, pause, seek, looping and exclusive original comparison", () => {
    const { graph, capture } = transport();
    graph.receive({ type: "mix", mix: { tracks: [defaultTrack("vocals"), defaultTrack("drums")], master_db: 0, first: 1, end: 4, looping: true } });
    graph.receive({ type: "play", playing: true });
    expect(capture(5)).toMatchObject({ frame: 3, left: Array(5).fill(0.375), right: Array(5).fill(0.75) });
    graph.receive({ type: "play", playing: false });
    expect(capture(2)).toMatchObject({ frame: 3, left: [0, 0] });
    graph.receive({ type: "seek", frame: 2 });
    graph.receive({ type: "compare", original: true });
    graph.receive({ type: "play", playing: true });
    expect(capture(1)).toMatchObject({ frame: 3, left: [0.5], right: [1] });
    graph.receive({ type: "compare", original: false });
    const transition = capture(1);
    expect(transition.frame).toBe(4);
    expect(transition.left[0]).toBeLessThan(0.5);
    expect(transition.left[0]).toBeGreaterThan(0.375);
    expect(capture(512).left.at(-1)).toBe(0.375);
  });

  it("uses multi-solo, mute precedence and stereo balance", () => {
    const { graph, capture } = transport();
    graph.receive({ type: "mix", mix: { tracks: [
      { ...defaultTrack("vocals"), solo: true, pan: -1 },
      { ...defaultTrack("drums"), solo: true, mute: true },
    ], master_db: 0, first: 0, end: 8, looping: false } });
    graph.receive({ type: "play", playing: true });
    expect(capture(1)).toMatchObject({ left: [0.125], right: [0], master: 0.125 });
  });

  it("folds the sides before balance and silences a fader at minus infinity", () => {
    const { graph, capture } = transport();
    graph.receive({ type: "mix", mix: { tracks: [
      { ...defaultTrack("vocals"), pan: -1, fx: { width: 0 } },
      { ...defaultTrack("drums"), gain_off: true },
    ], master_db: 0, first: 0, end: 8, looping: false } });
    graph.receive({ type: "play", playing: true });
    expect(capture(1)).toMatchObject({ left: [0.1875], right: [0], master: 0.1875 });
  });
});

describe("stem media timebase", () => {
  it.each([false, true])("keeps fractional reads inside the region when original is %s", original => {
    const graph = new StemTransport(44100, 4, 1, 48000);
    const signal = new Float32Array([1, 0, 0, 1]);
    const pcm = { left: signal, right: signal };
    graph.receive({ type: "audio", index: -1, pcm });
    graph.receive({ type: "audio", index: 0, pcm });
    graph.receive({ type: "mix", mix: { tracks: [defaultTrack("vocals")], master_db: 0, first: 1, end: 3, looping: true } });
    graph.receive({ type: "compare", original });
    graph.receive({ type: "play", playing: true });
    const left = new Float32Array(10), right = new Float32Array(10);
    graph.render(left, right);
    expect(left).toEqual(new Float32Array(10));
    expect(right).toEqual(left);
  });

  it("duplicates a short mono float WAV and plays silence after the source ends", () => {
    const bytes = new ArrayBuffer(52);
    const wave = new DataView(bytes);
    wave.setUint32(0, 0x52494646); wave.setUint32(4, 44, true); wave.setUint32(8, 0x57415645);
    wave.setUint32(12, 0x666d7420); wave.setUint32(16, 16, true); wave.setUint16(20, 3, true); wave.setUint16(22, 1, true);
    wave.setUint32(24, 44100, true); wave.setUint32(28, 176400, true); wave.setUint16(32, 4, true); wave.setUint16(34, 32, true);
    wave.setUint32(36, 0x64617461); wave.setUint32(40, 8, true); wave.setFloat32(44, .25, true); wave.setFloat32(48, -.5, true);
    const pcm = readStereoWave(bytes, 4, 44100);
    const graph = new StemTransport(44100, 4, 1);
    graph.receive({ type: "audio", index: 0, pcm });
    graph.receive({ type: "play", playing: true });
    const left = new Float32Array(4), right = new Float32Array(4);
    graph.render(left, right);
    expect(left).toEqual(new Float32Array([.25, -.5, 0, 0]));
    expect(right).toEqual(left);
  });

  it("does not shift the original or any stem at a loop boundary", () => {
    const graph = new StemTransport(44100, 6, 1);
    graph.receive({ type: "audio", index: 0, pcm: {
      left: new Float32Array([0, 0.05, 0.125, 0.25, 0.5, 0.85]),
      right: new Float32Array([0, 0.05, 0.25, 0.5, 0.75, 0.85]),
    } });
    graph.receive({ type: "mix", mix: { tracks: [defaultTrack("piano")], master_db: 0, first: 2, end: 5, looping: true } });
    graph.receive({ type: "seek", frame: 3 });
    graph.receive({ type: "play", playing: true });
    const left = new Float32Array(4);
    const right = new Float32Array(4);
    const clock = graph.render(left, right);
    expect(Array.from(left)).toEqual([0.25, 0.5, 0.125, 0.25]);
    expect(Array.from(right)).toEqual([0.5, 0.75, 0.25, 0.5]);
    expect(clock.frame).toBe(4);
  });
});
