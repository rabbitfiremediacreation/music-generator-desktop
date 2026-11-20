import { expect, it } from "vitest";
import title from "../models/title-model.json";
import { modelOptions, profile } from "./model-options";
import type { ModelCatalog, ModelSelection } from "./types";
import { catalogWithNativeProfiles } from "./react/models/model-fixtures";

function catalog(): ModelCatalog {
  const data = catalogWithNativeProfiles();
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

it.each(["yue2", "heartmula"])("shows the pinned %s files but rejects arbitrary model paths and unavailable profiles", provider => {
  const c = catalog();
  const removed = { provider: "heartmula", synthesis: "heartmula-q8_0.gguf", language: "" };
  expect(profile(c, removed).valid).toBe(false);
  expect(modelOptions(c, removed, "synthesis", false)).toHaveLength(0);
  expect(profile(c, { ...selection(), synthesis: "../model.gguf" }).valid).toBe(false);
  const nativeProfile = c.profiles!.find(item => item.selection.provider === provider)!;
  expect(profile(c, nativeProfile.selection).models.map(model => model.file)).toEqual(nativeProfile.files);
  expect(profile(c, nativeProfile.selection).valid).toBe(false);
});

it("provides turbo's eight steps without changing the caller's selection", () => {
  const c = catalog();
  const s = Object.freeze({ ...selection(), synthesis: "acestep-v15-turbo-shift3-Q6_K.gguf" });
  expect(profile(c, s).steps).toBe(8);
  expect(profile(c, selection()).steps).toBe(80);
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
