// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "../i18n";
import { setLang } from "../../i18n.js";
import { SetupScreen, type SetupScreenProps } from "./SetupScreen";
import { measuredBackend, setupFixture } from "./fixtures";
import type { Bootstrap } from "../../types";

const ipc = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: ipc.invoke, convertFileSrc: (path: string) => path }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: ipc.open }));

beforeEach(() => {
  localStorage.setItem("ui_lang", "de");
  setLang("de");
  ipc.invoke.mockReset();
  ipc.open.mockReset();
  ipc.invoke.mockImplementation(async (name: string, args?: { current?: string }) => {
    if (name === "setup_estimate") return { missing_bytes: 0, free_bytes: 1024 ** 4 };
    if (name === "generation_policy") return { backend: "gpu" };
    if (name === "cuda_status") return { state: "not_applicable", details: null, download_bytes: 0 };
    if (name === "setup_models") return { ok: true, mode: "single", backend_status: measuredBackend };
    if (name === "dialog_directory") return args?.current || "/home/test";
  });
});
afterEach(cleanup);

function mount(bootstrap: Bootstrap = setupFixture, onReady = vi.fn(), props: Partial<SetupScreenProps> = {}) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><I18nProvider><SetupScreen bootstrap={bootstrap} onComplete={() => {}} onReady={onReady} {...props} /></I18nProvider></QueryClientProvider>);
}

async function next() {
  const button = screen.getByRole("button", { name: "Weiter" }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
}

async function reviewSetup() { await next(); await next(); }

it("shows measured setup results until the user explicitly enters the studio", async () => {
  const complete = vi.fn(), ready = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><I18nProvider><SetupScreen bootstrap={setupFixture} onComplete={complete} onReady={ready} /></I18nProvider></QueryClientProvider>);
  await waitFor(() => expect(ready).toHaveBeenCalledOnce());
  await reviewSetup();
  fireEvent.click(screen.getByRole("button", { name: "Modelle laden und testen" }));
  expect(await screen.findByText("Sprachmodell: Vulkan · Vulkan0")).toBeTruthy();
  expect(screen.getByText("Klangerzeugung: Noch nicht bestätigt")).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Zum Studio" }));
  expect(complete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Zum Studio" }));
  expect(complete).toHaveBeenCalledOnce();
});

it("never displays an estimate for a path that the user has already replaced", async () => {
  const ready = vi.fn(); mount(setupFixture, ready);
  await waitFor(() => expect(ready).toHaveBeenCalledOnce());
  let finish!: (value: { missing_bytes: number; free_bytes: number }) => void;
  ipc.invoke.mockImplementation(async (name: string, args?: { request: { models_dir: string } }) => {
    if (name === "setup_estimate" && args?.request.models_dir === "/new") return new Promise(resolve => { finish = resolve; });
    if (name === "setup_estimate") return { missing_bytes: 0, free_bytes: 1024 ** 4 };
  });
  const path = screen.getByRole("textbox", { name: /Modellordner/ });
  fireEvent.change(path, { target: { value: "  /new  " } });
  await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith("setup_estimate", { request: expect.objectContaining({ models_dir: "/new" }) }));
  fireEvent.change(path, { target: { value: "/newer" } });
  finish({ missing_bytes: 999 * 1024 ** 3, free_bytes: 999 * 1024 ** 3 });
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(screen.queryByText(/999/)).toBeNull();
  expect((screen.getByRole("button", { name: "Weiter" }) as HTMLButtonElement).disabled).toBe(true);
});

it("restores the saved language model when the wizard opens again in Expert Mode", async () => {
  const ready = vi.fn(); mount(setupFixture, ready);
  await waitFor(() => expect(ready).toHaveBeenCalledOnce());
  await next();
  expect((screen.getByRole("combobox", { name: /Sprachmodell/ }) as HTMLSelectElement).disabled).toBe(true);
  cleanup();
  mount({ ...setupFixture, settings: { ...setupFixture.settings, expert_mode: true, lm_model: "acestep-5Hz-lm-4B-Q8_0.gguf" } });
  await next();
  const lm = screen.getByRole("combobox", { name: /Sprachmodell/ }) as HTMLSelectElement;
  expect(lm.value).toBe("4B"); expect(lm.disabled).toBe(false); expect(lm.options).toHaveLength(3);
  await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith("setup_estimate", { request: expect.objectContaining({ lm: "4B" }) }));
});

