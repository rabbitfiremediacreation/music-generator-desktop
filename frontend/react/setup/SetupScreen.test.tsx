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
    if (name === "setup_models") return { ok: true, mode: "single", backend_status: measuredBackend };
    if (name === "dialog_directory") return args?.current || "/home/test";
  });
});
afterEach(cleanup);

function mount(bootstrap: Bootstrap = setupFixture, onReady = vi.fn(), props: Partial<SetupScreenProps> = {}) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><I18nProvider><SetupScreen bootstrap={bootstrap} onComplete={() => {}} onReady={onReady} {...props} /></I18nProvider></QueryClientProvider>);
}

it("shows measured setup results until the user explicitly enters the studio", async () => {
  const complete = vi.fn(), ready = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><I18nProvider><SetupScreen bootstrap={setupFixture} onComplete={complete} onReady={ready} /></I18nProvider></QueryClientProvider>);
  await waitFor(() => expect(ready).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Modelle laden und testen" }));
  expect(await screen.findByText("Sprachmodell: Vulkan · Vulkan0")).toBeTruthy();
  expect(screen.getByText("Klangerzeugung: Noch nicht bestätigt")).toBeTruthy();
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
  expect((screen.getByRole("button", { name: "Modelle laden und testen" }) as HTMLButtonElement).disabled).toBe(true);
});

it("restores the saved language model when the wizard opens again in Expert Mode", async () => {
  const ready = vi.fn(); mount(setupFixture, ready);
  await waitFor(() => expect(ready).toHaveBeenCalledOnce());
  expect((screen.getByRole("combobox", { name: /Sprachmodell/ }) as HTMLSelectElement).disabled).toBe(true);
  cleanup();
  mount({ ...setupFixture, settings: { ...setupFixture.settings, expert_mode: true, lm_model: "acestep-5Hz-lm-4B-Q8_0.gguf" } });
  const lm = screen.getByRole("combobox", { name: /Sprachmodell/ }) as HTMLSelectElement;
  expect(lm.value).toBe("4B"); expect(lm.disabled).toBe(false); expect(lm.options).toHaveLength(3);
  await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith("setup_estimate", { request: expect.objectContaining({ lm: "4B" }) }));
});

it("keeps invalid paths editable and reports submission failure without showing a result", async () => {
  const complete = vi.fn(), ready = vi.fn(); mount(setupFixture, ready, { onComplete: complete });
  await waitFor(() => expect(ready).toHaveBeenCalledOnce());
  ipc.invoke.mockRejectedValue(new Error("path_absolute"));
  fireEvent.change(screen.getByRole("textbox", { name: /Song-Ordner/ }), { target: { value: "~/songs" } });
  await waitFor(() => expect(screen.getByText(/absolut/i)).toBeTruthy());
  const button = screen.getByRole("button", { name: "Modelle laden und testen" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.submit(button.closest("form")!);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/absolut/i));
  expect(ipc.invoke).toHaveBeenCalledWith("setup_models", { request: expect.objectContaining({ songs_dir: "~/songs" }) });
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
  expect(await screen.findByText(/Compute Capability ≥ 7.5/)).toBeTruthy();
  expect(await screen.findByText(device === "cpu" ? /Klangerzeugung läuft auf der CPU/ : /Rechengerät der Klangerzeugung konnte nicht ermittelt werden/)).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox", { name: "Sprache" }), { target: { value: "en" } });
  expect(screen.getByText(/Compute capability ≥ 7.5/)).toBeTruthy();
});

it("translates the measured result while keeping the explicit studio transition", async () => {
  const ready = vi.fn(); mount(setupFixture, ready);
  await waitFor(() => expect(ready).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Modelle laden und testen" }));
  await screen.findByText("Sprachmodell: Vulkan · Vulkan0");
  fireEvent.change(screen.getByRole("combobox", { name: "Sprache" }), { target: { value: "en" } });
  expect(screen.getByText("Sound generation: Not confirmed yet")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Go to studio" })).toBeTruthy();
});
