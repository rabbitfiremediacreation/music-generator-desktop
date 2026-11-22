import { expect, it } from "vitest";
import { defaultTrack, type ChannelFx } from "../../stems";
import parity from "./mixer-parity.json";
import liveEqParity from "./mixer-live-eq-parity.json";
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

it("adds, edits, and bypasses the dynamic EQ while the playback clock keeps advancing", () => {
  const block = 8192;
  const frames = 6 * block;
  const left = sine(700, .6, frames), right = sine(6500, .48, frames);
  const band = { frequency_hz: 700, q: 2, threshold_db: -38, reduction_db: 9 };
  const track = defaultTrack("vocals");
  const mix = { tracks: [track], master_db: 0, first: 0, end: frames, looping: false };
  const graph = new StemTransport(rate, frames, 1);
  graph.receive({ type: "audio", index: 0, pcm: { left, right } });
  graph.receive({ type: "mix", mix });
  graph.receive({ type: "play", playing: true, revision: 17 });
  let position = 0;
  function step() {
    const l = new Float32Array(block), r = new Float32Array(block);
    const state = graph.render(l, r);
    const ratio = [rms(l) / rms(left.slice(position, position + block)), rms(r) / rms(right.slice(position, position + block))];
    position += block;
    expect(state).toMatchObject({ frame: position, playing: true, playRevision: 17 });
    return ratio;
  }
  expect(step()).toEqual([1, 1]);
  const set = (bands: typeof band[], bypass = false) => graph.receive({
    type: "mix", mix: { ...mix, tracks: [{ ...track, dynamic_eq: { bands, bypass } }] },
  });
  set([band, { ...band, frequency_hz: 6500 }]);
  const filtered = step();
  expect(filtered[0]).toBeLessThan(.43);
  expect(filtered[1]).toBeLessThan(.43);
  set([{ ...band, reduction_db: 3 }, { ...band, frequency_hz: 6500 }]);
  const adjusted = step();
  expect(adjusted[0]).toBeGreaterThan(.68);
  expect(adjusted[1]).toBeLessThan(.43);
  set([band, { ...band, frequency_hz: 6500 }], true);
  const dry = step();
  expect(dry[0]).toBeCloseTo(1, 5);
  expect(dry[1]).toBeCloseTo(1, 5);
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

it("uses the compressor controls and reports actual gain reduction for the track and master", () => {
  const l = new Float32Array(8192).fill(.8);
  const fast = configured(l, l, { comp: 100, dynamics: { attack_ms: 1, knee_db: 0 } });
  const slow = configured(l, l, { comp: 100, dynamics: { attack_ms: 100, knee_db: 0 } });
  expect(fast.left[512]).toBeLessThan(slow.left[512]);
  expect(fast.position.reduction[0]).toBeCloseTo(-20 * Math.log10(fast.left.at(-1)! / l[0]), 4);
  const nearThreshold = new Float32Array(8192).fill(.12);
  expect(configured(nearThreshold, nearThreshold, { comp: 50, dynamics: { knee_db: 0 } }).position.reduction[0]).toBe(0);
  expect(configured(nearThreshold, nearThreshold, { comp: 50, dynamics: { knee_db: 12 } }).position.reduction[0]).toBeGreaterThan(.9);
  const pulse = l.slice();
  pulse.fill(.02, 4096);
  const release = (release_ms: number) => configured(pulse, pulse, { comp: 100, dynamics: { release_ms } }).left.at(-1)!;
  expect(release(10)).toBeGreaterThan(release(500) * 5);
  const makeup = configured(l, l, { dynamics: { makeup_db: 6 } }, { master_dynamics: { limiter: true } });
  expect(makeup.position.stereo[0][0]).toBeCloseTo(.8 * 10 ** (6 / 20));
  expect(makeup.position.reduction[0]).toBe(0);
  expect(makeup.position.masterStereo[0]).toBeCloseTo(10 ** (-1 / 20));
  expect(makeup.position.masterReduction).toBeCloseTo(20 * Math.log10(.8) + 7);
  expect(configured(l, l, { limit: 100, dynamics: { limiter: false } }).left).toEqual(l);
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

it("blends the ratio curve and applies hard clipping to a saved LIMIT setting", () => {
  const input = new Float32Array(4096).fill(.8);
  const settings = { threshold_db: -12, ratio: 2, attack_ms: .1, knee_db: 0 };
  const wet = Math.sqrt(input[0] * 10 ** (-12 / 20));
  const parallel = configured(input, input, { dynamics: { ...settings, mix: 50 } });
  expect(parallel.left.at(-1)).toBeCloseTo((input[0] + wet) / 2, 6);
  expect(parallel.position.reduction[0]).toBeCloseTo(-20 * Math.log10(parallel.left.at(-1)! / input[0]), 5);
  const savedLimit = configured(input, input, { dynamics: { ...settings, mix: 0, limit_ratio: true } });
  expect(savedLimit.left[0]).toBeCloseTo(10 ** (-12 / 20), 6);
  const bypassed = configured(input, input, { dynamics: { ...settings, mix: 0, limit_ratio: true, brickwall: false } });
  expect(bypassed.left).toEqual(input);
});

it.each(["channel", "master"])("hard clips each %s side immediately at the selected threshold", stage => {
  const left = new Float32Array([.8, -.8, .1, -.1]);
  const right = new Float32Array([.2, -.5, .05, -.05]);
  const dynamics = { mix: 0, threshold_db: -12, brickwall: true, attack_ms: 200, release_ms: 1000, makeup_db: 6 };
  const limited = stage === "channel"
    ? configured(left, right, { dynamics })
    : configured(left, right, undefined, { master_dynamics: dynamics });
  const ceiling = Math.fround(10 ** (-12 / 20));
  expect(limited.left).toEqual(new Float32Array([ceiling, -ceiling, .1, -.1]));
  expect(limited.right).toEqual(new Float32Array([.2, -ceiling, .05, -.05]));
  const reduction = stage === "channel" ? limited.position.reduction[0] : limited.position.masterReduction;
  expect(reduction).toBeCloseTo(20 * Math.log10(left[0]) + 12);
});

it("releases a short optical hit faster than a sustained signal", () => {
  const settings = { mix: 100, threshold_db: -18, ratio: 4, attack_ms: 10, release_ms: 120, knee_db: 0 };
  const probe = .08;
  const release = (pressMs: number, optical: boolean) => {
    const press = Math.round(rate * pressMs / 1000);
    const input = new Float32Array(press + Math.round(rate * .4)).fill(probe);
    input.fill(.8, 0, press);
    return configured(input, input, { dynamics: { ...settings, optical } }).left.at(-1)!;
  };
  expect(release(1000, true)).toBeLessThan(probe * .75);
  expect(release(30, true)).toBeGreaterThan(probe * .9);
  expect(release(1000, false)).toBeGreaterThan(probe * .9);
});

it("shapes transients with FET microsecond attack and the selected FET ratio", () => {
  const input = new Float32Array(1024).fill(.8);
  const settings = { mix: 100, threshold_db: -12, ratio: 2, knee_db: 0 };
  const standard = configured(input, input, { dynamics: settings });
  const fast = configured(input, input, { dynamics: { ...settings, mode: "fet", fet_attack_us: 20, fet_ratio: 8 } });
  const slow = configured(input, input, { dynamics: { ...settings, mode: "fet", fet_attack_us: 800, fet_ratio: 8 } });
  expect(fast.left[0]).toBeLessThan(slow.left[0] * .6);
  expect(slow.left[4]).toBeLessThan(standard.left[4]);
  const reduction = (1 / 8 - 1) * (20 * Math.log10(input[0]) + 12);
  expect(slow.left.at(-1)).toBeCloseTo(input[0] * 10 ** (reduction / 20), 6);
  expect(slow.position.reduction[0]).toBeCloseTo(-reduction, 4);
  const pulse = new Float32Array(4096).fill(.08);
  pulse.set(input);
  const release = (fet_release_ms: number) =>
    configured(pulse, pulse, { dynamics: { ...settings, mode: "fet", fet_ratio: 8, fet_release_ms } }).left.at(-1)!;
  expect(release(50)).toBeGreaterThan(release(1100) * 1.5);
  const sustained = new Float32Array(rate + pulse.length - input.length).fill(.08);
  sustained.fill(.8, 0, rate);
  const fet = { dynamics: { ...settings, mode: "fet" as const, fet_ratio: 8 } };
  expect(configured(sustained, sustained, fet).left.at(-1)!).toBeLessThan(configured(pulse, pulse, fet).left.at(-1)! * .94);
});

it("applies the selected VCA timing and ratio independently of the standard settings", () => {
  const input = new Float32Array(8192).fill(.8);
  const settings = { mode: "vca" as const, mix: 100, threshold_db: -12, ratio: 2, vca_ratio: 4, knee_db: 0 };
  const fast = configured(input, input, { dynamics: { ...settings, vca_attack_ms: .1 } });
  const slow = configured(input, input, { dynamics: { ...settings, vca_attack_ms: 30 } });
  expect(fast.left[30]).toBeLessThan(slow.left[30] * .6);
  const gain = (1 / 4 - 1) * (20 * Math.log10(input[0]) + 12);
  expect(fast.left.at(-1)).toBeCloseTo(input[0] * 10 ** (gain / 20), 6);
  const pulse = new Float32Array(rate + Math.round(rate * .15)).fill(.08);
  pulse.fill(.8, 0, rate);
  const recovery = (vca_release_ms: number) =>
    configured(pulse, pulse, { dynamics: { ...settings, vca_release_ms } }).left.at(-1)!;
  expect(recovery(0)).toBeLessThan(recovery(100) * .85);
});

it("links automatic makeup to the threshold and ratio without changing gain reduction", () => {
  const input = new Float32Array(8192).fill(.8);
  const settings = { mix: 100, threshold_db: -12, ratio: 4, attack_ms: .1, knee_db: 0, makeup_db: -6 };
  const manual = configured(input, input, { dynamics: { ...settings, makeup_db: 0 } });
  const automatic = configured(input, input, { dynamics: { ...settings, auto_gain: true } });
  expect(automatic.left.at(-1)).toBeCloseTo(manual.left.at(-1)! * 10 ** (4.5 / 20), 6);
  expect(automatic.position.reduction[0]).toBeCloseTo(manual.position.reduction[0], 6);
  const limited = configured(input, input, { dynamics: { ...settings, auto_gain: true, brickwall: true } });
  expect(limited.left.at(-1)).toBeCloseTo(10 ** (-12 / 20), 6);
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

it("matches the exported dynamic EQ response on both stereo channels", () => {
  const left = sine(700, .6, 4096), right = sine(6500, .48, 4096, true);
  const track = { ...defaultTrack("vocals"), dynamic_eq: liveEqParity.settings };
  const output = configured(left, right, undefined, { tracks: [track] });
  for (const [frame, [l, r]] of Object.entries(liveEqParity.samples)) {
    expect(output.left[Number(frame)]).toBeCloseTo(l, 6);
    expect(output.right[Number(frame)]).toBeCloseTo(r, 6);
  }
});

it("matches the exported de-esser response on both stereo channels", () => {
  const left = sine(700, .6, 4096), right = sine(6500, .48, 4096, true);
  const { amount, samples } = liveEqParity.de_ess;
  const output = configured(left, right, { de_ess: amount });
  for (const [frame, [l, r]] of Object.entries(samples)) {
    expect(output.left[Number(frame)]).toBeCloseTo(l, 6);
    expect(output.right[Number(frame)]).toBeCloseTo(r, 6);
  }
});

it("turns up and bypasses the de-esser on a playing channel without restarting it", () => {
  const block = 8192, frames = block * 6;
  const left = sine(350, .4, frames), right = sine(6500, .45, frames);
  const track = defaultTrack("vocals");
  const mix = { tracks: [track], master_db: 0, first: 0, end: frames, looping: false };
  const graph = new StemTransport(rate, frames, 1);
  graph.receive({ type: "audio", index: 0, pcm: { left, right } });
  graph.receive({ type: "mix", mix });
  graph.receive({ type: "play", playing: true, revision: 7 });
  let offset = 0;
  for (const [amount, expected] of [[0, 1], [50, .501], [100, .251], [0, 1]]) {
    graph.receive({ type: "mix", mix: { ...mix, tracks: [{ ...track, fx: { de_ess: amount } }] } });
    const l = new Float32Array(block), r = new Float32Array(block);
    expect(graph.render(l, r)).toMatchObject({ frame: offset + block, playing: true, playRevision: 7 });
    expect(rms(r) / rms(right.slice(offset, offset + block))).toBeCloseTo(expected, 2);
    expect(rms(l) / rms(left.slice(offset, offset + block))).toBeCloseTo(1, 2);
    offset += block;
  }
});
