// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mountStudio } from "./dom-fixture";
import manifest from "../models/manifest.json";
import title from "../models/title-model.json";
import type { GenerationPolicy } from "./types";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), close: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, convertFileSrc: (path: string) => `asset:${path}` }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ onCloseRequested: mocks.close }) }));

beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks(); mountStudio(); localStorage.setItem("ui_lang", "de");
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { callback(0); return 0; });
  mocks.listen.mockResolvedValue(() => {});
  mocks.invoke.mockImplementation(async name => {
    if (name === "startup_status") return { attempt: 2, sequence: 1, phase: "starting", error: null };
    if (name === "startup_allowed") return true;
    if (name === "setup_estimate") return { missing_bytes: 0, free_bytes: 100 };
    if (name === "generation_policy") return {
      backend: "cpu", cpu_iteration_behavior: "ask", recommended_steps: 30,
      defaults: { duration: 60, bpm: 0, inference_steps: 30, lm_temperature: 1.2, variants: 1 },
    } satisfies GenerationPolicy;
    if (name === "bootstrap") return {
      needs_setup: true, version: "0.1.1", data_dir: "/data", error: null, manifest, title_model: title.model,
      settings: { models_dir: "/models", songs_dir: "/songs", lm_model: "acestep-5Hz-lm-1.7B-Q8_0.gguf", dit: "standard", expert_mode: false },
      hardware: { ram_bytes: 16 * 1024 ** 3, gpu: "CPU", recommended_lm: "1.7B", cpu_only: true },
      recommended_profiles: [{ provider: "ace-step", synthesis: "acestep-v15-sft-Q8_0.gguf", language: "acestep-5Hz-lm-1.7B-Q8_0.gguf" }],
    };
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("keeps setup uninitialized when installation is required", async () => {
  const installed = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((name, args) => name === "startup_allowed" ? false : installed(name, args));
  await import("./launch");
  await vi.dynamicImportSettled();
  expect(document.querySelector("#setupForm")).toBeNull();
  expect(document.querySelector<HTMLElement>("#setupContent")!.hidden).toBe(true);
  expect(mocks.invoke).not.toHaveBeenCalledWith("bootstrap", { attempt: 2 });
});

it("initializes the real setup interface for a copied application", async () => {
  await import("./launch");
  await vi.waitFor(() => expect(document.querySelector("#setupForm")).not.toBeNull());
  expect(document.querySelector<HTMLElement>("#setupContent")!.hidden).toBe(false);
  expect(document.querySelector<HTMLInputElement>("#setupModels")!.value).toBe("/models");
  expect(document.querySelector("#hardwareInfo")!.textContent).toContain("CPU");
  expect(mocks.invoke).toHaveBeenCalledWith("startup_status");
  expect(mocks.invoke).toHaveBeenCalledWith("startup_allowed", { attempt: 2 });
  expect(mocks.invoke).toHaveBeenCalledWith("bootstrap", { attempt: 2 });
  await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("startup_complete", { attempt: 2 }));
});

it("localizes a startup timeout and contains a failed error report", async () => {
  const installed = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((name, args) => {
    if (name === "startup_allowed") return Promise.reject("startup_splash_timeout");
    if (name === "startup_error") return Promise.reject("report unavailable");
    return installed(name, args);
  });
  await import("./launch");
  await vi.dynamicImportSettled();
  expect(document.querySelector("#bootStatus")!.textContent).toBe("Das Startfenster ist nicht bereit geworden. Bitte versuche es erneut.");
  expect(mocks.invoke).toHaveBeenCalledWith("startup_error", { attempt: 2, error: "startup_splash_timeout" });
});

it("ignores a superseded main-window attempt", async () => {
  const installed = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((name, args) => name === "startup_allowed" ? Promise.reject("startup_attempt_expired") : installed(name, args));
  await import("./launch");
  await vi.dynamicImportSettled();
  expect(mocks.invoke).not.toHaveBeenCalledWith("startup_error", { attempt: 2, error: "startup_attempt_expired" });
  expect(document.querySelector("#bootStatus")!.textContent).not.toContain("startup_attempt_expired");
});