it("keeps invalid paths editable and blocks navigation and setup until they are corrected", async () => {
  const complete = vi.fn(), ready = vi.fn(); mount(setupFixture, ready, { onComplete: complete });
  await waitFor(() => expect(ready).toHaveBeenCalledOnce());
  ipc.invoke.mockRejectedValue(new Error("path_absolute"));
  fireEvent.change(screen.getByRole("textbox", { name: /Song-Ordner/ }), { target: { value: "~/songs" } });
  await waitFor(() => expect(screen.getByText(/absolut/i)).toBeTruthy());
  const button = screen.getByRole("button", { name: "Weiter" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.submit(document.querySelector("#setupForm")!);
  expect(screen.getByRole("textbox", { name: /Song-Ordner/ })).toBeTruthy();
  expect(ipc.invoke.mock.calls.some(([name]) => name === "setup_models")).toBe(false);
  expect(complete).not.toHaveBeenCalled(); expect(screen.queryByText("Ergebnis des Hardwaretests")).toBeNull();
});

it("starts native selection at the edited path and preserves text after cancellation or denied access", async () => {
  const ready = vi.fn(); mount(setupFixture, ready);
  await waitFor(() => expect(ready).toHaveBeenCalledOnce());
  const path = screen.getByRole("textbox", { name: /Modellordner/ }) as HTMLInputElement;
  fireEvent.change(path, { target: { value: "  /other/models  " } });
  ipc.open.mockResolvedValueOnce(null);
  fireEvent.click(screen.getByRole("button", { name: "Auswählen… Modellordner" }));
  await waitFor(() => expect(ipc.open).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: "/other/models" })));
  expect(path.value).toBe("  /other/models  ");
  const invoke = ipc.invoke.getMockImplementation()!;
  ipc.open.mockResolvedValueOnce("/denied");
  ipc.invoke.mockImplementation(async (name, args) => { if (name === "remember_folder") throw new Error("path_access"); return invoke(name, args); });
  fireEvent.click(screen.getByRole("button", { name: "Auswählen… Modellordner" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(path.value).toBe("  /other/models  ");
});

it("re-estimates a destination repaired by the import workflow", async () => {
  const onImport = vi.fn(), ready = vi.fn(); mount(setupFixture, ready, { onImport });
  await waitFor(() => expect(ready).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Bestehende Bibliothek übernehmen" }));
  expect(onImport).toHaveBeenCalledWith("/songs", expect.any(Function));
  act(() => { onImport.mock.calls[0][1]("/repaired"); });
  expect((screen.getByRole("textbox", { name: /Song-Ordner/ }) as HTMLInputElement).value).toBe("/repaired");
  expect(screen.getByText("Bibliothek übernommen")).toBeTruthy();
  await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith("setup_estimate", { request: expect.objectContaining({ songs_dir: "/repaired" }) }));
});

it.each(["cpu", "unknown"] as const)("keeps %s guidance and CUDA compatibility translated together", async device => {
  const invoke = ipc.invoke.getMockImplementation()!;
  ipc.invoke.mockImplementation(async (name, args) => name === "generation_policy" ? { backend: device } : invoke(name, args));
  mount({ ...setupFixture, hardware: { ...setupFixture.hardware, cuda: { minimum_compute_capability: "7.5", architecture_supported: false }, nvidia: { compute_capability: "6.1", driver_version: "580" } } });
  await next();
  expect(await screen.findByText(/Compute Capability ≥ 7.5/)).toBeTruthy();
  expect(await screen.findByText(device === "cpu" ? /Klangerzeugung läuft auf der CPU/ : /Rechengerät der Klangerzeugung konnte nicht ermittelt werden/)).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox", { name: "Sprache" }), { target: { value: "en" } });
  expect(screen.getByText(/Compute capability ≥ 7.5/)).toBeTruthy();
});

it("translates the measured result while keeping the explicit studio transition", async () => {
  const ready = vi.fn(); mount(setupFixture, ready);
  await waitFor(() => expect(ready).toHaveBeenCalledOnce());
  await reviewSetup();
  fireEvent.click(screen.getByRole("button", { name: "Modelle laden und testen" }));
  await screen.findByText("Sprachmodell: Vulkan · Vulkan0");
  fireEvent.change(screen.getByRole("combobox", { name: "Sprache" }), { target: { value: "en" } });
  expect(screen.getByText("Sound generation: Not confirmed yet")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Go to studio" })).toBeTruthy();
});

it("announces cancellation, preserves selections and allows a translated retry", async () => {
  const original=ipc.invoke.getMockImplementation()!;
  let rejectSetup!:(error:unknown)=>void;
  let attempts=0;
  ipc.invoke.mockImplementation(async(name,args)=>{
    if(name==="setup_models"&&attempts++===0)return new Promise((_,reject)=>{rejectSetup=reject;});
    if(name==="cancel_setup"){rejectSetup("Operation cancelled");return;}
    return original(name,args);
  });
  const ready=vi.fn();mount(setupFixture,ready);
  await waitFor(()=>expect(ready).toHaveBeenCalledOnce());
  await reviewSetup();
  fireEvent.click(screen.getByRole("button",{name:"Modelle laden und testen"}));
  await waitFor(() => expect((screen.getByRole("button", { name: "Zurück" }) as HTMLButtonElement).disabled).toBe(true));
  fireEvent.click(await screen.findByRole("button",{name:"Abbrechen"}));
  const message=await screen.findByText(/Einrichtung abgebrochen/);
  expect(message.getAttribute("role")).toBe("status");expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Zurück" }));
  fireEvent.click(screen.getByRole("button", { name: "Zurück" }));
  expect((screen.getByRole("textbox", { name: /Modellordner/ }) as HTMLInputElement).value).toBe(setupFixture.settings.models_dir);
  await reviewSetup();
  fireEvent.change(screen.getByRole("combobox",{name:"Sprache"}),{target:{value:"en"}});
  expect(screen.getByText(/Setup cancelled/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Download models and test"}));
  await screen.findByRole("button",{name:"Go to studio"});
  expect(screen.queryByText(/Setup cancelled/)).toBeNull();
  const requests=ipc.invoke.mock.calls.filter(([name])=>name==="setup_models");
  expect(requests[1][1]).toEqual(requests[0][1]);
});

it("does not preselect an additional XL download just because XL files exist on a 6 GiB GPU", async () => {
  const bootstrap:Bootstrap={...setupFixture,settings:{...setupFixture.settings,dit_xl_available:true},hardware:{...setupFixture.hardware,platform:"windows",gpu:"NVIDIA GTX 1060",cpu_only:false,vram_bytes:6*1024**3},recommended_profiles:[...setupFixture.recommended_profiles,{...setupFixture.recommended_profiles[0],synthesis:"acestep-v15-xl-sft-Q8_0.gguf"}]};
  const ready=vi.fn();mount(bootstrap,ready);
  await waitFor(()=>expect(ready).toHaveBeenCalledOnce());
  await next();
  const xl=screen.getByRole("checkbox",{name:"XL-Klangmodell zusätzlich laden"}) as HTMLInputElement;
  expect(xl.checked).toBe(false);
  expect(ipc.invoke).toHaveBeenCalledWith("setup_estimate",{request:expect.objectContaining({xl:false})});
  fireEvent.click(xl);expect(xl.checked).toBe(true);
  await waitFor(()=>expect(ipc.invoke).toHaveBeenCalledWith("setup_estimate",{request:expect.objectContaining({xl:true})}));
});

it("restores an explicitly selected XL profile when managing models", async () => {
  const ready=vi.fn();mount({...setupFixture,needs_setup:false,settings:{...setupFixture.settings,dit:"xl",synthesis_model:"acestep-v15-xl-sft-Q8_0.gguf"},recommended_profiles:[{...setupFixture.recommended_profiles[0],synthesis:"acestep-v15-xl-sft-Q8_0.gguf"}]},ready);
  await waitFor(()=>expect(ready).toHaveBeenCalledOnce());
  await next();
  expect((screen.getByRole("checkbox",{name:"XL-Klangmodell zusätzlich laden"}) as HTMLInputElement).checked).toBe(true);
});

it("keeps choices across all three steps and starts only after the explicit final action", async () => {
  const ready = vi.fn();
  mount({ ...setupFixture, settings: { ...setupFixture.settings, expert_mode: true } }, ready);
  await waitFor(() => expect(ready).toHaveBeenCalledOnce());
  const steps = document.querySelectorAll(".setup-steps li");
  expect(steps).toHaveLength(3);
  expect(document.querySelector('[aria-current="step"]')?.textContent).toMatch(/1.*Bibliothek/);
  expect(screen.queryByRole("combobox", { name: /Sprachmodell/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Modelle laden und testen" })).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: /Song-Ordner/ }), { target: { value: "/my-songs" } });
  await next();
  expect(document.querySelector('[aria-current="step"]')?.textContent).toMatch(/2.*Modelle/);
  expect(document.activeElement?.id).toBe("setupStepHeading");
  expect(screen.queryByRole("textbox", { name: /Song-Ordner/ })).toBeNull();
  fireEvent.change(screen.getByRole("combobox", { name: /Sprachmodell/ }), { target: { value: "4B" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "XL-Klangmodell zusätzlich laden" }));
  await next();
  expect(document.querySelector('[aria-current="step"]')?.textContent).toMatch(/3.*Laden/);
  expect(ipc.invoke.mock.calls.some(([name]) => name === "setup_models")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Zurück" }));
  expect((screen.getByRole("combobox", { name: /Sprachmodell/ }) as HTMLSelectElement).value).toBe("4B");
  expect((screen.getByRole("checkbox", { name: "XL-Klangmodell zusätzlich laden" }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Zurück" }));
  expect((screen.getByRole("textbox", { name: /Song-Ordner/ }) as HTMLInputElement).value).toBe("/my-songs");
  await reviewSetup();
  const start = screen.getByRole("button", { name: "Modelle laden und testen" }) as HTMLButtonElement;
  await waitFor(() => expect(start.disabled).toBe(false));
  fireEvent.click(start);
  await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith("setup_models", { request: expect.objectContaining({ songs_dir: "/my-songs", lm: "4B", xl: true }) }));
});


it("keeps the final step usable after a failed setup and retries the same selection", async () => {
  const original = ipc.invoke.getMockImplementation()!;
  let attempts = 0;
  ipc.invoke.mockImplementation(async (name, args) => {
    if (name === "setup_models" && attempts++ === 0) throw new Error("Download failed");
    return original(name, args);
  });
  mount();
  await reviewSetup();
  fireEvent.click(screen.getByRole("button", { name: "Modelle laden und testen" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Download failed");
  expect(document.querySelector('[aria-current="step"]')?.textContent).toMatch(/3.*Laden/);
  expect(screen.queryByRole("button", { name: "Zum Studio" })).toBeNull();
  const retry = screen.getByRole("button", { name: "Modelle laden und testen" }) as HTMLButtonElement;
  await waitFor(() => expect(retry.disabled).toBe(false));
  expect((screen.getByRole("button", { name: "Zurück" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(retry);
  await screen.findByRole("button", { name: "Zum Studio" });
  expect(screen.queryByRole("alert")).toBeNull();
  const requests = ipc.invoke.mock.calls.filter(([name]) => name === "setup_models");
  expect(requests).toHaveLength(2);
  expect(requests[1][1]).toEqual(requests[0][1]);
});
