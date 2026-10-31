// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Header } from "./Header";
import { GenerationAdmissionProvider } from "./generation/admission";
import { GenerationForm } from "./generation/GenerationForm";
import { BackendDetails } from "./setup/BackendDetails";
import { I18nProvider } from "./i18n";
import { createAppQueryClient, queryKeys } from "./data";
import { I18N, setLang, t } from "../i18n.js";
import { LANGS } from "../locales";
import type { BackendStatus, ComponentBackend, GenerationPolicy } from "../types";

const ipc = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: ipc.invoke, convertFileSrc: (path: string) => path }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
const status: BackendStatus = {
  state: "running",
  synthesis: { state: "unconfirmed", backend: "unknown", device: null, reason: null },
  language_model: { state: "confirmed", backend: "vulkan", device: "Vulkan0", reason: "cuda_architecture_unsupported" },
};
const idle = { state: "not_started", backend: "unknown", device: null, reason: null } as const;
const stopped = { state: "stopped", backend: "unknown", device: null, reason: null } as const;
const defaults = { duration: 90, bpm: 0, inference_steps: 30, lm_temperature: 1.2, variants: 2 };
let policyOverride: GenerationPolicy | undefined;
let currentStatus: BackendStatus | undefined, detected: ComponentBackend["backend"], lmDevice: "auto" | "cpu", healthFails: boolean;
beforeEach(() => {
  setLang("de"); policyOverride = undefined; currentStatus = undefined; detected = "unknown"; lmDevice = "auto"; healthFails = false;
  ipc.invoke.mockReset();
  ipc.invoke.mockImplementation(async (command: string) => {
    if (command === "health") { if (healthFails) throw new Error("connection lost"); return { ok: true, backend_status: currentStatus }; }
    if (command === "generation_policy") return policyOverride ?? { backend: detected === "unknown" ? "unknown" : detected === "cpu" ? "cpu" : "gpu", detected_backend: detected, cpu_iteration_behavior: "ask", recommended_steps: 30, defaults } satisfies GenerationPolicy;
    if (command === "get_settings") return { lm_device: lmDevice, mode: "split" };
    if (command === "get_generation_form_preferences") return { ...defaults, inference_steps: 80 };
    throw new Error(`Unexpected command: ${command}`);
  });
});
afterEach(cleanup);
function mountHeader(withGeneration = false) {
  const client = createAppQueryClient();
  const rendered = render(<QueryClientProvider client={client}><I18nProvider><Header selection={null} onAnalysis={() => {}} onSettings={() => {}} />{withGeneration && <GenerationAdmissionProvider><GenerationForm selection={null} settingsBlocked={false} /></GenerationAdmissionProvider>}</I18nProvider></QueryClientProvider>);
  return { ...rendered, client };
}
function chip(): HTMLElement { return document.querySelector<HTMLElement>("#backendStatus")!; }
function mountDetails(value: BackendStatus | undefined = status) {
  const client = createAppQueryClient();
  const view = (next?: BackendStatus) => <QueryClientProvider client={client}><I18nProvider><BackendDetails status={next} /></I18nProvider></QueryClientProvider>;
  const rendered = render(view(value));
  return { ...rendered, update(next?: BackendStatus) { rendered.rerender(view(next)); } };
}

