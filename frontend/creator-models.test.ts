import { expect, it } from "vitest";
import { creatorOptions, profileKey } from "./creator-models";
import type { ModelSelection } from "./types";
const standard: ModelSelection = { provider: "ace-step", synthesis: "acestep-v15-sft-Q8_0.gguf", language: "acestep-5Hz-lm-1.7B-Q8_0.gguf" };
const xl = { ...standard, synthesis: "acestep-v15-xl-sft-Q8_0.gguf" };

it("offers exactly the hardware recommendations as Standard/XL, even in Expert Mode", () => {
  for (const expert of [false, true]) {
    const options = creatorOptions([standard, xl], standard, expert);
    expect(options.map(option => option.label)).toEqual(["Standard", "XL"]);
    expect(options.every(option => !option.disabled)).toBe(true);
    expect(options[1].selection.language).toBe(standard.language);
  }
  expect(creatorOptions([standard], standard, false).map(option => option.label)).toEqual(["Standard"]);
});

it("retains restored advanced profiles without turning the Creator into the extended picker", () => {
  const turbo = Object.freeze({ ...standard, synthesis: "acestep-v15-turbo-Q8_0.gguf" });
  const off = creatorOptions([standard, xl], turbo, false);
  expect(off).toHaveLength(3);
  expect(off[0].selection).toEqual(turbo);
  expect(off[0].disabled).toBe(true);
  expect(off[0].label).toContain("turbo");
  expect(creatorOptions([standard, xl], turbo, true)[0].disabled).toBe(false);
  expect(turbo.synthesis).toBe("acestep-v15-turbo-Q8_0.gguf");
});

it("distinguishes a restored language override from the recommended profile", () => {
  const overridden = { ...standard, language: "acestep-5Hz-lm-4B-Q8_0.gguf" };
  const options = creatorOptions([standard], overridden, false);
  expect(options).toHaveLength(2);
  expect(profileKey(overridden)).not.toBe(profileKey(standard));
  expect(options[0].disabled).toBe(true);
  expect(options[1].disabled).toBe(false);
  expect(creatorOptions([], undefined, false)).toEqual([]);
});

it("keeps active Text2midi usable alongside ACE-Step recommendations in Simple Mode", () => {
  const midi = { provider: "text2midi", synthesis: "text2midi", language: "flan-t5-base" };
  const options = creatorOptions([standard, xl], midi, false);
  expect(options.map(option => [option.label, option.disabled])).toEqual([["Text2midi", false], ["Standard", false], ["XL", false]]);
});
