// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { mountStudio } from "./dom-fixture";
import manifest from "../models/manifest.json";
import title from "../models/title-model.json";
import type { BackendStatus, Bootstrap } from "./types";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, convertFileSrc: (s: string) => s }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

const result: BackendStatus = {
  state: "running", synthesis: { state: "unconfirmed", backend: "unknown", device: null, reason: null },
  language_model: { state: "confirmed", backend: "vulkan", device: "Vulkan0", reason: "cuda_architecture_unsupported" },
};
const data = {
  needs_setup: true, version: "0.1.1", data_dir: "/data", error: null, manifest, title_model: title.model,
  settings: { cpu_iteration_behavior: "ask", models_dir: "/models", songs_dir: "/songs", lm_model: "acestep-5Hz-lm-0.6B-Q8_0.gguf", expert_mode: false, dit: "standard", model_provider: "ace-step", synthesis_model: "acestep-v15-sft-Q8_0.gguf", lm_device: "auto", export_format: "wav", poll_interval: 1.5, timeout_minutes: 30, mode: "single", vae_chunk: 128, tested_fingerprint: "", setup_complete: false },
  hardware: { ram_bytes: 64 * 1024 ** 3, gpu: "GTX 1060", recommended_lm: "0.6B", vram_bytes: 6 * 1024 ** 3, vae_chunk: 128, platform: "windows", cpu_only: false, nvidia: { compute_capability: "6.1", driver_version: "580.0" }, cuda: { minimum_compute_capability: "7.5", architecture_supported: false } },
  recommended_profiles: [{ provider: "ace-step", synthesis: "acestep-v15-sft-Q8_0.gguf", language: "acestep-5Hz-lm-0.6B-Q8_0.gguf" }],
} as Bootstrap;

beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks(); mountStudio();
  mocks.listen.mockResolvedValue(() => {});
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "generation_policy") return { backend: "gpu", cpu_iteration_behavior: "ask", recommended_steps: 80, defaults: { duration: 90, bpm: 0, inference_steps: 80, lm_temperature: 1.2, variants: 2 } };
    if (command === "setup_estimate") return { missing_bytes: 0, free_bytes: 100 };
    if (command === "setup_models") return { ok: true, mode: "single", backend_status: result };
    if (command === "health") return { ok: true, backend_status: result };
    throw new Error(`Unexpected command: ${command}`);
  });
});

it("keeps the measured setup result visible until the user enters the studio", async () => {
  const { setLang } = await import("./i18n.js");
  setLang("de");
  const ready = vi.fn().mockResolvedValue(undefined);
  const { showSetup } = await import("./setup");
  await showSetup(data, ready);
  expect(document.querySelectorAll("#setupLanguage")).toHaveLength(1);
  expect(document.querySelector<HTMLElement>("#cpuSetupHint")!.hidden).toBe(true);
  expect(document.querySelector("#cudaCompatibility")!.textContent).toContain("GPU-Architektur ist in diesem CUDA-Build nicht enthalten");
  expect(document.querySelector("#cudaCompatibility")!.textContent).toContain("6.1");
  expect(document.querySelector("#cudaCompatibility")!.textContent).toContain("Compute Capability ≥ 7.5");
  expect(document.querySelector("#cudaCompatibility")!.textContent).not.toContain("CUDA ≥ 7.5");
  document.querySelector("#setupForm")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(document.querySelector<HTMLElement>("#setupResult")?.hidden).toBe(false));
  expect(ready).not.toHaveBeenCalled();
  expect(document.querySelector("#setupResult")!.textContent).toContain("Sprachmodell: Vulkan · Vulkan0");
  expect(document.querySelector("#setupResult")!.textContent).toContain("Klangerzeugung: Noch nicht bestätigt");
  setLang("en");
  expect(document.querySelector("#setupResult")!.textContent).toContain("Sound generation: Not confirmed yet");
  expect(document.querySelector("#setupEnterStudio")!.textContent).toBe("Go to studio");
  document.querySelector<HTMLButtonElement>("#setupEnterStudio")!.click();
  await vi.waitFor(() => expect(ready).toHaveBeenCalledWith(true));
  await showSetup({ ...data, needs_setup: false }, ready);
  expect(document.querySelector<HTMLElement>("#setupResult")!.hidden).toBe(true);
  expect(document.querySelector<HTMLElement>("#setupForm")!.hidden).toBe(false);
});

it.each(["cpu", "unknown"] as const)("preserves the %s iteration guidance alongside the CUDA compatibility result", async device => {
  const invoke = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation(async (command: string, args?: unknown) => command === "generation_policy"
    ? { backend: device, cpu_iteration_behavior: "ask", recommended_steps: 30, defaults: { duration: 90, bpm: 0, inference_steps: 30, lm_temperature: 1.2, variants: 2 } }
    : invoke(command, args));
  const { setLang, t } = await import("./i18n.js"); setLang("de");
  const { showSetup } = await import("./setup");
  await showSetup(data, vi.fn());
  const hint = document.querySelector<HTMLElement>("#cpuSetupHint")!;
  const key = device === "cpu" ? "cpu_setup" : "cpu_unknown_setup";
  expect(hint.hidden).toBe(false);
  expect(hint.textContent).toBe(t(key));
  expect(document.querySelector("#cudaCompatibility")!.textContent).toContain("Compute Capability ≥ 7.5");
  setLang("en");
  expect(hint.textContent).toBe(t(key));
  expect(document.querySelector("#cudaCompatibility")!.textContent).toContain("Compute capability ≥ 7.5");
});

