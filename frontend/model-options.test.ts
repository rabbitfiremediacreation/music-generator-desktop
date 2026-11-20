import { expect, it } from "vitest";
import title from "../models/title-model.json";
import { aceStepMemory, modelOptions, profile } from "./model-options";
import type { ModelCatalog, ModelSelection } from "./types";
import { catalogWithDiffRhythm2, catalogWithStableAudio } from "./react/models/model-fixtures";

function catalog(): ModelCatalog {
  const data = catalogWithDiffRhythm2();
  return { ...data, title_model: {...title.model,verified:false,present:false,partial_bytes:0}, recommended_profiles: [selection()], models: data.models.map(m => ({ ...m, present: false, verified: false, partial_bytes: 0 })), selection: selection(), hardware: { ram_bytes: 8 * 1024 ** 3, gpu: "CPU", vram_bytes: null, recommended_lm: "0.6B", vae_chunk: 256, platform: "macos", cpu_only: true }, free_bytes: 50 * 1024 ** 3 };
}
function selection(): ModelSelection { return { provider: "ace-step", synthesis: "acestep-v15-sft-Q8_0.gguf", language: "acestep-5Hz-lm-0.6B-Q8_0.gguf" }; }

it("filters the full profile by memory without hiding the current saved choice", () => {
  const c = catalog();
  const s = selection();
  const options = modelOptions(c, s, "synthesis", true);
  expect(options.length).toBeLessThan(52);
  expect(options.some(m => m.file === s.synthesis)).toBe(true);
  expect(options.some(m => m.file === "acestep-v15-xl-sft-BF16.gguf")).toBe(false);
  s.synthesis = "acestep-v15-xl-sft-BF16.gguf";
  expect(modelOptions(c, s, "synthesis", true).some(m => m.file === s.synthesis)).toBe(true);
  expect(profile(c, s).compatible).toBe(false);
  expect(modelOptions(c, s, "synthesis", false)).toHaveLength(52);
  expect(modelOptions(c, s, "language", false)).toHaveLength(8);
});

it("includes base dependencies, resumed bytes and verification in download readiness", () => {
  const c = catalog();
  const s = selection();
  const initial = profile(c, s);
  expect(initial.models).toHaveLength(4);
  initial.models[0].partial_bytes = 123;
  expect(profile(c, s).download).toBe(initial.download - 123);
  for (const m of initial.models) m.present = true;
  expect(profile(c, s).download).toBe(0);
  expect(profile(c, s).verified).toBe(false);
  for (const m of initial.models) m.verified = true;
  expect(profile(c, s).verified).toBe(true);
});

it("shows the pinned DiffRhythm files while keeping unavailable profiles and arbitrary paths inactive", () => {
  const c = catalog();
  const removed = { provider: "heartmula", synthesis: "heartmula-q8_0.gguf", language: "" };
  expect(profile(c, removed).valid).toBe(false);
  expect(modelOptions(c, removed, "synthesis", false)).toHaveLength(0);
  expect(profile(c, { ...selection(), synthesis: "../model.gguf" }).valid).toBe(false);
  const diffrhythm = c.profiles!.find(item => item.selection.provider === "diffrhythm2")!;
  expect(profile(c, diffrhythm.selection).models.map(model => model.file)).toEqual(diffrhythm.files);
  expect(profile(c, diffrhythm.selection).valid).toBe(false);
});

it("provides turbo's eight steps without changing the caller's selection", () => {
  const c = catalog();
  const s = Object.freeze({ ...selection(), synthesis: "acestep-v15-turbo-shift3-Q6_K.gguf" });
  expect(profile(c, s).steps).toBe(8);
  expect(profile(c, selection()).steps).toBe(80);
});

it("uses each native variant's RAM estimate independently of the platform threshold", () => {
  const c = catalogWithStableAudio();
  const gib = 1024 ** 3;
  c.hardware.ram_bytes = 16 * gib;
  const small = c.profiles!.find(p => p.selection.synthesis === "stable-audio-3-small-music-q8_0")!;
  const medium = c.profiles!.find(p => p.selection.synthesis === "stable-audio-3-medium-f16")!;
  expect(profile(c, small.selection).memory).toBe(7 * gib);
  expect(profile(c, medium.selection).memory).toBe(12 * gib);
  expect(profile(c, small.selection).compatible).toBe(false);
});

it("includes the current ACE-Step companion and dependencies when estimating an online variant", () => {
  const c = catalog();
  const selected = profile(c, selection());
  const weight = selected.models.find(model => model.role === "synthesis")!;
  expect(aceStepMemory(selected.models, { role: "synthesis", estimated_bytes: weight.estimated_bytes + 512 })).toBe(selected.memory + 512);
});

it("shows only recommended Standard/XL profiles and their automatic language model in simple mode", () => {
  const c = catalog();
  c.expert_mode = false;
  for (const compatibleOnly of [true, false]) {
    expect(modelOptions(c, selection(), "synthesis", compatibleOnly).map(m => m.file)).toEqual([selection().synthesis]);
    expect(modelOptions(c, selection(), "language", compatibleOnly).map(m => m.file)).toEqual([selection().language]);
  }
  const xl = { ...selection(), synthesis: "acestep-v15-xl-sft-Q8_0.gguf" };
  c.hardware.ram_bytes = 16 * 1024 ** 3;
  c.recommended_profiles.push(xl);
  expect(modelOptions(c, selection(), "synthesis", false).map(m => m.file)).toEqual([selection().synthesis, xl.synthesis]);
});

it("never exposes a saved advanced selection through the RAM-filter exception", () => {
  const c = catalog();
  c.expert_mode = false;
  const saved = Object.freeze({ ...selection(), synthesis: "acestep-v15-turbo-shift3-Q6_K.gguf" });
  for (const compatibleOnly of [true, false]) {
    expect(modelOptions(c, saved, "synthesis", compatibleOnly).some(m => m.file === saved.synthesis)).toBe(false);
  }
  expect(profile(c, saved).valid).toBe(true);
  expect(profile(c, saved).allowed).toBe(false);
  c.expert_mode = true;
  expect(profile(c, saved).allowed).toBe(true);
  expect(modelOptions(c, saved, "synthesis", false)).toHaveLength(52);
  c.expert_mode = false;
  expect(profile(c, saved).allowed).toBe(false);
  expect(saved.synthesis).toBe("acestep-v15-turbo-shift3-Q6_K.gguf");
});

it("shows the backend's device-adjusted recommendation without changing the model catalog default", () => {
  const c = catalog();
  const synthesis = c.models.find(m => m.file === selection().synthesis)!;
  synthesis.suggested_steps = 30;
  expect(profile(c, selection()).steps).toBe(30);
  expect(synthesis.recommended_steps).toBe(80);
});
