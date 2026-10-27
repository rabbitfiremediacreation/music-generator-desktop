// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mountStudio } from "./dom-fixture";
import type { GenerationFormPreferences } from "./types";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), generationFormPreferences: vi.fn(), saveGenerationFormPreferences: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, convertFileSrc: (path: string) => path }));
import { createFormPreferences, createPreferenceWriter, DEFAULT_FORM_PREFERENCES } from "./form-preferences";
import { I18N, LANGS } from "./i18n.js";
import { formPreferenceTranslations } from "./form-preferences-i18n";

const custom: GenerationFormPreferences = { duration: 315, bpm: 123, inference_steps: 42, lm_temperature: 0.65, variants: 7 };
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const form = () => document.querySelector<HTMLFormElement>("#genForm")!;
const field = (name: string) => form().elements.namedItem(name) as HTMLInputElement;
const error = () => document.querySelector<HTMLElement>("#genPreferencesError")!;
beforeEach(() => {
  vi.resetAllMocks(); mountStudio();
  mocks.generationFormPreferences.mockResolvedValue({ ...custom });
  mocks.saveGenerationFormPreferences.mockResolvedValue(undefined);
  mocks.invoke.mockImplementation(async (command: string, args?: { values: GenerationFormPreferences }) => {
    if (command === "get_generation_form_preferences") return mocks.generationFormPreferences();
    if (command === "save_generation_form_preferences") return mocks.saveGenerationFormPreferences(args!.values);
    throw new Error(`Unexpected command: ${command}`);
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

it("restores exactly five values, refreshes their presentation and never saves merely on load", async () => {
  const refresh = vi.fn();
  field("title").value = "An unfinished idea";
  const controller = createFormPreferences(form(), refresh);
  await controller.ready;
  for (const [name, value] of Object.entries(custom)) expect(field(name).value).toBe(String(value));
  expect(field("title").value).toBe("An unfinished idea");
  expect(refresh).toHaveBeenCalledOnce();
  await controller.flush();
  expect(mocks.saveGenerationFormPreferences).not.toHaveBeenCalled();
});

it("saves slider edits without generation and encodes BPM Auto as zero", async () => {
  const controller = createFormPreferences(form(), vi.fn()); await controller.ready;
  field("bpm").value = "50"; field("bpm").dispatchEvent(new Event("input", { bubbles: true }));
  field("variants").value = "9"; field("variants").dispatchEvent(new Event("change", { bubbles: true }));
  field("prompt").value = "secret text"; field("prompt").dispatchEvent(new Event("input", { bubbles: true }));
  await controller.flush();
  expect(mocks.saveGenerationFormPreferences).toHaveBeenLastCalledWith({ ...custom, bpm: 0, variants: 9 });
  expect(Object.keys(mocks.saveGenerationFormPreferences.mock.lastCall![0]).sort()).toEqual(Object.keys(custom).sort());
});

it("captures programmatic values and resets only the five controls durably", async () => {
  const refresh = vi.fn(); const controller = createFormPreferences(form(), refresh); await controller.ready;
  field("duration").value = "600"; field("inference_steps").value = "8";
  controller.capture(); await controller.flush();
  expect(mocks.saveGenerationFormPreferences).toHaveBeenLastCalledWith({ ...custom, duration: 600, inference_steps: 8 });
  for (const name of ["title", "prompt", "style", "lyrics", "seed"]) field(name).value = name === "seed" ? "42" : "keep me";
  document.querySelector<HTMLButtonElement>("#resetGenPreferences")!.click(); await controller.flush();
  expect(mocks.saveGenerationFormPreferences).toHaveBeenLastCalledWith(DEFAULT_FORM_PREFERENCES);
  expect(field("bpm").value).toBe("50");
  for (const name of ["title", "prompt", "style", "lyrics"]) expect(field(name).value).toBe("keep me");
  expect(field("seed").value).toBe("42");
  expect(refresh).toHaveBeenCalledTimes(2);
});

it("serializes writes, coalesces bursts and flushes the newest in-flight snapshot", async () => {
  let finish!: () => void;
  const save = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; })).mockResolvedValue(undefined);
  const writer = createPreferenceWriter(save, vi.fn());
  writer.queue(custom); await settle();
  for (let variants = 1; variants <= 10; variants++) writer.queue({ ...custom, variants });
  const closing = writer.flush(); let closed = false; void closing.then(() => { closed = true; });
  expect(save).toHaveBeenCalledTimes(1); expect(closed).toBe(false);
  finish(); await closing;
  expect(save).toHaveBeenCalledTimes(2); expect(save).toHaveBeenLastCalledWith({ ...custom, variants: 10 });
});

it("shows save failures and retries on the next change and on close", async () => {
  const controller = createFormPreferences(form(), vi.fn()); await controller.ready;
  mocks.saveGenerationFormPreferences.mockRejectedValue(new Error("Disk full"));
  field("duration").value = "600"; field("duration").dispatchEvent(new Event("input", { bubbles: true })); await settle();
  expect(error().hidden).toBe(false); expect(error().textContent).not.toBe("form_preferences_error");
  field("variants").value = "4"; field("variants").dispatchEvent(new Event("change", { bubbles: true })); await settle();
  expect(mocks.saveGenerationFormPreferences).toHaveBeenCalledTimes(2);
  mocks.saveGenerationFormPreferences.mockResolvedValue(undefined);
  await controller.flush();
  expect(mocks.saveGenerationFormPreferences).toHaveBeenLastCalledWith({ ...custom, duration: 600, variants: 4 });
  expect(error().hidden).toBe(true);
});

it("falls back after read failure and retries reading on close without overwriting saved data", async () => {
  mocks.generationFormPreferences.mockRejectedValueOnce(new Error("Database busy"));
  const controller = createFormPreferences(form(), vi.fn()); await controller.ready;
  expect(field("inference_steps").value).toBe("30"); expect(error().hidden).toBe(false);
  await controller.flush();
  expect(mocks.generationFormPreferences).toHaveBeenCalledTimes(2);
  expect(mocks.saveGenerationFormPreferences).not.toHaveBeenCalled(); expect(error().hidden).toBe(true);
});

it("provides the reset and error labels in all twelve languages", () => {
  expect(Object.keys(formPreferenceTranslations).sort()).toEqual(Object.keys(LANGS).sort());
  for (const lang of Object.keys(LANGS)) {
    const values = (I18N as Record<string, Record<string, unknown>>)[lang];
    expect(values.form_preferences_reset).toBeTruthy(); expect(values.form_preferences_error).toBeTruthy();
  }
});

it("uses current model and device defaults on explicit reset without replacing saved steps on load", async () => {
  const defaults = vi.fn().mockResolvedValue({ ...DEFAULT_FORM_PREFERENCES, inference_steps: 8 });
  mocks.generationFormPreferences.mockResolvedValue({ ...custom, inference_steps: 80 });
  const controller = createFormPreferences(form(), vi.fn(), defaults); await controller.ready;
  expect(field("inference_steps").value).toBe("80");
  document.querySelector<HTMLButtonElement>("#resetGenPreferences")!.click(); await settle(); await controller.flush();
  expect(field("inference_steps").value).toBe("8");
  expect(mocks.saveGenerationFormPreferences).toHaveBeenLastCalledWith({ ...DEFAULT_FORM_PREFERENCES, inference_steps: 8 });
});

it.each([80, 91, 100, 120, 200])("preserves an existing %s-step preference without increasing it or rewriting storage on load", async steps => {
  const stored = Object.freeze({ ...custom, inference_steps: steps });
  mocks.generationFormPreferences.mockResolvedValue(stored);
  const controller = createFormPreferences(form(), vi.fn()); await controller.ready;
  expect(field("inference_steps").value).toBe(String(steps));
  expect(stored.inference_steps).toBe(steps);
  await controller.flush(); expect(mocks.saveGenerationFormPreferences).not.toHaveBeenCalled();
  field("duration").value = "300"; controller.capture(); await controller.flush();
  expect(mocks.saveGenerationFormPreferences).toHaveBeenLastCalledWith({ ...stored, duration: 300 });
});

it.each([80, 91])("restores %s steps after reopening and uses 80 only on explicit GPU SFT reset", async steps => {
  let stored = { ...custom, inference_steps: steps };
  mocks.generationFormPreferences.mockImplementation(async () => ({ ...stored }));
  mocks.saveGenerationFormPreferences.mockImplementation(async (values: GenerationFormPreferences) => { stored = { ...values }; });
  const defaults = async () => ({ ...DEFAULT_FORM_PREFERENCES, inference_steps: 80 });
  const first = createFormPreferences(form(), vi.fn(), defaults); await first.ready;
  field("duration").value = "300"; field("duration").dispatchEvent(new Event("input", { bubbles: true }));
  await first.flush();

  mountStudio();
  const reopened = createFormPreferences(form(), vi.fn(), defaults); await reopened.ready;
  expect(field("inference_steps").value).toBe(String(steps));
  expect(field("duration").value).toBe("300");
  document.querySelector<HTMLButtonElement>("#resetGenPreferences")!.click();
  await settle(); await reopened.flush();
  expect(field("inference_steps").value).toBe("80");
  mountStudio();
  const reset = createFormPreferences(form(), vi.fn(), defaults); await reset.ready;
  expect(field("inference_steps").value).toBe("80");
  expect(field("duration").value).toBe("90");
});
