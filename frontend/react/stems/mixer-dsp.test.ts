import { expect, it } from "vitest";
import { defaultTrack, type ChannelFx } from "../../stems";
import parity from "./mixer-parity.json";
import { StemTransport } from "./transport-core";

const rate = 44100;

function configured(left: Float32Array, right: Float32Array, fx?: Partial<ChannelFx>, master = {}) {
  const graph = new StemTransport(rate, left.length, 1);
  graph.receive({ type: "audio", index: 0, pcm: { left, right } });
  const track = { ...defaultTrack("vocals"), fx };
  graph.receive({ type: "mix", mix: { tracks: [track], master_db: 0, first: 0, end: left.length, looping: false, ...master } });
  graph.receive({ type: "play", playing: true });
  const out = { left: new Float32Array(left.length), right: new Float32Array(left.length) };
  const position = graph.render(out.left, out.right);
  return { ...out, position };
}

function sine(frequency: number, amplitude = .25, length = 8192, cosine = false) {
  return Float32Array.from({ length }, (_, i) => amplitude * (cosine ? Math.cos : Math.sin)(i * 2 * Math.PI * frequency / rate));
}

function rms(values: Float32Array) {
  const tail = values.slice(values.length / 2);
  return Math.sqrt(tail.reduce((sum, sample) => sum + sample * sample, 0) / tail.length);
}

it("has a transparent neutral path and keeps identical mono sides at any width", () => {
  const source = sine(1000);
  expect(configured(source, source).left).toEqual(source);
  expect(configured(source, source, { width: 200 }).right).toEqual(source);
});

it.each([["low_db", 40], ["mid_db", 1000], ["high_db", 16000]] as const)("boosts the %s band's test tone", (parameter, frequency) => {
  const source = sine(frequency);
  expect(rms(configured(source, source, { [parameter]: 12 }).left) / rms(source)).toBeGreaterThan(3);
});

it("attenuates the opposite end of the spectrum for each filter direction and bypasses at the center", () => {
  const low = sine(40), high = sine(8000);
  expect(rms(configured(high, high, { filter: -100 }).left)).toBeLessThan(rms(high) / 100);
  expect(rms(configured(low, low, { filter: 100 }).left)).toBeLessThan(rms(low) / 100);
  expect(configured(high, low, { filter: 2 }).left).toEqual(high);
});

it("reduces sustained stereo dynamics and keeps the post-fader master at the limiter ceiling", () => {
  const l = new Float32Array(8192).fill(.8), r = new Float32Array(8192).fill(.4);
  const compressed = configured(l, r, { comp: 100 });
  expect(compressed.left.at(-1)!).toBeLessThan(.1);
  expect(compressed.left.at(-1)! / compressed.right.at(-1)!).toBeCloseTo(2);
  const limited = configured(l, r, undefined, { master_limit: 100, master_db: 6 });
  expect(limited.position.masterStereo[0]).toBeCloseTo(.89125094, 6);
  expect(limited.position.masterStereo[1]).toBeCloseTo(.44562547, 6);
});

it.each(["channel", "master"])("enforces the %s limiter ceiling on the first sample after enable", stage => {
  const frames = 1024;
  const graph = new StemTransport(rate, frames, 1);
  const track = defaultTrack("vocals");
  const mix = { tracks: [track], master_db: 0, first: 0, end: frames, looping: false };
  graph.receive({ type: "audio", index: 0, pcm: { left: new Float32Array(frames).fill(2), right: new Float32Array(frames).fill(1) } });
  graph.receive({ type: "mix", mix });
  graph.receive({ type: "play", playing: true });
  const l = new Float32Array(352), r = new Float32Array(352);
  graph.render(l, r);
  expect(l[0]).toBe(2);
  graph.receive({ type: "mix", mix: stage === "master" ? { ...mix, master_limit: 100 } : { ...mix, tracks: [{ ...track, fx: { limit: 100 } }] } });
  graph.render(l, r);
  expect(Math.max(...l)).toBeCloseTo(.89125094, 6);
  expect(l[0] / r[0]).toBeCloseTo(2);
  expect(l.at(-1)! / r.at(-1)!).toBeCloseTo(2);
});

it("applies mono only in the monitor path and reports a silent excluded channel after the gate", () => {
  const graph = new StemTransport(rate, 4, 2);
  for (const index of [0, 1]) graph.receive({ type: "audio", index, pcm: {
    left: new Float32Array(4).fill(.125), right: new Float32Array(4).fill(.5),
  } });
  graph.receive({ type: "mix", mix: {
    tracks: [{ ...defaultTrack("vocals"), solo: true }, defaultTrack("drums")],
    first: 0, end: 4, master_db: 0, looping: false,
  } });
  graph.receive({ type: "mono", mono: true });
  graph.receive({ type: "play", playing: true });
  const l = new Float32Array(4), r = new Float32Array(4);
  const position = graph.render(l, r);
  expect(l).toEqual(new Float32Array(4).fill(.3125));
  expect(l).toEqual(r);
  expect(position.stereo).toEqual([[.125, .5], [0, 0]]);
  expect(position.masterStereo).toEqual([.125, .5]);
});

it("matches the export conformance signal through all processing stages", () => {
  const l = sine(255, .62, 4096), r = sine(970, .48, 4096, true);
  const tracks = [{ ...defaultTrack("vocals"), pan: Math.fround(-.35), gain_db: 3,
    fx: { filter: -63, low_db: 8, mid_db: -5, high_db: 6, comp: 37, limit: 71, width: 145 } }];
  const output = configured(l, r, undefined, { tracks, master_db: 2, master_comp: 28, master_limit: 54 });
  for (const [frame, [left, right]] of Object.entries(parity)) {
    expect(output.left[Number(frame)]).toBeCloseTo(left, 6);
    expect(output.right[Number(frame)]).toBeCloseTo(right, 6);
  }
});
