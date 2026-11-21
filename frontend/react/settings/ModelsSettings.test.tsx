// @vitest-environment happy-dom
import { catalogFixture, catalogWithNativeProfiles, saved, xl } from "../models/model-fixtures";
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ModelCatalog, Settings } from "../../types";
import { modelName } from "../../model-options";
import { setLang, t } from "../../i18n.js";
import { createAppQueryClient } from "../data";
import { EventBridge } from "../events";
import { I18nProvider } from "../i18n";
import { standard } from "../setup/fixtures";
import { SettingsDialog } from "./SettingsDialog";
import type { SettingsPage } from "./SettingsNavigation";

const ipc = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), confirm: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: ipc.invoke, convertFileSrc: (path: string) => path }));
vi.mock("@tauri-apps/api/event", () => ({ listen: ipc.listen }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: ipc.confirm }));
const handlers = new Map<string, (event: { payload: unknown }) => void>();
const onClose = vi.fn(), onUse = vi.fn();
let current: Settings, catalog: ModelCatalog;
let huggingFaceConfigured: boolean;
beforeEach(() => {
  vi.resetAllMocks(); handlers.clear(); setLang("en");
  ipc.listen.mockImplementation(async (name, handler) => { handlers.set(name, handler); return () => handlers.delete(name); });
  current = saved(); catalog = structuredClone(catalogFixture);
  huggingFaceConfigured = false;
  catalog.hardware.ram_bytes = 64 * 1024 ** 3;
  ipc.invoke.mockImplementation(async (name, args) => {
    if (name === "get_settings") return { ...current };
    if (name === "model_catalog") return structuredClone(catalog);
    if (name === "discover_hugging_face_models") return { candidates: [], unavailable_repositories: [] };
    if (name === "hugging_face_token_status") return huggingFaceConfigured;
    if (name === "set_hugging_face_token") return huggingFaceConfigured = args.token !== null;
    if (name === "save_settings") { current = { ...current, ...args.values }; return { ...current }; }
    if (name === "download_title_model") { catalog.title_model = { ...catalog.title_model, present: true, verified: true }; return; }
    if (name === "use_models" || name === "select_models") {
      current = { ...current, model_provider: args.selection.provider, synthesis_model: args.selection.synthesis, lm_model: args.selection.language };
      catalog.selection = args.selection;
      return args.selection;
    }
    if (name === "phone_access_status") return { enabled: false, port: 8767, token: "", addresses: [] };
    if (name === "get_mcp_settings") return { enabled: false, port: 0, scope: "local", urls: [], running: false, managed_by_environment: false };
    if (name === "generation_policy") return { recommended_steps: 30 };
  });
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(cleanup);

function mount(strict = false) {
  const client = createAppQueryClient();
  const view = <QueryClientProvider client={client}><I18nProvider><EventBridge>
    <SettingsDialog open layout="auto" onClose={onClose} onBusyChange={() => {}} onMoveLibrary={() => {}} onLayoutChange={() => {}}
      modelManager={{ selection: standard, currentSelection: standard, selectionRevision: 1, onUse }} />
  </EventBridge></I18nProvider></QueryClientProvider>;
  render(strict ? <StrictMode>{view}</StrictMode> : view);
}
function goTo(page: SettingsPage) { fireEvent.click(screen.getByRole("button", { name: t(`settings_page_${page}`) })); }
function submit() { fireEvent.submit(screen.getByRole("button", { name: t("save") }).closest("form")!); }

async function addModel() {
  fireEvent.click(screen.getByRole("button", { name: t("models_add") }));
  return screen.findByRole("dialog", { name: t("models_add") });
}
function closeCatalog(dialog: HTMLElement) { fireEvent.keyDown(dialog, { key: "Escape" }); }

it("sets and removes a masked Hugging Face token without submitting the settings draft", async () => {
  mount();
  const timeout = await screen.findByRole("spinbutton");
  fireEvent.change(timeout, { target: { value: "75" } });
  goTo("models");
  const input = await screen.findByLabelText<HTMLInputElement>(t("hf_token"));
  expect(input.type).toBe("password");
  fireEvent.change(input, { target: { value: "  hf_example-only  " } });
  fireEvent.click(screen.getByRole("button", { name: t("hf_token_save") }));
  await screen.findByText(t("hf_token_saved"));
  expect(ipc.invoke).toHaveBeenCalledWith("set_hugging_face_token", { token: "hf_example-only" });
  expect(input.value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: t("hf_token_remove") }));
  await waitFor(() => expect(screen.queryByText(t("hf_token_saved"))).toBeNull());
  expect(ipc.invoke).toHaveBeenCalledWith("set_hugging_face_token", { token: null });
  expect(ipc.invoke.mock.calls.some(([command]) => command === "save_settings")).toBe(false);
  goTo("generation");
  expect(screen.getByRole<HTMLInputElement>("spinbutton").value).toBe("75");
});

