import { expect, it } from "vitest";
import { defaultFxReturns, fxSlots, mapFxSlots, type FxReturn, type FxSlot } from "../../stem-returns";
import { defaultTrack, type StemMix } from "../../stems";
import parity from "./mixer-returns-parity.json";
import { StemTransport } from "./transport-core";

const rate = 44100;
const frames = 34000;
const impulse = (value: number) => {
  const input = new Float32Array(frames);
  input[0] = value;
  return input;
};

function renderReturn(slot: FxSlot, settings?: Partial<FxReturn>, other?: FxSlot, soloTrack = false) {
  const graph = new StemTransport(rate, frames, 1);
  const mix: StemMix = {
    first: 0, end: frames, looping: false, master_db: 0,
    tracks: [{
      ...defaultTrack("vocals"), gain_db: -6, solo: soloTrack, sends: mapFxSlots(index => index === slot || index === other ? 60 : 0),
    }],
    fx_returns: mapFxSlots(index => ({ ...defaultFxReturns[index], level: 50, ...(index === slot ? settings : undefined) })),
  };
  graph.receive({ type: "audio", index: 0, pcm: { left: impulse(.5), right: impulse(.25) } });
  graph.receive({ type: "mix", mix });
  graph.receive({ type: "play", playing: true });
  const left = new Float32Array(frames), right = new Float32Array(frames);
  const position = graph.render(left, right);
  return { left, right, position };
}

it.each(fxSlots)("matches the stereo export for return %i at a reduced send, fader and return level", slot => {
  const { left, right } = renderReturn(slot);
  expect(left[0]).toBeCloseTo(.5 * 10 ** (-6 / 20), 6);
  for (const [frame, l, r] of parity.legacy[slot]) {
    expect(left[frame]).toBeCloseTo(l, 6);
    expect(right[frame]).toBeCloseTo(r, 6);
  }
});

it("mutes and powers off individual returns and isolates wet solos while preserving sends", () => {
  const plain = renderReturn(1, undefined, 2).left;
  const echo = 15876, slap = 4410;
  expect(plain[echo]).toBeGreaterThan(.03);
  expect(plain[slap]).toBeGreaterThan(.03);

  const muted = renderReturn(1, { mute: true }, 2);
  expect(muted.position.returnStereo[1]).toEqual([0, 0]);
  expect(muted.left[echo]).toBe(0);
  expect(muted.left[slap]).toBe(plain[slap]);

  const off = renderReturn(1, { enabled: false, solo: true }, 2).left;
  expect(off[0]).toBe(plain[0]);
  expect(off[echo]).toBe(0);
  expect(off[slap]).toBe(plain[slap]);

  const solo = renderReturn(1, { solo: true }, 2).left;
  expect(solo[0]).toBe(0);
  expect(solo[slap]).toBe(0);
  expect(solo[echo]).toBe(plain[echo]);
  expect(renderReturn(1, { solo: true }, 2, true).left[0]).toBe(plain[0]);
});

it("meters the wet signal after the dedicated return channel strip", () => {
  const { settings, samples } = parity.processed;
  const { left, right, position } = renderReturn(1, settings);
  expect(position.returnStereo[1][0]).toBeCloseTo(Math.max(...left.slice(1).map(Math.abs)), 6);
  expect(position.returnStereo[1][1]).toBeCloseTo(Math.max(...right.slice(1).map(Math.abs)), 6);
  expect(position.returnReduction[1]).toBeGreaterThan(3);
  expect(position.returnStereo[0]).toEqual([0, 0]);
  for (const [frame, l, r] of samples) {
    expect(left[frame]).toBeCloseTo(l, 6);
    expect(right[frame]).toBeCloseTo(r, 6);
  }
});
