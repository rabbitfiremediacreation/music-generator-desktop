// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { SettingsDialog } from "./SettingsDialog";
import type { Settings } from "../../types";
import { setLang, t } from "../../i18n.js";

const mocks = vi.hoisted(() => ({ settings: vi.fn(), saveSettings: vi.fn(), checkUpdate: vi.fn(), openSongsFolder: vi.fn(), pickFolder: vi.fn() }));
vi.mock("../../backend", () => ({ backend: mocks }));
vi.mock("../../path-dialogs", () => ({ pickFolder: mocks.pickFolder, pathErrorText: (error: unknown) => String(error) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const settings = { lm_device: "auto", cpu_iteration_behavior: "ask", timeout_minutes: 60, songs_dir: "/songs", export_format: "wav", expert_mode: false, mp3_available: true } as Settings;
const callbacks = { onClose: vi.fn(), onBusyChange: vi.fn(), onManageModels: vi.fn(), onMoveLibrary: vi.fn(), onLayoutChange: vi.fn() };
function view(open = true) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><I18nProvider><SettingsDialog open={open} layout="auto" {...callbacks} /></I18nProvider></QueryClientProvider>;
}
beforeEach(() => {
  vi.clearAllMocks(); setLang("en"); mocks.settings.mockResolvedValue(settings);
  mocks.saveSettings.mockImplementation(async (values: object) => ({ ...settings, ...values }));
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});

it("opens immediately during loading and offers retry after a failed read", async () => {
  mocks.settings.mockRejectedValueOnce(new Error("unavailable"));
  render(view());
  expect(screen.getByRole("dialog")).toBeTruthy();
  const retry = await screen.findByRole("button", { name: t("settings_retry") });
  expect((screen.getByRole("button", { name: t("save") }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(retry);
  await screen.findByRole("spinbutton");
  expect(mocks.settings).toHaveBeenCalledTimes(2);
});

it("keeps generation busy until a cancelled dialog's device write has finished", async () => {
  let finish!: (settings: Settings) => void;
  mocks.saveSettings.mockImplementationOnce(() => new Promise<Settings>(resolve => { finish = resolve; }));
  const mounted = render(view());
  fireEvent.change(await screen.findByRole("combobox", { name: /Language model/i }), { target: { value: "cpu" } });
  await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: t("cancel") }));
  mounted.rerender(view(false));
  expect(callbacks.onBusyChange).toHaveBeenLastCalledWith(true);
  await act(async () => finish({ ...settings, lm_device: "cpu" }));
  await waitFor(() => expect(callbacks.onBusyChange).toHaveBeenLastCalledWith(false));
});

it("restores the confirmed device after failure and allows switching back to automatic", async () => {
  render(view());
  const device = await screen.findByRole("combobox", { name: /Language model/i });
  mocks.saveSettings.mockRejectedValueOnce(new Error("busy"));
  fireEvent.change(device, { target: { value: "cpu" } });
  await screen.findByText(t("settings_device_failed"));
  expect((device as HTMLSelectElement).value).toBe("auto");
  fireEvent.change(device, { target: { value: "cpu" } });
  await screen.findByText(t("settings_device_saved"));
  await waitFor(() => expect((device as HTMLSelectElement).disabled).toBe(false));
  fireEvent.change(device, { target: { value: "auto" } });
  await waitFor(() => expect(mocks.saveSettings).toHaveBeenLastCalledWith({ lm_device: "auto" }));
});

it("waits for an accepted device write before loading a reopened dialog", async () => {
  let finish!: (settings: Settings) => void;
  mocks.saveSettings.mockImplementationOnce(() => new Promise<Settings>(resolve => { finish = resolve; }));
  const mounted = render(view());
  fireEvent.change(await screen.findByRole("combobox", { name: /Language model/i }), { target: { value: "cpu" } });
  await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledTimes(1));
  mounted.rerender(view(false)); mounted.rerender(view());
  expect(screen.queryByRole("combobox", { name: /Language model/i })).toBeNull();
  mocks.settings.mockResolvedValue({ ...settings, lm_device: "cpu" });
  await act(async () => finish({ ...settings, lm_device: "cpu" }));
  const device = await screen.findByRole("combobox", { name: /Language model/i });
  expect((device as HTMLSelectElement).value).toBe("cpu");
});

it("retains failed draft edits, blocks duplicate submissions and supports an explicit retry", async () => {
  let reject!: (error: Error) => void;
  mocks.saveSettings.mockImplementationOnce(() => new Promise<Settings>((_, fail) => { reject = fail; }));
  render(view());
  const timeout = await screen.findByRole("spinbutton");
  fireEvent.change(timeout, { target: { value: "75" } });
  const form = screen.getByRole("button", { name: t("save") }).closest("form")!;
  fireEvent.submit(form); fireEvent.submit(form);
  const cancel = new Event("cancel", { cancelable: true }); screen.getByRole("dialog").dispatchEvent(cancel);
  expect(cancel.defaultPrevented).toBe(true);
  expect(callbacks.onClose).not.toHaveBeenCalled();
  await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledTimes(1));
  await act(async () => reject(new Error("Disk full")));
  await screen.findByRole("alert");
  expect((timeout as HTMLInputElement).value).toBe("75");
  expect(callbacks.onClose).not.toHaveBeenCalled();
  fireEvent.submit(form);
  await waitFor(() => expect(callbacks.onClose).toHaveBeenCalledTimes(1));
  expect(mocks.saveSettings).toHaveBeenLastCalledWith({ timeout_minutes: 75 });
});