it("lists local models first and opens the catalog only from Add model", async () => {
  catalog.models = catalog.models.map(model => ({
    ...model, verified: model.file === standard.synthesis,
    present: model.file === standard.synthesis || model.file === standard.language || model.category === "embedding",
    partial_bytes: 100,
  }));
  mount(); await screen.findByRole("spinbutton"); goTo("models");
  const table = await screen.findByRole("table", { name: t("models_music") });
  const generalModels = screen.getByRole("table", { name: t("models_llm_embeddings") });
  expect(within(table).getAllByRole("row")).toHaveLength(3);
  expect(within(table).getByText(modelName(standard.synthesis))).toBeTruthy();
  expect(within(table).getByText(modelName(standard.language))).toBeTruthy();
  expect(within(table).getByText(t("picker_verify"), { exact: false })).toBeTruthy();
  expect(within(table).queryByText(modelName(xl.synthesis))).toBeNull();
  expect(within(generalModels).getAllByRole("row")).toHaveLength(3);
  expect(within(generalModels).getByText(modelName(catalog.title_model.file))).toBeTruthy();
  expect(within(generalModels).getByText(modelName(catalog.models.find(model => model.category === "embedding")!.file))).toBeTruthy();
  expect(screen.queryByRole("searchbox")).toBeNull();
  const add = screen.getByRole("button", { name: t("models_add") }); add.focus();
  const dialog = await addModel();
  expect(within(dialog).getByRole("searchbox")).toBeTruthy();
  expect(screen.getAllByRole("dialog")).toHaveLength(2);
  expect(dialog.closest("form")).toBeNull();
  closeCatalog(dialog);
  await waitFor(() => expect(screen.queryByRole("dialog", { name: t("models_add") })).toBeNull());
  expect(screen.getByRole("dialog", { name: t("settings_title") })).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled(); expect(document.activeElement).toBe(add);
});

it("offers Add model when no local files are installed", async () => {
  catalog.models = catalog.models.map(model => ({ ...model, verified: false, present: false }));
  catalog.title_model = { ...catalog.title_model, verified: false, present: false };
  mount(); await screen.findByRole("spinbutton"); goTo("models");
  expect(await screen.findByText(t("models_installed_empty"))).toBeTruthy();
  expect(screen.queryByRole("table")).toBeNull();
  expect(await addModel()).toBeTruthy();
});

it("switches a model in the extra dialog without saving unrelated settings drafts", async () => {
  mount();
  fireEvent.change(await screen.findByRole("spinbutton"), { target: { value: "75" } });
  goTo("models"); const dialog = await addModel();
  await within(dialog).findByRole("group", { name: t("browser_precision") });
  fireEvent.click(within(dialog).getByRole("button", { name: "XL SFT" }));
  expect(onUse).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: t("picker_use") }));
  await waitFor(() => expect(onUse).toHaveBeenCalledWith(xl, 1));
  closeCatalog(dialog);
  await waitFor(() => expect((screen.getByRole("button", { name: t("save") }) as HTMLButtonElement).disabled).toBe(false));
  expect(onClose).not.toHaveBeenCalled();
  expect(ipc.invoke.mock.calls.filter(([name]) => name === "save_settings")).toHaveLength(0);
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  goTo("generation");
  expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("75");
  submit();
  await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith("save_settings", { values: { timeout_minutes: 75 } }));
});

it("activates a verified installed model without starting a download", async () => {
  mount(); await screen.findByRole("spinbutton"); goTo("models");
  const name = await screen.findByText(modelName(xl.synthesis));
  fireEvent.click(within(name.closest("tr")!).getByRole("button", { name: t("picker_use") }));
  await waitFor(() => expect(onUse).toHaveBeenCalledWith(xl, 1));
  expect(ipc.invoke).toHaveBeenCalledWith("select_models", { selection: xl });
  expect(ipc.invoke.mock.calls.some(([command]) => command === "use_models")).toBe(false);
  expect(screen.queryByRole("dialog", { name: t("models_add") })).toBeNull();
});

