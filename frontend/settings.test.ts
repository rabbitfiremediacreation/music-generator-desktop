// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mountStudio } from "./dom-fixture";
import type { Settings } from "./types";

const mocks = vi.hoisted(() => ({ settings: vi.fn(), saveSettings: vi.fn(), openSongsFolder: vi.fn() }));
vi.mock("./backend", () => ({ backend: mocks }));
vi.mock("./i18n.js", async importOriginal => ({ ...await importOriginal<typeof import("./i18n.js")>(), t: (key: string) => key }));
const initial = { expert_mode: false, cpu_iteration_behavior: "ask", timeout_minutes: 30, songs_dir: "/songs", lm_device: "auto", export_format: "wav", mp3_available: false } as Settings;
const node = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const dialog = () => node<HTMLDialogElement>("settingsDlg");
const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };

beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks(); mountStudio();
  mocks.settings.mockResolvedValue({ ...initial });
  mocks.saveSettings.mockImplementation(async values => ({ ...initial, ...values }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("opens on the first click while loading and ignores additional opening attempts", async () => {
  let resolve!: (settings: Settings) => void;
  mocks.settings.mockImplementation(() => new Promise<Settings>(done => { resolve = done; }));
  const { initializeSettings } = await import("./settings");
  initializeSettings();
  node<HTMLButtonElement>("btnSettings").click();
  expect(dialog().open).toBe(true);
  expect(node<HTMLFieldSetElement>("settingsFields").disabled).toBe(true);
  node<HTMLButtonElement>("btnSettings").click();
  expect(mocks.settings).toHaveBeenCalledOnce();
  resolve(initial); await settle();
  expect(node<HTMLFieldSetElement>("settingsFields").disabled).toBe(false);
  expect(node<HTMLSelectElement>("settingsForm").querySelector<HTMLSelectElement>('[name="lm_device"]')!.value).toBe("auto");
});

it("shows a load failure and lets the user retry without closing the dialog", async () => {
  mocks.settings.mockRejectedValueOnce(new Error("unavailable"));
  const { initializeSettings } = await import("./settings"); initializeSettings();
  node<HTMLButtonElement>("btnSettings").click(); await settle();
  expect(node("settingsStatus").textContent).toBe("settings_load_failed");
  expect(node<HTMLFieldSetElement>("settingsFields").disabled).toBe(true);
  node<HTMLButtonElement>("settingsRetry").click(); await settle();
  expect(node<HTMLFieldSetElement>("settingsFields").disabled).toBe(false);
});

it("saves only the device immediately and keeps it when other draft edits are cancelled", async () => {
  const { initializeSettings } = await import("./settings"); initializeSettings();
  node<HTMLButtonElement>("btnSettings").click(); await settle();
  const form = node<HTMLFormElement>("settingsForm");
  (form.elements.namedItem("timeout_minutes") as HTMLInputElement).value = "45";
  (form.elements.namedItem("cpu_iteration_behavior") as HTMLSelectElement).value = "continue";
  const device = form.elements.namedItem("lm_device") as HTMLSelectElement;
  device.value = "cpu"; device.dispatchEvent(new Event("change", { bubbles: true })); await settle();
  expect(mocks.saveSettings).toHaveBeenCalledWith({ lm_device: "cpu" });
  expect(node("settingsStatus").textContent).toBe("settings_device_saved");
  dialog().close("cancel"); await settle();
  expect(mocks.saveSettings).toHaveBeenCalledOnce();
});

it("blocks generation until a device write completes even after cancelling the dialog", async () => {
  let finish!: (settings: Settings) => void;
  mocks.saveSettings.mockImplementationOnce(() => new Promise<Settings>(resolve => { finish = resolve; }));
  const { initializeSettings } = await import("./settings");
  const controller = initializeSettings();
  node<HTMLButtonElement>("btnSettings").click(); await settle();
  const device = node<HTMLFormElement>("settingsForm").elements.namedItem("lm_device") as HTMLSelectElement;
  device.value = "cpu"; device.dispatchEvent(new Event("change", { bubbles: true })); await settle();
  dialog().close("cancel"); await settle();
  expect(controller.blocksGeneration()).toBe(true);
  expect(controller.isSaving()).toBe(true);
  finish({ ...initial, lm_device: "cpu" }); await settle();
  expect(controller.blocksGeneration()).toBe(false);
  expect(controller.isSaving()).toBe(false);
});

it("restores and saves the CPU iteration preference through the extracted settings dialog", async () => {
  mocks.settings.mockResolvedValue({ ...initial, cpu_iteration_behavior: "continue" });
  const { initializeSettings } = await import("./settings"); initializeSettings();
  node<HTMLButtonElement>("btnSettings").click(); await settle();
  const behavior = node<HTMLFormElement>("settingsForm").elements.namedItem("cpu_iteration_behavior") as HTMLSelectElement;
  expect(behavior.value).toBe("continue");
  behavior.value = "limit_30";
  node<HTMLButtonElement>("saveBtn").click(); await settle();
  expect(mocks.saveSettings).toHaveBeenCalledWith({ cpu_iteration_behavior: "limit_30" });
  expect(dialog().open).toBe(false);
});

it("waits for the device save, then saves other draft changes without overwriting it", async () => {
  let resolve!: (settings: Settings) => void;
  mocks.saveSettings.mockImplementationOnce(() => new Promise<Settings>(done => { resolve = done; }));
  const changed = vi.fn();
  const { initializeSettings } = await import("./settings"); initializeSettings(changed);
  node<HTMLButtonElement>("btnSettings").click(); await settle();
  const form = node<HTMLFormElement>("settingsForm");
  const device = form.elements.namedItem("lm_device") as HTMLSelectElement;
  device.value = "cpu"; device.dispatchEvent(new Event("change", { bubbles: true })); await settle();
  expect(device.disabled).toBe(true);
  expect(node<HTMLButtonElement>("saveBtn").disabled).toBe(true);
  (form.elements.namedItem("timeout_minutes") as HTMLInputElement).value = "45";
  resolve({ ...initial, lm_device: "cpu" }); await settle();
  node<HTMLButtonElement>("saveBtn").click(); await settle();
  expect(mocks.saveSettings).toHaveBeenLastCalledWith({ timeout_minutes: 45 });
  expect(dialog().open).toBe(false);
  expect(changed).toHaveBeenCalledOnce();
});

it("restores the confirmed device on failure and supports switching back to automatic", async () => {
  const { initializeSettings } = await import("./settings"); initializeSettings();
  node<HTMLButtonElement>("btnSettings").click(); await settle();
  const device = node<HTMLFormElement>("settingsForm").elements.namedItem("lm_device") as HTMLSelectElement;
  mocks.saveSettings.mockRejectedValueOnce(new Error("busy"));
  device.value = "cpu"; device.dispatchEvent(new Event("change", { bubbles: true })); await settle();
  expect(device.value).toBe("auto");
  expect(node("settingsStatus").textContent).toBe("settings_device_failed");
  device.value = "cpu"; device.dispatchEvent(new Event("change", { bubbles: true })); await settle();
  device.value = "auto"; device.dispatchEvent(new Event("change", { bubbles: true })); await settle();
  expect(mocks.saveSettings).toHaveBeenLastCalledWith({ lm_device: "auto" });
});

it("does not let an old device reply overwrite a reopened dialog", async () => {
  let resolve!: (settings: Settings) => void;
  mocks.saveSettings.mockImplementationOnce(() => new Promise<Settings>(done => { resolve = done; }));
  const { initializeSettings } = await import("./settings"); initializeSettings();
  node<HTMLButtonElement>("btnSettings").click(); await settle();
  const device = node<HTMLFormElement>("settingsForm").elements.namedItem("lm_device") as HTMLSelectElement;
  device.value = "cpu"; device.dispatchEvent(new Event("change", { bubbles: true })); await settle();
  dialog().close("cancel"); await settle();
  node<HTMLButtonElement>("btnSettings").click(); await settle();
  // A reopened dialog must wait for the accepted save before loading its snapshot.
  expect(node<HTMLFieldSetElement>("settingsFields").disabled).toBe(true);
  mocks.settings.mockResolvedValue({ ...initial, lm_device: "cpu" });
  resolve({ ...initial, lm_device: "cpu" }); await settle();
  expect(device.value).toBe("cpu");
  expect(node<HTMLFieldSetElement>("settingsFields").disabled).toBe(false);
});

it("keeps failed form edits visible and supports keyboard-style submit and escape", async () => {
  const { initializeSettings } = await import("./settings"); initializeSettings();
  node<HTMLButtonElement>("btnSettings").click(); await settle();
  const form = node<HTMLFormElement>("settingsForm");
  const timeout = form.elements.namedItem("timeout_minutes") as HTMLInputElement;
  timeout.value = "45";
  mocks.saveSettings.mockRejectedValueOnce(new Error("busy"));
  form.requestSubmit(node<HTMLButtonElement>("saveBtn")); await settle();
  expect(dialog().open).toBe(true);
  expect(timeout.value).toBe("45");
  expect(node("settingsSaveError").textContent).toBe("error: busy");
  expect(node<HTMLButtonElement>("saveBtn").disabled).toBe(false);
  // The native dialog's Escape default closes it; no form submit is involved.
  dialog().dispatchEvent(new Event("cancel")); dialog().close(); await settle();
  expect(mocks.saveSettings).toHaveBeenCalledOnce();
});

it("opens the song folder from the settings dialog and reports a failure without closing it", async () => {
  mocks.openSongsFolder.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("missing"));
  const { initializeSettings } = await import("./settings"); initializeSettings();
  node<HTMLButtonElement>("btnSettings").click(); await settle();
  node<HTMLButtonElement>("settingsOpenSongs").click(); await settle();
  expect(mocks.openSongsFolder).toHaveBeenCalledOnce();
  expect(node("settingsStatus").textContent).toBe("");
  node<HTMLButtonElement>("settingsOpenSongs").click(); await settle();
  expect(node("settingsStatus").textContent).toBe("settings_open_folder_failed");
  expect(dialog().open).toBe(true);
});
