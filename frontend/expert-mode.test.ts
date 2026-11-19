import { expect, it } from "vitest";
import { modelAllowed, modelErrorText, modelLabel, settingsChanges } from "./expert-mode";
import type { ModelSelection, Settings } from "./types";

const selection: ModelSelection = { provider: "ace-step", synthesis: "acestep-v15-sft-Q8_0.gguf", language: "acestep-5Hz-lm-0.6B-Q8_0.gguf" };

it("allows only backend ACE-Step recommendations without Expert Mode, including language size", () => {
  expect(modelAllowed(selection, false, [selection])).toBe(true);
  for (const changed of [
    { ...selection, synthesis: "acestep-v15-turbo-Q8_0.gguf" },
    { ...selection, synthesis: "acestep-v15-sft-Q6_K.gguf" },
    { ...selection, language: "acestep-5Hz-lm-4B-Q8_0.gguf" },
  ]) {
    expect(modelAllowed(changed, false, [selection])).toBe(false);
    expect(modelAllowed(changed, true, [selection])).toBe(true);
  }
  expect(modelAllowed(selection, false, [])).toBe(false);
});

it("allows the exact Text2midi selection in Simple Mode", () => {
  const midi = { provider: "text2midi", synthesis: "text2midi", language: "flan-t5-base" };
  expect(modelAllowed(midi, false, [selection])).toBe(true);
  expect(modelAllowed({ ...midi, language: "another-encoder" }, false, [selection])).toBe(false);
});

it("uses simple labels while the expert view retains family and precision", () => {
  expect(modelLabel(selection.synthesis, false)).toBe("Standard");
  expect(modelLabel("acestep-v15-xl-sft-Q8_0.gguf", false)).toBe("XL");
  expect(modelLabel(selection.language, false)).toBe("0.6B");
  expect(modelLabel(selection.synthesis, true)).toBe("sft-Q8_0");
});

it("sends only actual settings edits and preserves explicit false", () => {
  const before = { expert_mode: true, timeout_minutes: 30, songs_dir: "/songs", lm_device: "auto", export_format: "wav" } as Settings;
  expect(settingsChanges(before, { expert_mode: false, timeout_minutes: 30, songs_dir: "/songs" })).toEqual({ expert_mode: false });
  expect(settingsChanges(before, { expert_mode: true, timeout_minutes: 30 })).toEqual({});
  expect(settingsChanges(before, { expert_mode: false, timeout_minutes: 45 })).toEqual({ expert_mode: false, timeout_minutes: 45 });
  expect(before.expert_mode).toBe(true);
});

it("localizes the admission error while preserving unrelated failures", () => {
  const t = (key: string) => `translated:${key}`;
  expect(modelErrorText(new Error("expert_mode_required"), t)).toBe("translated:expert_mode_required");
  expect(modelErrorText(new Error("model_setup_required"), t)).toBe("translated:model_setup_required");
  expect(modelErrorText("expert_mode_required", t)).toBe("translated:expert_mode_required");
  expect(modelErrorText(new Error("Disk full"), t)).toBe("Disk full");
});