it("lists each multi-file profile once and only activates complete, verified profiles", async () => {
  catalog = catalogWithNativeProfiles();
  catalog.hardware.ram_bytes = 64 * 1024 ** 3;
  const heartmula = catalog.profiles!.find(profile => profile.selection.synthesis === "heartmula-oss-3b-hny")!;
  const yue = catalog.profiles!.find(profile => profile.selection.provider === "yue2")!;
  heartmula.available = true;
  yue.available = true;
  catalog.models = catalog.models.map(model => ({
    ...model, present: heartmula.files.includes(model.file) || model.file === yue.files[0],
    verified: heartmula.files.includes(model.file) || model.file === yue.files[0],
  }));
  catalog.title_model = { ...catalog.title_model, present: false, verified: false };
  const bundleBytes = catalog.models.filter(model => heartmula.files.includes(model.file)).reduce((sum, model) => sum + model.estimated_bytes, 0);

  mount(); await screen.findByRole("spinbutton"); goTo("models");
  const table = await screen.findByRole("table", { name: t("models_music") });
  expect(within(table).getAllByRole("row")).toHaveLength(3);
  const completeRow = within(table).getByText(heartmula.name).closest("tr")!;
  expect(within(completeRow).getByText(t("picker_installed"), { exact: false })).toBeTruthy();
  expect(within(completeRow).getByText(`${new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(bundleBytes / 1024 ** 3)} GiB`)).toBeTruthy();
  const incompleteRow = within(table).getByText(yue.name).closest("tr")!;
  expect(within(incompleteRow).getByText(t("picker_missing"), { exact: false })).toBeTruthy();
  expect(within(incompleteRow).queryByRole("button", { name: t("picker_use") })).toBeNull();
  fireEvent.click(within(completeRow).getByRole("button", { name: t("picker_use") }));
  await waitFor(() => expect(onUse).toHaveBeenCalledWith(heartmula.selection, 1));
});

it("protects active model files and removes a multi-file model only after confirmation", async () => {
  catalog = catalogWithNativeProfiles();
  const heartmula = catalog.profiles![0];
  catalog.models = catalog.models.map(model => heartmula.files.includes(model.file) ? { ...model, present: true } : model);
  const original = ipc.invoke.getMockImplementation()!;
  ipc.invoke.mockImplementation((name, args) => {
    if (name === "remove_model") {
      catalog.models = catalog.models.map(model => heartmula.files.includes(model.file) ? { ...model, present: false } : model);
      return Promise.resolve();
    }
    return original(name, args);
  });
  ipc.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

  mount(); await screen.findByRole("spinbutton"); goTo("models");
  const removeName = (name: string) => `${t("model_remove")} · ${name}`;
  const active = await screen.findByRole<HTMLButtonElement>("button", { name: removeName(modelName(standard.synthesis)) });
  expect(active.disabled).toBe(true);
  const heartmulaRemoval = removeName(`${heartmula.name} · F32`);
  const remove = screen.getByRole<HTMLButtonElement>("button", { name: heartmulaRemoval });
  fireEvent.click(remove);
  await waitFor(() => expect(ipc.confirm).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(remove.disabled).toBe(false));
  expect(ipc.invoke.mock.calls.some(([name]) => name === "remove_model")).toBe(false);
  fireEvent.click(remove);
  await waitFor(() => expect(screen.queryByRole("button", { name: heartmulaRemoval })).toBeNull());
  expect(ipc.invoke).toHaveBeenCalledWith("remove_model", { target: { kind: "profile", selection: heartmula.selection } });
});

it("keeps downloads visible and cancellable after closing the extra dialog", async () => {
  catalog.models = catalog.models.map(model => ({ ...model, verified: false, present: false }));
  let fail!: (error: Error) => void;
  const original = ipc.invoke.getMockImplementation()!;
  ipc.invoke.mockImplementation((name, args) => {
    if (name === "use_models") return new Promise((_, reject) => { fail = reject; });
    if (name === "cancel_model_download") { fail(new Error("Operation cancelled")); return Promise.resolve(); }
    return original(name, args);
  });
  mount(); await screen.findByRole("spinbutton"); goTo("models");
  const dialog = await addModel();
  await within(dialog).findByRole("group", { name: t("browser_precision") });
  fireEvent.click(within(dialog).getByRole("button", { name: "XL SFT" }));
  fireEvent.click(within(dialog).getByRole("button", { name: t("picker_download_use") }));
  await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith("use_models", { selection: xl }));
  act(() => handlers.get("model-download-progress")!({ payload: { file: "weights.gguf", phase: "downloading", downloaded: 1, total: 2, bytes_per_second: 0 } }));
  closeCatalog(dialog);
  expect(await screen.findByText(/weights.gguf/)).toBeTruthy();
  expect((screen.getByRole("progressbar", { name: t("picker_download") }) as HTMLProgressElement).value).toBe(1);
  goTo("generation");
  expect((screen.getByRole("button", { name: t("save") }) as HTMLButtonElement).disabled).toBe(true);
  submit(); expect(onClose).not.toHaveBeenCalled();
  goTo("models");
  fireEvent.click(screen.getByRole("button", { name: t("picker_cancel_download") }));
  await waitFor(() => expect(screen.queryByRole("progressbar")).toBeNull());
  expect(onUse).not.toHaveBeenCalled(); expect(current.synthesis_model).toBe(standard.synthesis);
});

