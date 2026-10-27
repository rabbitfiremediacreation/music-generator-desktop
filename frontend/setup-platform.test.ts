// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountStudio } from "./dom-fixture";
import manifest from "../models/manifest.json";
import title from "../models/title-model.json";
import type { Bootstrap } from "./types";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, convertFileSrc: (path: string) => path }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const data = {
  needs_setup: true, version: "0.1.2", data_dir: "/data", error: null, manifest, title_model: title.model,
  settings: { cpu_iteration_behavior: "ask", models_dir: "/models", songs_dir: "/songs", lm_model: "acestep-5Hz-lm-1.7B-Q8_0.gguf", expert_mode: false, dit: "standard", model_provider: "ace-step", synthesis_model: "acestep-v15-sft-Q8_0.gguf", lm_device: "auto", export_format: "wav", poll_interval: 1.5, timeout_minutes: 30, mode: "single", vae_chunk: 256, tested_fingerprint: "", setup_complete: false },
  hardware: { ram_bytes: 16 * 1024 ** 3, gpu: "GPU", recommended_lm: "1.7B", vram_bytes: null, vae_chunk: 256, platform: "windows", cpu_only: false },
  recommended_profiles: [{ provider: "ace-step", synthesis: "acestep-v15-sft-Q8_0.gguf", language: "acestep-5Hz-lm-1.7B-Q8_0.gguf" }],
} as Bootstrap;

beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks(); mountStudio();
  mocks.listen.mockResolvedValue(() => {});
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "generation_policy") return { backend: "gpu", cpu_iteration_behavior: "ask", recommended_steps: 80, defaults: { duration: 90, bpm: 0, inference_steps: 80, lm_temperature: 1.2, variants: 2 } };
    if (command === "setup_estimate") return { missing_bytes: 0, free_bytes: 100 };
    throw new Error(`Unexpected command: ${command}`);
  });
});

const copy = {
  de: {
    plain: "Absolute Pfade können direkt eingegeben werden. Neue Ordner werden beim Start der Einrichtung angelegt.",
    macos: "Absolute Pfade können direkt eingegeben werden. Neue Ordner werden beim Start der Einrichtung angelegt. Auf macOS müssen externe Ordner gegebenenfalls über „Auswählen…“ freigegeben werden; ein gespeicherter Pfad allein erteilt keinen Zugriff.",
  },
  en: {
    plain: "You can enter absolute paths directly. New folders are created when setup starts.",
    macos: "You can enter absolute paths directly. New folders are created when setup starts. On macOS, external folders may need authorization using Browse; a saved path alone does not grant access.",
  },
};
const pathHint = () => document.querySelector("#setupPathHint")!.textContent;

async function showWizard(language: "de" | "en", platform: string) {
  await import("./path-i18n");
  const { setLang } = await import("./i18n.js"); setLang(language);
  const { showSetup } = await import("./setup");
  await showSetup({ ...data, hardware: { ...data.hardware, platform } }, async () => {});
  return showSetup;
}

describe.each(["de", "en"] as const)("%s setup copy", language => {
  it.each(["windows", "linux", "macos"])("shows folder guidance appropriate for %s", async platform => {
    await showWizard(language, platform);
    expect(pathHint()).toBe(copy[language][platform === "macos" ? "macos" : "plain"]);
  });
});

it.each(["windows", "linux", "macos"])("keeps %s folder guidance appropriate when changing the wizard language", async platform => {
  await showWizard("de", platform);
  const language = document.querySelector<HTMLSelectElement>("#setupLanguage")!;
  language.value = "en";
  language.dispatchEvent(new Event("change"));
  expect(pathHint()).toBe(copy.en[platform === "macos" ? "macos" : "plain"]);
  language.value = "de";
  language.dispatchEvent(new Event("change"));
  expect(pathHint()).toBe(copy.de[platform === "macos" ? "macos" : "plain"]);
});

it("refreshes platform guidance when reopening the existing wizard", async () => {
  const showSetup = await showWizard("de", "macos");
  expect(pathHint()).toBe(copy.de.macos);
  await showSetup(data, async () => {});
  expect(pathHint()).toBe(copy.de.plain);
  await showSetup({ ...data, hardware: { ...data.hardware, platform: "macos" } }, async () => {});
  expect(pathHint()).toBe(copy.de.macos);
});
