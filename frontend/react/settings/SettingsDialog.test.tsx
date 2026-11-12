// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { SettingsDialog } from "./SettingsDialog";
import type { SettingsPage } from "./SettingsNavigation";
import type { ModelCatalog, Settings } from "../../types";
import { setLang, t } from "../../i18n.js";
import source from "../../../models/catalog.json";
import { setupFixture, standard } from "../setup/fixtures";

const mocks = vi.hoisted(() => ({ settings: vi.fn(), saveSettings: vi.fn(), checkUpdate: vi.fn(), openSongsFolder: vi.fn(), pickFolder: vi.fn(), mcpSettings: vi.fn(), saveMcpSettings: vi.fn(), phoneAccess: vi.fn(), setPhoneAccess: vi.fn(), modelCatalog: vi.fn(), useModels: vi.fn(), downloadTitleModel: vi.fn(), cancelModelDownload: vi.fn(), generationPolicy: vi.fn() }));
vi.mock("../../backend", () => ({ backend: mocks }));
vi.mock("../../path-dialogs", () => ({ pickFolder: mocks.pickFolder, pathErrorText: (error: unknown) => String(error) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const settings = { ...setupFixture.settings, lm_device: "auto", cpu_iteration_behavior: "ask", timeout_minutes: 60, songs_dir: "/songs", export_format: "wav", expert_mode: false, mp3_available: true, recommended_profiles: [standard] } as Settings;
const catalog = { ...source, expert_mode: false, recommended_profiles: [standard], selection: standard, hardware: { ...setupFixture.hardware, ram_bytes: 64 * 1024 ** 3 }, free_bytes: null, models_dir: "/models", busy: false,
  title_model: { ...setupFixture.title_model, verified: true, present: true, partial_bytes: 0 },
  models: source.models.map(model => ({ ...model, verified: true, present: true, partial_bytes: 0 })),
} as ModelCatalog;
const callbacks = { onClose: vi.fn(), onBusyChange: vi.fn(), onMoveLibrary: vi.fn(), onLayoutChange: vi.fn() };
const modelCallbacks = { onUse: vi.fn(), onManage: vi.fn(), onRecommendedSteps: vi.fn() };
function view(open = true, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return <QueryClientProvider client={client}><I18nProvider><SettingsDialog open={open} layout="auto" modelManager={{ selection: standard, currentSelection: standard, selectionRevision: 1, ...modelCallbacks }} {...callbacks} /></I18nProvider></QueryClientProvider>;
}
function goTo(page: SettingsPage) {
  fireEvent.click(screen.getByRole("button", { name: t(`settings_page_${page}`) }));
}
beforeEach(() => {
  vi.clearAllMocks(); setLang("en"); mocks.settings.mockResolvedValue(settings);
  mocks.phoneAccess.mockResolvedValue({ enabled: false, port: 8767, token: "", addresses: [] });
  mocks.mcpSettings.mockResolvedValue({ enabled: false, port: 0, scope: "local", urls: [], running: false, url: null, config_path: "/data/mcp.json", client_config: "{}", managed_by_environment: false, error: null });
  mocks.saveSettings.mockImplementation(async (values: object) => ({ ...settings, ...values }));
  mocks.modelCatalog.mockResolvedValue(structuredClone(catalog));
  mocks.useModels.mockImplementation(async selection => selection);
  mocks.downloadTitleModel.mockResolvedValue(undefined);
  mocks.generationPolicy.mockResolvedValue({ recommended_steps: 30 });
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

it.each([["de", "Modelle und Hardware"], ["en", "Models and hardware"]])("offers a separate models and hardware page in %s without saving the settings draft", async (language, label) => {
  setLang(language);
  render(view());
  fireEvent.change(await screen.findByRole("spinbutton"), { target: { value: "75" } });
  const buttons = screen.getAllByRole("button", { name: label });
  expect(buttons).toHaveLength(1);
  expect(screen.queryByRole("button", { name: t("desktop_manage") })).toBeNull();
  fireEvent.click(buttons[0]);
  expect(screen.getByRole("heading", { name: label })).toBeTruthy();
  expect(screen.getByRole("combobox", { name: t("lm_dev") })).toBeTruthy();
  expect(screen.getByRole("checkbox", { name: t("expert_mode") })).toBeTruthy();
  expect(screen.queryByRole("spinbutton")).toBeNull();
  expect(callbacks.onClose).not.toHaveBeenCalled();
  expect(await screen.findByRole("table")).toBeTruthy();
  expect(screen.queryByRole("searchbox")).toBeNull();
  expect(screen.queryByRole("button", { name: t("picker_choose") })).toBeNull();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: t("models_add") }));
  const catalogDialog = await screen.findByRole("dialog", { name: t("models_add") });
  fireEvent.click(await within(catalogDialog).findByRole("button", { name: t("picker_use") }));
  await waitFor(() => expect(modelCallbacks.onUse).toHaveBeenCalledWith(standard, 1));
  expect(callbacks.onClose).not.toHaveBeenCalled();
  expect(mocks.saveSettings).not.toHaveBeenCalled();
});

it("keeps generation busy until a cancelled dialog's device write has finished", async () => {
  let finish!: (settings: Settings) => void;
  mocks.saveSettings.mockImplementationOnce(() => new Promise<Settings>(resolve => { finish = resolve; }));
  const mounted = render(view());
  goTo("models");
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
  goTo("models");
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
  goTo("models");
  fireEvent.change(await screen.findByRole("combobox", { name: /Language model/i }), { target: { value: "cpu" } });
  await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledTimes(1));
  mounted.rerender(view(false)); mounted.rerender(view());
  goTo("models");
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
  goTo("library");
  await screen.findByDisplayValue("/songs");
  fireEvent.click(screen.getByText(t("desktop_browse")));
  mounted.rerender(view(false)); mounted.rerender(view());
  goTo("library");
  const folder = await screen.findByDisplayValue("/songs");
  await act(async () => chosen("/old-dialog-choice"));
  expect((folder as HTMLInputElement).value).toBe("/songs");
});
afterEach(cleanup);

it("saves the device immediately while leaving other edits for explicit save", async () => {
  render(view());
  fireEvent.change(await screen.findByRole("spinbutton"), { target: { value: "75" } });
  goTo("models");
  const device = await screen.findByRole("combobox", { name: /Sprachmodell|Language model/i });
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
  goTo("library");
  const button=await screen.findByRole("button",{name:"Open folder"});
  fireEvent.click(button);
  await waitFor(()=>expect(mocks.openSongsFolder).toHaveBeenCalledOnce());
  await waitFor(()=>expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
  expect((await screen.findByRole("alert")).textContent).toBe("Could not open the folder.");
  expect(screen.getByRole("dialog")).toBeTruthy();expect(callbacks.onClose).not.toHaveBeenCalled();
});

it("dismisses with Escape from an edited field without saving the draft", async () => {
  render(view());
  const timeout = await screen.findByRole("spinbutton");
  fireEvent.change(timeout, {target:{value:"75"}});
  fireEvent.keyDown(timeout, {key:"Escape",code:"Escape"});
  expect(callbacks.onClose).toHaveBeenCalledOnce();
  expect(mocks.saveSettings).not.toHaveBeenCalled();
});

it("dismisses on a backdrop click but ignores padding and a drag starting inside", async () => {
  render(view());await screen.findByRole("spinbutton");
  const dialog=screen.getByRole("dialog");
  vi.spyOn(dialog,"getBoundingClientRect").mockReturnValue({left:100,right:500,top:100,bottom:600} as DOMRect);
  fireEvent.pointerDown(dialog,{clientX:110,clientY:110});fireEvent.click(dialog,{clientX:110,clientY:110});
  fireEvent.pointerDown(dialog,{clientX:110,clientY:110});fireEvent.click(dialog,{clientX:10,clientY:10});
  expect(callbacks.onClose).not.toHaveBeenCalled();
  fireEvent.pointerDown(dialog,{clientX:10,clientY:10});fireEvent.click(dialog,{clientX:10,clientY:10});
  expect(callbacks.onClose).toHaveBeenCalledOnce();expect(mocks.saveSettings).not.toHaveBeenCalled();
});

it("blocks Escape, native cancel and backdrop dismissal while a settings save is running", async () => {
  let finish!:(value:Settings)=>void;
  mocks.saveSettings.mockImplementationOnce(()=>new Promise<Settings>(resolve=>{finish=resolve;}));
  render(view());const timeout=await screen.findByRole("spinbutton");
  fireEvent.change(timeout,{target:{value:"75"}});
  fireEvent.submit(screen.getByRole("button",{name:t("save")}).closest("form")!);
  await waitFor(()=>expect(finish).toBeTypeOf("function"));
  const dialog=screen.getByRole("dialog");
  vi.spyOn(dialog,"getBoundingClientRect").mockReturnValue({left:100,right:500,top:100,bottom:600} as DOMRect);
  fireEvent.keyDown(timeout,{key:"Escape",code:"Escape"});
  fireEvent(dialog,new Event("cancel",{cancelable:true}));
  fireEvent.pointerDown(dialog,{clientX:10,clientY:10});fireEvent.click(dialog,{clientX:10,clientY:10});
  expect(callbacks.onClose).not.toHaveBeenCalled();
  await act(async()=>finish({...settings,timeout_minutes:75}));
  await waitFor(()=>expect(callbacks.onClose).toHaveBeenCalledOnce());
});

it("keeps MCP application separate from other draft settings and blocks dismissal while it is pending", async () => {
  let finish!: (value: object) => void;
  mocks.saveMcpSettings.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(view());
  const timeout = await screen.findByRole("spinbutton");
  fireEvent.change(timeout, { target: { value: "75" } });
  goTo("mcp");
  fireEvent.click(await screen.findByRole("checkbox", { name: t("mcp_enable") }));
  fireEvent.click(screen.getByRole("button", { name: t("mcp_apply") }));
  await waitFor(() => expect(mocks.saveMcpSettings).toHaveBeenCalledWith({ enabled: true, port: 0, scope: "local" }));
  fireEvent.keyDown(timeout, { key: "Escape" });
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
  fireEvent.submit(screen.getByRole("button", { name: t("save") }).closest("form")!);
  expect(callbacks.onClose).not.toHaveBeenCalled();
  expect(mocks.saveSettings).not.toHaveBeenCalled();
  await act(async () => finish({ enabled: true, port: 0, scope: "local", urls: [], running: true, url: "http://127.0.0.1:32123/mcp", config_path: "/data/mcp.json", client_config: "{}", managed_by_environment: false, error: null }));
  expect((timeout as HTMLInputElement).value).toBe("75");
  fireEvent.submit(screen.getByRole("button", { name: t("save") }).closest("form")!);
  await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledWith({ timeout_minutes: 75 }));
  expect(mocks.saveMcpSettings).toHaveBeenCalledTimes(1);
});

it("does not save an unapplied MCP draft when the other settings are saved", async () => {
  render(view()); await screen.findByRole("spinbutton");
  goTo("mcp");
  fireEvent.click(await screen.findByRole("checkbox", { name: t("mcp_enable") }));
  fireEvent.change(screen.getByRole("textbox", { name: t("mcp_port") }), { target: { value: "bad port" } });
  fireEvent.submit(screen.getByRole("button", { name: t("save") }).closest("form")!);
  await waitFor(() => expect(callbacks.onClose).toHaveBeenCalledOnce());
  expect(mocks.saveMcpSettings).not.toHaveBeenCalled();
});

it("applies MCP from the port field with Enter without submitting the outer settings form", async () => {
  mocks.saveMcpSettings.mockResolvedValue({ enabled: true, port: 32123, scope: "local", urls: ["http://127.0.0.1:32123/mcp"], running: true, url: "http://127.0.0.1:32123/mcp", config_path: "/data/mcp.json", client_config: "{}", managed_by_environment: false, error: null });
  render(view()); await screen.findByRole("spinbutton");
  goTo("mcp");
  fireEvent.click(await screen.findByRole("checkbox", { name: t("mcp_enable") }));
  const input = screen.getByRole("textbox", { name: t("mcp_port") });
  fireEvent.change(input, { target: { value: "32123" } });
  const key = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  fireEvent(input, key);
  expect(key.defaultPrevented).toBe(true);
  await waitFor(() => expect(mocks.saveMcpSettings).toHaveBeenCalledWith({ enabled: true, port: 32123, scope: "local" }));
  expect(mocks.saveSettings).not.toHaveBeenCalled();
  expect(callbacks.onClose).not.toHaveBeenCalled();
});

it("shows one settings page at a time and marks the selected navigation entry", async () => {
  render(view());
  await screen.findByRole("spinbutton");
  const navigation = screen.getByRole("navigation", { name: t("settings_title") });
  expect(navigation.querySelectorAll("button")).toHaveLength(7);
  expect(screen.getByRole("button", { name: t("settings_page_generation") }).getAttribute("aria-current")).toBe("page");
  expect(screen.queryByRole("button", { name: t("settings_open_folder") })).toBeNull();
  expect(screen.queryByRole("switch", { name: t("remote") })).toBeNull();
  expect(screen.queryByRole("combobox", { name: t("lm_dev") })).toBeNull();
  expect(screen.queryByRole("checkbox", { name: t("expert_mode") })).toBeNull();
  goTo("phone");
  expect(screen.getByRole("switch", { name: t("remote") })).toBeTruthy();
  expect(screen.queryByRole("spinbutton")).toBeNull();
  expect(screen.getByRole("button", { name: t("settings_page_phone") }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("button", { name: t("settings_page_generation") }).hasAttribute("aria-current")).toBe(false);
  expect(screen.getByRole("button", { name: t("save") })).toBeTruthy();
});

it("preserves edits across pages and saves the shared draft from any page", async () => {
  render(view());
  fireEvent.change(await screen.findByRole("spinbutton"), { target: { value: "75" } });
  expect(screen.getByText(t("settings_unsaved"))).toBeTruthy();
  goTo("library");
  fireEvent.change(screen.getByRole("combobox", { name: t("exp") }), { target: { value: "mp3" } });
  goTo("models");
  fireEvent.click(screen.getByRole("checkbox", { name: t("expert_mode") }));
  goTo("about");
  expect(screen.getByRole("button", { name: t("upd_check") })).toBeTruthy();
  expect(mocks.checkUpdate).not.toHaveBeenCalled();
  goTo("generation");
  expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("75");
  goTo("library");
  expect((screen.getByRole("combobox", { name: t("exp") }) as HTMLSelectElement).value).toBe("mp3");
  fireEvent.submit(screen.getByRole("button", { name: t("save") }).closest("form")!);
  await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledWith({ timeout_minutes: 75, export_format: "mp3", expert_mode: true }));
});

it("retains the independent MCP draft while navigating without applying it", async () => {
  render(view()); await screen.findByRole("spinbutton");
  goTo("mcp");
  fireEvent.change(await screen.findByRole("textbox", { name: t("mcp_port") }), { target: { value: "32124" } });
  fireEvent.click(screen.getByRole("checkbox", { name: t("mcp_enable") }));
  goTo("appearance"); goTo("mcp");
  expect((screen.getByRole("textbox", { name: t("mcp_port") }) as HTMLInputElement).value).toBe("32124");
  expect((screen.getByRole("checkbox", { name: t("mcp_enable") }) as HTMLInputElement).checked).toBe(true);
  expect(mocks.mcpSettings).toHaveBeenCalledOnce();
  expect(mocks.saveMcpSettings).not.toHaveBeenCalled();
});

it("reveals a hidden page when its draft contains an invalid field", async () => {
  render(view());
  fireEvent.change(await screen.findByRole("spinbutton"), { target: { value: "0" } });
  goTo("library");
  const form = screen.getByRole("button", { name: t("save") }).closest("form")!;
  act(() => { expect(form.checkValidity()).toBe(false); });
  expect(screen.getByRole("spinbutton")).toBeTruthy();
  expect(screen.getByRole("button", { name: t("settings_page_generation") }).getAttribute("aria-current")).toBe("page");
  expect(mocks.saveSettings).not.toHaveBeenCalled();
});

it("applies the appearance layout immediately and dismisses with the close control", async () => {
  render(view()); await screen.findByRole("spinbutton");
  goTo("appearance");
  expect(screen.getByRole("button", { name: t("vt_auto") }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: t("side") }));
  expect(callbacks.onLayoutChange).toHaveBeenCalledWith("side");
  expect(mocks.saveSettings).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: t("desktop_close") }));
  expect(callbacks.onClose).toHaveBeenCalledOnce();
});

it("starts a reopened dialog on generation with a fresh settings draft", async () => {
  const mounted = render(view());
  fireEvent.change(await screen.findByRole("spinbutton"), { target: { value: "75" } });
  goTo("library");
  mounted.rerender(view(false)); mounted.rerender(view());
  expect((await screen.findByRole("spinbutton") as HTMLInputElement).value).toBe("60");
  expect(screen.queryByText(t("settings_unsaved"))).toBeNull();
  expect(screen.getByRole("button", { name: t("settings_page_generation") }).getAttribute("aria-current")).toBe("page");
});