it("applies Expert Mode separately before opening the catalog and retains other draft edits", async () => {
  current.expert_mode = false; catalog.expert_mode = false;
  mount();
  fireEvent.change(await screen.findByRole("spinbutton"), { target: { value: "75" } });
  goTo("models"); await screen.findByRole("table", { name: t("models_music") });
  fireEvent.click(screen.getByRole("checkbox", { name: t("expert_mode") }));
  fireEvent.click(screen.getByRole("button", { name: t("settings_apply_expert") }));
  await waitFor(() => expect(screen.queryByRole("button", { name: t("settings_apply_expert") })).toBeNull());
  const dialog = await addModel();
  expect(await within(dialog).findByRole("combobox", { name: t("picker_provider") })).toBeTruthy();
  expect(ipc.invoke.mock.calls.filter(([name]) => name === "save_settings")).toEqual([["save_settings", { values: { expert_mode: true } }]]);
  closeCatalog(dialog); expect(onClose).not.toHaveBeenCalled();
  goTo("generation"); expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("75");
});

it("retains failed Expert Mode edits for retry", async () => {
  current.expert_mode = false; catalog.expert_mode = false;
  const original = ipc.invoke.getMockImplementation()!; let failing = true;
  ipc.invoke.mockImplementation((name, args) => name === "save_settings" && failing ? Promise.reject(new Error("Disk full")) : original(name, args));
  mount(); await screen.findByRole("spinbutton"); goTo("models"); await screen.findByRole("table", { name: t("models_music") });
  fireEvent.click(screen.getByRole("checkbox", { name: t("expert_mode") }));
  fireEvent.click(screen.getByRole("button", { name: t("settings_apply_expert") }));
  expect((await screen.findByRole("alert")).textContent).toContain("Disk full");
  expect((screen.getByRole("checkbox", { name: t("expert_mode") }) as HTMLInputElement).checked).toBe(true);
  expect(current.expert_mode).toBe(false);
  failing = false;
  fireEvent.click(screen.getByRole("button", { name: t("settings_apply_expert") }));
  await waitFor(() => expect(screen.queryByRole("button", { name: t("settings_apply_expert") })).toBeNull());
  const dialog = await addModel();
  expect(await within(dialog).findByRole("combobox", { name: t("picker_provider") })).toBeTruthy();
});

it("refreshes the installed list after downloading the title model in the extra dialog", async () => {
  catalog.title_model.verified = false; catalog.title_model.present = false;
  mount(); await screen.findByRole("spinbutton"); goTo("models");
  const dialog = await addModel();
  fireEvent.click(await within(dialog).findByRole("button", { name: t("title_model_download") }));
  await within(dialog).findByText(t("picker_selected"));
  closeCatalog(dialog);
  expect(await screen.findByText(modelName(catalog.title_model.file))).toBeTruthy();
  expect(onUse).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
});

it("handles native cancel in the extra dialog without closing Settings", async () => {
  mount(); await screen.findByRole("spinbutton"); goTo("models");
  const dialog = await addModel();
  const event = new Event("cancel", { bubbles: true, cancelable: true }); fireEvent(dialog, event);
  expect(event.defaultPrevented).toBe(true); expect(onClose).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog", { name: t("models_add") })).toBeNull();
  expect(screen.getByRole("dialog", { name: t("settings_title") })).toBeTruthy();
});

it("keeps the add dialog open when Strict Mode delivers a queued native close event from effect cleanup", async () => {
  const close = vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) {
    this.open = false;
    setTimeout(() => this.dispatchEvent(new Event("close")), 0);
  });
  try {
    mount(true); await screen.findByRole("spinbutton"); goTo("models");
    const dialog = await addModel();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(screen.getByRole("dialog", { name: t("models_add") })).toBe(dialog);
    expect((dialog as HTMLDialogElement).open).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    (dialog as HTMLDialogElement).close();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(screen.queryByRole("dialog", { name: t("models_add") })).toBeNull();
    expect(screen.getByRole("dialog", { name: t("settings_title") })).toBeTruthy();
  } finally { cleanup(); close.mockRestore(); }
});
