import { expect, it } from "vitest";
import type { Song } from "../../types";
import { analyzedValues, INITIAL_VALUES, songValues } from "./form-state";

it.each([
  [-10, 0], [0, 0], [30, 0], [50, 0], [50.4, 0], [50.5, 51], [123.7, 124], [200.4, 200], [250, 200], ["90.8", 91],
])("maps analyzed tempo %s to the integer backend domain %s", (bpm, expected) => {
  expect(analyzedValues({ ...INITIAL_VALUES, bpm: 120 }, { bpm }, false).bpm).toBe(expected);
});
it.each([undefined, null, "", "n/a", NaN, Infinity, -Infinity])("preserves the chosen tempo when analysis gives %s", bpm => {
  expect(analyzedValues({ ...INITIAL_VALUES, bpm: 120 }, { bpm }, false).bpm).toBe(120);
});
it("keeps the microphone description ahead of an engine prompt", () => {
  expect(analyzedValues(INITIAL_VALUES, { caption: "Follow my hummed melody", prompt: "engine prompt" }, true).prompt).toBe("Follow my hummed melody");
});

it("restores MiniMax's canonical caption when it was supplied without a prompt field", () => {
  const caption = "Global Metadata: folk\nVocal Details: warm\nArrangement: strings";
  const params = { model_selection: { provider: "minimax-music3", synthesis: "q4-0-q8-0-q4-0", language: "" }, caption, prompt: "" };
  const song = { params, caption, title: null, seed: 41 } as Song;
  expect(songValues(song, null)).toMatchObject({ prompt: caption, style: "" });
  const authored = { ...song, params: { ...params, style: "folk", prompt: "An open road" } };
  expect(songValues(authored, null)).toMatchObject({ prompt: "An open road", style: "folk" });
});
