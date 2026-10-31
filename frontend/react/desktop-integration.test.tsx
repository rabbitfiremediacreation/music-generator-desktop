// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryHistory } from "@tanstack/react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import source from "../../models/catalog.json";
import { DesktopApp, createAppRouter } from "./app";
import { createAppQueryClient } from "./data";
import { setupFixture, standard } from "./setup/fixtures";
import { setLang, t } from "../i18n.js";
import type { BackendStatus, GenerationFormPreferences, Settings, SettingsPatch, Song } from "../types";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), nativeClose: vi.fn(), offNative: vi.fn(), confirm: vi.fn(), saveSettings: vi.fn(), savePreferences: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, convertFileSrc: (path: string) => path }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ onCloseRequested: mocks.nativeClose, minimize: vi.fn(), toggleMaximize: vi.fn() }) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: mocks.confirm, open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const handlers = new Map<string, (event: { payload?: unknown }) => void>();
const defaults: GenerationFormPreferences = { duration: 90, bpm: 0, inference_steps: 30, lm_temperature: 1.2, variants: 2 };
const observed: BackendStatus = { state: "running", synthesis: { state: "confirmed", backend: "metal", device: "MTL0", reason: null }, language_model: { state: "confirmed", backend: "cpu", device: "CPU", reason: "cpu_requested" } };
let settings: Settings;
let backendStatus: BackendStatus;
let queueActive = false;
const songs: Song[] = (["done", "error"] as const).map(status => ({ id: status, group_id: status, title: `${status} song`, caption: "A saved song", letter: "A", created_at: "2026-10-27T10:00:00Z", finished_at: null, status, message: null, lyrics: "[Instrumental]", seed: 42, params: { prompt: "A saved song", duration: 30, inference_steps: 30, model_selection: standard }, result_meta: null, file: status === "done" ? "done.wav" : null, audio_missing: false, favorite: false, folder_id: null, path: status === "done" ? "/songs/done.wav" : null }));
const calls = (command: string) => mocks.invoke.mock.calls.filter(([name]) => name === command);
beforeEach(() => {
  vi.resetAllMocks(); handlers.clear(); localStorage.clear(); setLang("en");
  settings = { ...setupFixture.settings, setup_complete: true, recommended_profiles: [standard] };
  backendStatus = structuredClone(observed); queueActive = false;
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  mocks.confirm.mockResolvedValue(true); mocks.savePreferences.mockResolvedValue(undefined);
  mocks.nativeClose.mockResolvedValue(mocks.offNative);
  mocks.listen.mockImplementation(async (name, handler) => { handlers.set(name, handler); return () => { if (handlers.get(name) === handler) handlers.delete(name); }; });
  mocks.saveSettings.mockImplementation(async (values: SettingsPatch) => { settings = { ...settings, ...values }; return { ...settings }; });
  mocks.invoke.mockImplementation(async (name, args) => {
    if (name === "bootstrap") return { ...setupFixture, needs_setup: false, settings };
    if (name === "get_settings") return { ...settings };
    if (name === "save_settings") return mocks.saveSettings(args.values);
    if (name === "generation_policy") return { backend: "gpu", detected_backend: "metal", cpu_iteration_behavior: "ask", recommended_steps: 80, defaults };
    if (name === "get_generation_form_preferences") return { ...defaults };
    if (name === "save_generation_form_preferences") return mocks.savePreferences(args.values);
    if (name === "list_songs") return songs;
    if (name === "list_folders") return { folders: [], all: 2, none: 2 };
    if (name === "queue") return { running: queueActive ? [{ id: "active", caption: "A song", message: null }] : [], queued: 0, active: queueActive, progress: null, library: { count: 2, bytes: 100 } };
    if (name === "health") return { ok: true, backend_status: backendStatus };
    if (name === "generate") return { ids: ["new"] };
    if (name === "retry_song") return songs[1];
    if (name === "model_catalog") return { ...source, expert_mode: false, selection: standard, recommended_profiles: [standard], hardware: setupFixture.hardware, free_bytes: null, models_dir: "/models", busy: false, title_model: { ...setupFixture.title_model, verified: true, present: true, partial_bytes: 0 }, models: source.models.map(model => ({ ...model, verified: true, present: true, partial_bytes: 0 })) };
    if (name === "select_models" || name === "use_models") return args.selection;
    if (name === "startup_show_main" || name === "startup_complete" || name === "exit_app") return undefined;
    throw new Error(`Unexpected command ${name}`);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function mount() {
  const client = createAppQueryClient();
  const router = createAppRouter(client, createMemoryHistory({ initialEntries: ["/studio"] }));
  const view = render(<DesktopApp client={client} router={router} />);
  const prompt = await screen.findByRole("textbox", { name: "Prompt" });
  await waitFor(() => expect((prompt as HTMLTextAreaElement).disabled).toBe(false));
  await waitFor(() => expect(calls("startup_complete")).toHaveLength(1));
  // Happy DOM incorrectly reports stepMismatch for the valid temperature 1.2 / 0.05.
  prompt.closest("form")!.noValidate = true;
  return { ...view, router, prompt, form: prompt.closest("form")! };
}
async function attemptAll(form: HTMLFormElement) {
  fireEvent.submit(form);
  fireEvent.keyDown(document, { code: "KeyG", key: "g", altKey: true });
  fireEvent.click(within(screen.getByText("done song A").closest("article")!).getByRole("button", { name: t("more") }));
  fireEvent.click(within(screen.getByText("error song A").closest("article")!).getByRole("button", { name: t("retry") }));
  await act(async () => { await Promise.resolve(); });
}
it("blocks all generation entrypoints in Settings and releases them after Cancel", async () => {
  const { form } = await mount();
  fireEvent.click(screen.getByRole("button", { name: t("settings_title") }));
  await screen.findByRole("dialog"); await attemptAll(form);
  expect(calls("generate")).toHaveLength(0); expect(calls("retry_song")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: t("cancel") }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.submit(form);
  await waitFor(() => expect(calls("generate")).toHaveLength(1));
});
it("keeps every generation entrypoint blocked after closing a pending device save", async () => {
  let finish!: (value: Settings) => void;
  mocks.saveSettings.mockImplementationOnce(() => new Promise<Settings>(resolve => { finish = resolve; }));
  const { form } = await mount();
  fireEvent.click(screen.getByRole("button", { name: t("settings_title") }));
  fireEvent.change(await screen.findByRole("combobox", { name: t("lm_dev") }), { target: { value: "cpu" } });
  await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: t("cancel") }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await attemptAll(form);
  expect(calls("generate")).toHaveLength(0); expect(calls("retry_song")).toHaveLength(0);
  await act(async () => { settings = { ...settings, lm_device: "cpu" }; finish(settings); });
  await waitFor(() => expect((within(form).getByRole("button", { name: t("generate_n", 2) }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.keyDown(document, { code: "KeyG", key: "g", altKey: true });
  await waitFor(() => expect(calls("generate")).toHaveLength(1));
});
it("flushes the newest numeric edits before native exit and cleans up close subscriptions", async () => {
  let finish!: () => void;
  mocks.savePreferences.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const view = await mount();
  fireEvent.change(within(view.form).getByRole("slider", { name: t("length") }), { target: { value: "600" } });
  await waitFor(() => expect(mocks.savePreferences).toHaveBeenCalledTimes(1));
  fireEvent.change(within(view.form).getByRole("slider", { name: t("versions") }), { target: { value: "9" } });
  const closeEvent = { preventDefault: vi.fn() };
  await act(async () => { mocks.nativeClose.mock.calls[0][0](closeEvent); });
  expect(closeEvent.preventDefault).toHaveBeenCalledTimes(1);
  expect(calls("exit_app")).toHaveLength(0);
  expect(view.form.closest("[inert]")).not.toBeNull();
  await act(async () => finish());
  await waitFor(() => expect(calls("exit_app")).toHaveLength(1));
  expect(mocks.savePreferences).toHaveBeenLastCalledWith({ ...defaults, duration: 600, variants: 9 });
  expect(calls("get_generation_form_preferences")).toHaveLength(1);
  expect(mocks.nativeClose).toHaveBeenCalledTimes(1);
  view.unmount(); expect(mocks.offNative).toHaveBeenCalledTimes(1); expect(handlers.has("request-exit")).toBe(false);
});
it("retries failed preferences when request-exit arrives and permits exit after storage failure", async () => {
  await mount(); mocks.savePreferences.mockRejectedValue(new Error("Disk full"));
  fireEvent.change(screen.getByRole("slider", { name: t("versions") }), { target: { value: "9" } });
  await waitFor(() => expect(mocks.savePreferences).toHaveBeenCalledTimes(1));
  await act(async () => handlers.get("request-exit")!({}));
  await waitFor(() => expect(calls("exit_app")).toHaveLength(1));
  expect(mocks.savePreferences).toHaveBeenCalledTimes(2);
});
it("keeps the studio editable when busy-exit confirmation is declined", async () => {
  const { prompt, form } = await mount(); queueActive = true; mocks.confirm.mockResolvedValue(false);
  await act(async () => handlers.get("request-exit")!({}));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
  expect(calls("exit_app")).toHaveLength(0); expect(form.inert).toBe(false);
  fireEvent.change(prompt, { target: { value: "Still editable" } });
  expect((prompt as HTMLTextAreaElement).value).toBe("Still editable");
});
it("keeps detected synthesis availability separate from selected LM device and observed execution", async () => {
  settings.lm_device = "cpu";
  backendStatus = { ...observed, state: "not_started", synthesis: { ...observed.synthesis, state: "not_started", backend: "unknown", device: null } };
  await mount();
  const chip = await screen.findByRole("group", { name: new RegExp(`${t("backend_synthesis")}: Metal`) });
  expect(chip.getAttribute("data-evidence")).toBe("available"); expect(chip.getAttribute("title")).toContain(t("lm_dev_cpu"));
  backendStatus = structuredClone(observed);
  await act(async () => handlers.get("settings-changed")!({}));
  await waitFor(() => expect(chip.getAttribute("data-evidence")).toBe("observed"));
  expect(chip.getAttribute("title")).toContain(t("backend_observed"));
});