it("does not present a successful result or enter the studio when setup fails", async () => {
  const { setLang } = await import("./i18n.js"); setLang("de");
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "setup_models") throw new Error("Hardware test failed");
    return { missing_bytes: 0, free_bytes: 100 };
  });
  const ready = vi.fn();
  const { showSetup } = await import("./setup");
  await showSetup(data, ready);
  document.querySelector("#setupForm")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(document.querySelector("#setupError")!.textContent).toContain("Hardware test failed"));
  expect(document.querySelector<HTMLElement>("#setupResult")!.hidden).toBe(true);
  expect(document.querySelector<HTMLElement>("#setupForm")!.hidden).toBe(false);
  expect(ready).not.toHaveBeenCalled();
});

it("announces a cancelled setup as a translated status and allows another attempt with the same selections", async () => {
  const { setLang } = await import("./i18n.js"); setLang("de");
  const invoke = mocks.invoke.getMockImplementation()!;
  let cancel!: () => void;
  let attempts = 0;
  mocks.invoke.mockImplementation((command: string, args?: unknown) => {
    if (command === "setup_models" && attempts++ === 0) {
      return new Promise((_, reject) => { cancel = () => reject("Operation cancelled"); });
    }
    if (command === "cancel_setup") { cancel(); return Promise.resolve(); }
    return invoke(command, args);
  });
  const ready = vi.fn();
  const { showSetup } = await import("./setup");
  await showSetup(data, ready);
  const form = document.querySelector<HTMLFormElement>("#setupForm")!;
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  expect(document.body.dataset.settingUp).toBe("true");
  document.querySelector<HTMLButtonElement>("#cancelSetup")!.click();
  await vi.waitFor(() => expect(document.body.dataset.settingUp).toBe("false"));
  expect(mocks.invoke).toHaveBeenCalledWith("cancel_setup", undefined);
  const status = document.querySelector<HTMLElement>("#setupStatus")!;
  expect(status?.textContent).toBe("Einrichtung abgebrochen. Deine Auswahl bleibt erhalten. Du kannst sie anpassen und erneut starten.");
  expect(status.getAttribute("role")).toBe("status");
  expect(status.classList.contains("setup-error")).toBe(false);
  expect(document.querySelector("#setupError")!.textContent).toBe("");
  expect(document.querySelector<HTMLElement>("#setupResult")!.hidden).toBe(true);
  expect(form.hidden).toBe(false);
  expect(document.querySelector<HTMLFieldSetElement>("#setupFields")!.disabled).toBe(false);
  expect(document.querySelector<HTMLButtonElement>("#setupStart")!.disabled).toBe(false);
  expect(document.querySelector<HTMLSelectElement>("#setupLanguage")!.disabled).toBe(false);
  expect(document.querySelector<HTMLElement>("#setupProgressArea")!.hidden).toBe(true);
  expect(ready).not.toHaveBeenCalled();
  setLang("en");
  expect(status.textContent).toBe("Setup cancelled. Your selections are kept. You can adjust them and start again.");
  setLang("de");
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  expect(status.textContent).toBe("");
  setLang("en");
  expect(status.textContent).toBe("");
  await vi.waitFor(() => expect(document.querySelector<HTMLElement>("#setupResult")!.hidden).toBe(false));
  const requests = mocks.invoke.mock.calls.filter(([command]) => command === "setup_models");
  expect(requests).toHaveLength(2);
  expect(requests[1][1]).toEqual(requests[0][1]);
  expect(ready).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>("#setupEnterStudio")!.click();
  await vi.waitFor(() => expect(ready).toHaveBeenCalledWith(true));
});

it("keeps a failed cancellation request visible as an error until the running setup finishes", async () => {
  await import("./path-i18n");
  const { setLang } = await import("./i18n.js"); setLang("de");
  const invoke = mocks.invoke.getMockImplementation()!;
  let fail!: () => void;
  mocks.invoke.mockImplementation((command: string, args?: unknown) => {
    if (command === "setup_models") return new Promise((_, reject) => { fail = () => reject("path_access"); });
    if (command === "cancel_setup") return Promise.reject("path_access");
    return invoke(command, args);
  });
  const ready = vi.fn();
  const { showSetup } = await import("./setup");
  await showSetup(data, ready);
  document.querySelector("#setupForm")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  document.querySelector<HTMLButtonElement>("#cancelSetup")!.click();
  const error = document.querySelector<HTMLElement>("#setupError")!;
  await vi.waitFor(() => expect(error.textContent).toBe("Kein Ordnerzugriff. Bitte über „Auswählen…“ freigeben oder die Dateirechte prüfen."));
  expect(error.getAttribute("role")).toBe("alert");
  expect(error.classList.contains("setup-error")).toBe(true);
  expect(document.querySelector("#setupStatus")!.textContent).toBe("");
  expect(document.body.dataset.settingUp).toBe("true");
  fail();
  await vi.waitFor(() => expect(document.body.dataset.settingUp).toBe("false"));
  expect(error.textContent).toBe("Kein Ordnerzugriff. Bitte über „Auswählen…“ freigeben oder die Dateirechte prüfen.");
  expect(document.querySelector("#setupStatus")!.textContent).toBe("");
  expect(document.querySelector<HTMLButtonElement>("#setupStart")!.disabled).toBe(false);
  expect(document.querySelector<HTMLElement>("#setupResult")!.hidden).toBe(true);
  expect(ready).not.toHaveBeenCalled();
});
