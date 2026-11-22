import { expect, it } from "vitest";
import { stereoEnvelope } from "./stereo-envelope";

it("keeps signed peaks for each stereo side and pads a short asset on the shared timeline", () => {
  const envelope = stereoEnvelope({
    left: new Float32Array([-.75, .25, .5]),
    right: new Float32Array([.125, .375, -.25]),
  }, 6, 3);
  expect([...envelope.left]).toEqual([-.75, .25, 0, .5, 0, 0]);
  expect([...envelope.right]).toEqual([.125, .375, -.25, 0, 0, 0]);
  expect(envelope.peak).toBe(.75);
});