it("saves a changed CPU iteration preference and keeps live labels reactive", async () => {
  mocks.settings.mockResolvedValue({ ...settings, cpu_iteration_behavior: "continue" });
  render(view());
  const behavior = await screen.findByRole("combobox", { name: t("cpu_behavior_label") });
  expect((behavior as HTMLSelectElement).value).toBe("continue");
  fireEvent.change(behavior, { target: { value: "limit_30" } });
  await act(async () => setLang("de"));
  expect(screen.getByRole("heading", { name: "Einstellungen" })).toBeTruthy();
  expect((screen.getByRole("combobox", { name: t("cpu_behavior_label") }) as HTMLSelectElement).value).toBe("limit_30");
  fireEvent.submit(screen.getByRole("button", { name: t("save") }).closest("form")!);
  await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledWith({ cpu_iteration_behavior: "limit_30" }));
});

it("discards a native folder reply belonging to a previously closed dialog", async () => {
  let chosen!: (path: string) => void;
  mocks.pickFolder.mockImplementationOnce(() => new Promise<string>(resolve => { chosen = resolve; }));
  const mounted = render(view());
  await screen.findByRole("textbox");
  fireEvent.click(screen.getByText(t("desktop_browse")));
  mounted.rerender(view(false)); mounted.rerender(view());
  const folder = await screen.findByRole("textbox");
  await act(async () => chosen("/old-dialog-choice"));
  expect((folder as HTMLInputElement).value).toBe("/songs");
});
afterEach(cleanup);

it("saves the device immediately while leaving other edits for explicit save", async () => {
  render(view());
  const device = await screen.findByRole("combobox", { name: /Sprachmodell|Language model/i });
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "75" } });
  fireEvent.change(device, { target: { value: "cpu" } });
  await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledWith({ lm_device: "cpu" }));
  expect(mocks.saveSettings).toHaveBeenCalledTimes(1);
  await waitFor(() => expect((device as HTMLSelectElement).disabled).toBe(false));
  fireEvent.submit(screen.getByRole("button", { name: /^Speichern$|^Save$/i }).closest("form")!);
  await waitFor(() => expect(mocks.saveSettings).toHaveBeenLastCalledWith({ timeout_minutes: 75 }));
  await waitFor(() => expect(callbacks.onClose).toHaveBeenCalledTimes(1));
});

it("opens the configured song folder and reports failure without closing the dialog", async () => {
  mocks.openSongsFolder.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("missing"));
  render(view());
  const button=await screen.findByRole("button",{name:"Open folder"});
  fireEvent.click(button);
  await waitFor(()=>expect(mocks.openSongsFolder).toHaveBeenCalledOnce());
  await waitFor(()=>expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
  expect((await screen.findByRole("alert")).textContent).toBe("Could not open the folder.");
  expect(screen.getByRole("dialog")).toBeTruthy();expect(callbacks.onClose).not.toHaveBeenCalled();
});
