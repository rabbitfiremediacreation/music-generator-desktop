// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ImportDialog } from "./react/import/ImportDialog";
import { I18nProvider } from "./react/i18n";
import { EventBridge } from "./react/events";
import { setLang, t } from "./i18n.js";
import type { ImportPreview, ImportRequest } from "./types";
const mocks = vi.hoisted(() => ({ open: vi.fn(), listen: vi.fn(), unlisten: vi.fn(), previewImport: vi.fn(), previewMove: vi.fn(), importLibrary: vi.fn(), rememberFolder: vi.fn(), cancelSetup: vi.fn(), saveSettings: vi.fn(), dialogDirectory: vi.fn() }));
vi.mock("./backend", () => ({ backend: mocks }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
const checked: ImportPreview = { songs: 2, folders: 1, files: 2, bytes: 10, free_bytes: 100_000_000, songs_source: "/old/data/songs", missing: [], issues: [], can_import: true };
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); setLang("en");
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  mocks.listen.mockResolvedValue(mocks.unlisten);
  mocks.dialogDirectory.mockImplementation(async current => current || "/home/test");
  mocks.previewImport.mockResolvedValue(checked); mocks.previewMove.mockResolvedValue(checked);
  mocks.importLibrary.mockResolvedValue({ songs: 2, files: 2, songs_dir: "/chosen", missing: [] });
  mocks.cancelSetup.mockResolvedValue(undefined); mocks.rememberFolder.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function mount(mode: "import" | "move" = "import", onImported = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const close = vi.fn();
  const rendered = render(<QueryClientProvider client={client}><I18nProvider><EventBridge><ImportDialog open mode={mode} songsDirectory="/chosen" platform="macos" onClose={close} onImported={onImported} /></EventBridge></I18nProvider></QueryClientProvider>);
  return { ...rendered, close, onImported };
}
const start = () => screen.getByRole("button", { name: t("import_start") });
async function source() {
  mocks.open.mockResolvedValueOnce("/old");
  fireEvent.click(await screen.findByRole("button", { name: t("import_choose_source") }));
  await waitFor(() => expect((start() as HTMLButtonElement).disabled).toBe(false));
}
it("previews and imports the unsaved setup target without changing models", async () => {
  const view = mount(); await source();
  const request: ImportRequest = { root: "/old", songs_source: null, songs_dir: "/chosen", allow_partial: false };
  expect(mocks.previewImport).toHaveBeenCalledWith(request);
  expect(mocks.importLibrary).not.toHaveBeenCalled();
  fireEvent.click(start());
  await waitFor(() => expect(view.onImported).toHaveBeenCalledWith("/chosen"));
  expect(mocks.importLibrary).toHaveBeenCalledWith(request); expect(mocks.saveSettings).not.toHaveBeenCalled();
  view.unmount(); expect(mocks.unlisten).toHaveBeenCalledTimes(mocks.listen.mock.calls.length);
});
it("requires explicit partial import and supports a separate source grant", async () => {
  const missing = [{ id: "old", title: "Keep lyrics", file: "missing.wav" }];
  mocks.previewImport.mockImplementation(async (request: ImportRequest) => ({ ...checked, missing, can_import: request.allow_partial }));
  mount();
  mocks.open.mockResolvedValueOnce("/old"); fireEvent.click(await screen.findByRole("button", { name: t("import_choose_source") }));
  const partial = await screen.findByRole("checkbox", { name: t("import_allow_partial") });
  expect((start() as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("Keep lyrics · missing.wav")).toBeTruthy();
  fireEvent.click(partial);
  await waitFor(() => expect((start() as HTMLButtonElement).disabled).toBe(false));
  mocks.open.mockResolvedValueOnce("/external-songs"); fireEvent.click(screen.getByRole("button", { name: t("import_choose_songs") }));
  await waitFor(() => expect(mocks.previewImport).toHaveBeenLastCalledWith(expect.objectContaining({ songs_source: "/external-songs", allow_partial: true })));
  expect(mocks.rememberFolder).not.toHaveBeenCalled();
});
it("explains a selected songs folder and requests a fresh parent grant", async () => {
  mocks.previewImport.mockResolvedValueOnce({ ...checked, can_import: false, issues: [{ code: "select_project", path: "/old/data/songs" }] }).mockResolvedValue(checked);
  mocks.open.mockResolvedValueOnce("/old/data/songs").mockResolvedValueOnce("/old/data");
  mount(); fireEvent.click(await screen.findByRole("button", { name: t("import_choose_source") }));
  await waitFor(() => expect((start() as HTMLButtonElement).disabled).toBe(false));
  expect(mocks.open).toHaveBeenLastCalledWith({ directory: true, defaultPath: "/old/data", title: t("dialog_import_root") });
  expect(mocks.previewImport).toHaveBeenLastCalledWith(expect.objectContaining({ root: "/old/data" }));
});
it("persists the destination grant and invalidates the previous preview", async () => {
  mount(); await source();
  mocks.open.mockResolvedValueOnce("/new"); fireEvent.click(screen.getByRole("button", { name: t("import_choose_target") }));
  await waitFor(() => expect(mocks.previewImport).toHaveBeenLastCalledWith(expect.objectContaining({ songs_dir: "/new" })));
  expect(mocks.rememberFolder).toHaveBeenCalledWith("/new");
});
it("moves through settings and requests cancellation without closing a running transfer", async () => {
  mocks.saveSettings.mockImplementation(() => new Promise(() => {}));
  const { close } = mount("move");
  const move = await screen.findByRole("button", { name: t("import_move_start") });
  await waitFor(() => expect((move as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(move);
  await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledWith({ songs_dir: "/chosen" }));
  fireEvent.click(screen.getByRole("button", { name: t("cancel") }));
  expect(mocks.cancelSetup).toHaveBeenCalledTimes(1); expect(mocks.importLibrary).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
});
it("shows transfer errors and rechecks before allowing another attempt", async () => {
  mount(); await source(); mocks.importLibrary.mockRejectedValueOnce(new Error("import_collision")); fireEvent.click(start());
  await screen.findByText(t("import_collision"));
  await waitFor(() => expect(mocks.previewImport).toHaveBeenCalledTimes(2));
  expect((screen.getByRole("button", { name: t("cancel") }) as HTMLButtonElement).disabled).toBe(false);
});
it.each(["import", "move"] as const)("shows byte progress and commit events during %s", async mode => {
  mocks.importLibrary.mockImplementation(() => new Promise(() => {})); mocks.saveSettings.mockImplementation(() => new Promise(() => {}));
  mount(mode); if (mode === "import") await source();
  const run = await screen.findByRole("button", { name: t(mode === "import" ? "import_start" : "import_move_start") });
  await waitFor(() => expect((run as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(run);
  const progress = await screen.findByRole("progressbar"); expect(progress.hasAttribute("value")).toBe(false);
  const update = mocks.listen.mock.calls.find(([name]) => name === "import-progress")![1];
  await act(async () => update({ payload: { phase: "copying", copied_bytes: 512, total_bytes: 1024, files: 1, total_files: 2 } }));
  await waitFor(() => expect((progress as HTMLProgressElement).value).toBe(0.5)); expect(screen.getByText("1 / 2 · 512 B / 1 KiB")).toBeTruthy();
  await act(async () => update({ payload: { phase: "committing", copied_bytes: 1024, total_bytes: 1024, files: 2, total_files: 2 } }));
  await waitFor(() => expect(progress.hasAttribute("value")).toBe(false)); expect(screen.getByText(t("import_committing"))).toBeTruthy();
});