it("shows only confirmed execution and explains Vulkan while preserving expanded details through a live language change", () => {
  mountDetails();
  expect(screen.getByRole("region", { name: "Backend-Details" }).textContent).toContain("Klangerzeugung: Noch nicht bestätigt");
  expect(screen.getByRole("region").textContent).toContain("Sprachmodell: Vulkan · Vulkan0");
  expect(screen.getByRole("region").textContent).toContain("GPU-Architektur wird vom enthaltenen CUDA-Build nicht unterstützt");
  const details = document.querySelector("details")!; details.open = true;
  act(() => setLang("en"));
  expect(screen.getByRole("region", { name: "Backend details" }).textContent).toContain("Sound generation: Not confirmed yet");
  expect(screen.getByRole("region").textContent).toContain("Language model: Vulkan · Vulkan0");
  expect(document.querySelector("details")).toBe(details); expect(details.open).toBe(true);
});
it("updates synthesis and removes observed devices after the engine stops or its snapshot disappears", () => {
  const view = mountDetails(); const details = document.querySelector("details")!;
  view.update({ ...status, synthesis: { state: "confirmed", backend: "vulkan", device: "Vulkan0", reason: null } });
  expect(screen.getByRole("region").textContent).toContain("Klangerzeugung: Vulkan · Vulkan0");
  expect(screen.getByRole("region").textContent).toContain("Ein Grund für die Backend-Auswahl ist nicht belegt.");
  view.update({ state: "stopped", synthesis: stopped, language_model: stopped });
  expect(screen.getByRole("region").textContent).toContain("Klangerzeugung: Engine beendet");
  expect(screen.getByRole("region").textContent).not.toContain("Vulkan0");
  expect(document.querySelector("details")).toBe(details); expect(details.open).toBe(true);
  view.update(undefined);
  expect(screen.getByRole("region").textContent).toContain("Klangerzeugung: Unbekannt");
});
it("keeps studio backend information compact, read-only and beside the language selector", async () => {
  currentStatus = { ...status, synthesis: { state: "confirmed", backend: "metal", device: "MTL0", reason: null } };
  mountHeader();
  await waitFor(() => expect(chip().dataset.backend).toBe("metal"));
  expect(chip().querySelector("details, summary, select, button")).toBeNull();
  expect(chip().textContent).toBe("RechenbackendMetal");
  expect(chip().getAttribute("aria-label")).toContain("Klangerzeugung: Metal · MTL0");
  expect(document.querySelector("#uiLang")!.parentElement!.contains(chip())).toBe(true);
  expect(document.querySelector("#uiLang")!.parentElement!.classList.contains("header-context")).toBe(true);
});
it.each([["metal", "Metal"], ["vulkan", "Vulkan"], ["cuda", "CUDA"], ["cpu", "CPU"]] as const)("shows detected %s availability before execution without claiming a model has run", async (device, name) => {
  detected = device; currentStatus = { state: "not_started", synthesis: idle, language_model: idle };
  mountHeader();
  await waitFor(() => expect(chip().dataset.backend).toBe(device));
  expect(chip().textContent).toBe(`Rechenbackend${name}`);
  expect(chip().textContent).not.toMatch(/gestartet|bestätigt|gelaufen/);
  expect(chip().title).toBe(`Klangerzeugung: ${name} · Erkannt und verfügbar\nSprachmodell: Automatisch`);
  expect(chip().dataset.evidence).toBe("available");
  expect(chip().title).not.toContain("In der Engine bestätigt");
});
it("uses current execution and returns to verified availability and the chosen LM mode when the engine stops", async () => {
  detected = "cpu"; lmDevice = "cpu";
  currentStatus = { ...status, synthesis: { state: "confirmed", backend: "metal", device: "MTL0", reason: null } };
  const { client } = mountHeader();
  await waitFor(() => expect(chip().dataset.evidence).toBe("observed"));
  expect(chip().title).toContain("Klangerzeugung: Metal · MTL0 · In der Engine bestätigt");
  expect(chip().title).toContain("Sprachmodell: Nur CPU · Vulkan · Vulkan0");
  expect(chip().textContent).not.toContain("Ein Grund");
  currentStatus = { state: "stopped", synthesis: stopped, language_model: stopped };
  await act(async () => { await client.invalidateQueries({ queryKey: queryKeys.health }); });
  await waitFor(() => expect(chip().dataset.backend).toBe("cpu")); expect(chip().dataset.evidence).toBe("available");
  expect(chip().title).toBe("Klangerzeugung: CPU · Erkannt und verfügbar\nSprachmodell: Nur CPU");
  expect(chip().title).not.toMatch(/MTL0|Vulkan0|bestätigt/);
});
it("keeps unknown detection honest without initial engine claims", async () => {
  mountHeader();
  await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith("generation_policy", { selection: null, refresh: false }));
  expect(chip().textContent).toBe("RechenbackendUnbekannt");
  expect(chip().dataset.evidence).toBe("unknown");
  expect(chip().title).not.toMatch(/verfügbar|bestätigt|gestartet/);
});
it("translates all twelve languages without live chip announcements or replacing the focused element", async () => {
  detected = "metal"; lmDevice = "cpu"; mountHeader();
  await waitFor(() => expect(chip().dataset.backend).toBe("metal"));
  const container = chip(), name = container.querySelector(".backend-chip-value"); container.focus();
  for (const language of Object.keys(LANGS) as (keyof typeof I18N)[]) {
    act(() => setLang(language));
    expect(container.querySelector(".backend-chip-label")!.textContent).toBe(t("backend_chip_label"));
    expect(container.title).toContain(t("backend_ready")); expect(container.title).toContain(t("lm_dev_cpu"));
    expect(container.getAttribute("aria-label")).toContain(t("backend_synthesis"));
    expect(document.activeElement).toBe(container); expect(container.querySelector(".backend-chip-value")).toBe(name);
  }
  expect(container.hasAttribute("aria-live")).toBe(false);
  expect(container.querySelector('[role="status"], [aria-live], details, button, select')).toBeNull();
});
it("discards old execution evidence on a failed health refresh while retaining verified availability", async () => {
  detected = "cpu"; currentStatus = { ...status, synthesis: { state: "confirmed", backend: "metal", device: "MTL0", reason: null } };
  const { client } = mountHeader();
  await waitFor(() => expect(chip().dataset.evidence).toBe("observed"));
  healthFails = true;
  await act(async () => { await client.invalidateQueries({ queryKey: queryKeys.health }); });
  await screen.findByText("Backend offline");
  await waitFor(() => expect(chip().dataset.backend).toBe("cpu")); expect(chip().dataset.evidence).toBe("available");
  expect(chip().title).not.toMatch(/MTL0|Vulkan0|bestätigt/);
});
it.each(["gpu", "error"] as const)("ignores a delayed health %s reply after a newer authoritative CPU policy", async outcome => {
  const production = ipc.invoke.getMockImplementation()!;
  let finish!: (value: unknown) => void, reject!: (error: Error) => void;
  ipc.invoke.mockImplementation((command: string, args: unknown) => command === "health" ? new Promise((resolve, fail) => { finish = resolve; reject = fail; }) : production(command, args));
  const { client } = mountHeader();
  await waitFor(() => expect(client.getQueryData(queryKeys.policy(null))).toBeTruthy());
  policyOverride = { backend: "cpu", probed_backend: "gpu", detected_backend: "cpu", lm_device: "auto", cpu_iteration_behavior: "ask", recommended_steps: 30, defaults };
  await act(async () => { await client.invalidateQueries({ queryKey: queryKeys.policy(null) }); });
  await waitFor(() => expect(chip().dataset.backend).toBe("cpu"));
  await act(async () => { if (outcome === "gpu") finish({ ok: true, backend_status: { ...status, synthesis: { state: "confirmed", backend: "metal", device: "MTL0", reason: null } } }); else reject(new Error("Old health failure")); });
  await waitFor(() => expect(client.getQueryState(queryKeys.health)?.fetchStatus).toBe("idle"));
  expect(chip().dataset.backend).toBe("cpu"); expect(chip().title).not.toContain("MTL0");
  expect(screen.queryByText("Backend offline")).toBeNull();
});
it("updates availability and the selected LM mode from a policy response without querying health or starting inference", async () => {
  const { client } = mountHeader();
  await waitFor(() => expect(client.getQueryState(queryKeys.health)?.status).toBe("success"));
  const healthCalls = ipc.invoke.mock.calls.filter(([command]) => command === "health").length;
  policyOverride = { backend: "gpu", probed_backend: "gpu", detected_backend: "metal", lm_device: "cpu", cpu_iteration_behavior: "ask", recommended_steps: 80, defaults: { ...defaults, inference_steps: 80 } };
  await act(async () => { await client.invalidateQueries({ queryKey: queryKeys.policy(null) }); });
  await waitFor(() => expect(chip().textContent).toBe("RechenbackendMetal"));
  expect(chip().title).toBe("Klangerzeugung: Metal · Erkannt und verfügbar\nSprachmodell: Nur CPU");
  policyOverride = { ...policyOverride, lm_device: "auto" };
  await act(async () => { await client.invalidateQueries({ queryKey: queryKeys.policy(null) }); });
  await waitFor(() => expect(chip().title).toContain("Sprachmodell: Automatisch"));
  expect(ipc.invoke.mock.calls.filter(([command]) => command === "health")).toHaveLength(healthCalls);
  expect(ipc.invoke.mock.calls.filter(([command]) => command === "generate")).toHaveLength(0);
});
it("updates generation warnings from confirmed synthesis independently of the language model's CPU use", async () => {
  currentStatus = { ...status, synthesis: { state: "confirmed", backend: "metal", device: "MTL0", reason: null }, language_model: { state: "confirmed", backend: "cpu", device: "CPU", reason: "cpu_requested" } };
  const { client } = mountHeader(true);
  await waitFor(() => expect(chip().dataset.backend).toBe("metal"));
  await waitFor(() => expect((document.querySelector('[name="inference_steps"]') as HTMLInputElement).value).toBe("80"));
  expect(document.querySelector("#cpuGenerationWarning")).toBeNull();
  currentStatus = { ...currentStatus, synthesis: { state: "confirmed", backend: "cpu", device: "CPU", reason: null } };
  await act(async () => { await client.invalidateQueries({ queryKey: queryKeys.health }); });
  await waitFor(() => expect(chip().dataset.backend).toBe("cpu"));
  expect(document.querySelector("#cpuGenerationWarning")!.textContent).toContain("Die Klangerzeugung läuft auf der CPU.");
  expect((document.querySelector('[name="inference_steps"]') as HTMLInputElement).getAttribute("aria-describedby")).toBe("cpuGenerationWarning");
});
it("does not restore an older GPU response after a newer stopped health response", async () => {
  currentStatus = { state: "not_started", synthesis: idle, language_model: idle };
  const { client } = mountHeader(true);
  await waitFor(() => expect(client.getQueryState(queryKeys.health)?.status).toBe("success"));
  const production = ipc.invoke.getMockImplementation()!;
  let finish!: (value: unknown) => void;
  let healthCalls = 0;
  ipc.invoke.mockImplementation((command: string, args: unknown) => {
    if (command !== "health") return production(command, args);
    healthCalls++;
    return healthCalls === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ ok: true, backend_status: { state: "stopped", synthesis: stopped, language_model: stopped } });
  });
  const older = client.invalidateQueries({ queryKey: queryKeys.health });
  await waitFor(() => expect(healthCalls).toBe(1));
  await act(async () => { await client.invalidateQueries({ queryKey: queryKeys.health }); });
  await act(async () => { finish({ ok: true, backend_status: { ...status, synthesis: { state: "confirmed", backend: "metal", device: "MTL0", reason: null } } }); await older; });
  await waitFor(() => expect(chip().dataset.backend).toBe("unknown"));
  expect(chip().getAttribute("aria-label")).not.toContain("MTL0");
  expect(document.querySelector("#cpuGenerationWarning")).toBeTruthy();
});
it.each([["cpu", "cpu", "gpu", "metal"], ["metal", "gpu", "unknown", "unknown"]] as const)("preserves confirmed %s execution supplied with a fresh policy despite different detected availability", async (device, backendClass, probed, available) => {
  const { client } = mountHeader();
  await waitFor(() => expect(client.getQueryState(queryKeys.health)?.status).toBe("success"));
  const current: BackendStatus = { ...status, synthesis: { state: "confirmed", backend: device, device: device === "metal" ? "MTL0" : "CPU", reason: null } };
  policyOverride = { backend: backendClass, probed_backend: probed, detected_backend: available, lm_device: "auto", backend_status: current, cpu_iteration_behavior: "ask", recommended_steps: 80, defaults };
  await act(async () => { await client.invalidateQueries({ queryKey: queryKeys.policy(null) }); });
  await waitFor(() => expect(chip().dataset.backend).toBe(device));
  expect(chip().dataset.evidence).toBe("observed"); expect(chip().title).toContain("In der Engine bestätigt");
});
it("labels the selected automatic LM mode separately from its confirmed CPU fallback", async () => {
  lmDevice = "auto";
  currentStatus = { ...status, language_model: { state: "confirmed", backend: "cpu", device: "CPU", reason: "lm_selftest_failed" } };
  const { client } = mountHeader();
  await waitFor(() => expect(chip().title).toContain("Sprachmodell: Automatisch · CPU"));
  await act(async () => { await client.invalidateQueries({ queryKey: queryKeys.settings }); });
  expect(chip().title).toContain("Sprachmodell: Automatisch · CPU");
  expect(chip().title).not.toContain("Sprachmodell: Nur CPU");
});
it("retains a newer stopped health observation when an older policy finishes afterwards", async () => {
  currentStatus = { ...status, synthesis: { state: "confirmed", backend: "metal", device: "MTL0", reason: null } };
  const { client } = mountHeader(true);
  await waitFor(() => expect(chip().dataset.backend).toBe("metal"));
  const production = ipc.invoke.getMockImplementation()!;
  let finish!: (value: GenerationPolicy) => void;
  ipc.invoke.mockImplementation((command: string, args: unknown) => command === "generation_policy" ? new Promise(resolve => { finish = resolve; }) : production(command, args));
  const older = client.invalidateQueries({ queryKey: queryKeys.policy(null) });
  await waitFor(() => expect(finish).toBeTruthy());
  currentStatus = { state: "stopped", synthesis: stopped, language_model: stopped };
  await act(async () => { await client.invalidateQueries({ queryKey: queryKeys.health }); });
  await act(async () => { finish({ backend: "gpu", probed_backend: "unknown", detected_backend: "unknown", lm_device: "auto", backend_status: { ...status, synthesis: { state: "confirmed", backend: "metal", device: "MTL0", reason: null } }, cpu_iteration_behavior: "ask", recommended_steps: 30, defaults }); await older; });
  await waitFor(() => expect(chip().dataset.evidence).toBe("unknown"));
  expect(chip().title).not.toContain("MTL0");
  expect(document.querySelector("#cpuGenerationWarning")).toBeTruthy();
});
