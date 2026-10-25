// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { mountStudio } from "./dom-fixture";
import type { ImportPreview, ImportRequest } from "./types";

const mocks = vi.hoisted(() => ({
  open: vi.fn(), listen: vi.fn(), unlisten: vi.fn(), previewImport: vi.fn(), previewMove: vi.fn(),
  importLibrary: vi.fn(), rememberFolder: vi.fn(), cancelSetup: vi.fn(), saveSettings: vi.fn(),
}));
vi.mock("./backend", () => ({ backend: mocks }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("./i18n.js", () => ({ t: (key: string) => key }));
const get = <T extends HTMLElement = HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
const settle = async () => { await vi.waitFor(() => expect(get<HTMLButtonElement>("#importRun").disabled).toBe(false)); };
const checked: ImportPreview = { songs: 2, folders: 1, files: 2, bytes: 10, free_bytes: 100_000_000, songs_source: "/old/data/songs", missing: [], issues: [], can_import: true };

beforeEach(() => {
  vi.resetAllMocks();
  mountStudio();
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event("close")); });
  mocks.listen.mockResolvedValue(mocks.unlisten);
  mocks.previewImport.mockResolvedValue(checked);
  mocks.previewMove.mockResolvedValue(checked);
  mocks.importLibrary.mockResolvedValue({ songs: 2, files: 2, songs_dir: "/chosen", missing: [] });
});
afterEach(() => { vi.restoreAllMocks(); });

it("previews and imports the unsaved setup target without changing models", async () => {
  const { openLibraryAssistant } = await import("./import-wizard");
  const onImported = vi.fn();
  await openLibraryAssistant("import", "/chosen", onImported);
  expect(get<HTMLButtonElement>("#importRun").disabled).toBe(true);
  mocks.open.mockResolvedValueOnce("/old");
  get("#importSourcePick").click();
  await settle();
  const request: ImportRequest = { root: "/old", songs_source: null, songs_dir: "/chosen", allow_partial: false };
  expect(mocks.previewImport).toHaveBeenCalledWith(request);
  expect(mocks.importLibrary).not.toHaveBeenCalled();
  get("#importRun").click();
  await vi.waitFor(() => expect(onImported).toHaveBeenCalledWith("/chosen"));
  expect(mocks.importLibrary).toHaveBeenCalledWith(request);
  expect(mocks.saveSettings).not.toHaveBeenCalled();
  get("#importClose").click();
  expect(mocks.unlisten).toHaveBeenCalledOnce();
});

it("requires explicit partial import and supports a separate source grant", async () => {
  const { openLibraryAssistant } = await import("./import-wizard");
  const missing = [{ id: "old", title: "Keep lyrics", file: "missing.wav" }];
  mocks.previewImport.mockImplementation(async (request: ImportRequest) => ({ ...checked, missing, can_import: request.allow_partial }));
  await openLibraryAssistant("import", "/chosen");
  mocks.open.mockResolvedValueOnce("/old"); get("#importSourcePick").click();
  await vi.waitFor(() => expect(get("#importPartialRow").hidden).toBe(false));
  expect(get<HTMLButtonElement>("#importRun").disabled).toBe(true);
  expect(get("#importMissing").textContent).toContain("Keep lyrics");
  get<HTMLInputElement>("#importPartial").click();
  await settle();
  mocks.open.mockResolvedValueOnce("/external-songs"); get("#importSongsPick").click();
  await vi.waitFor(() => expect(mocks.previewImport).toHaveBeenLastCalledWith(expect.objectContaining({ songs_source: "/external-songs", allow_partial: true })));
  // Source access is a session grant, rather than a permanent bookmark.
  expect(mocks.rememberFolder).not.toHaveBeenCalled();
});

it("explains a selected songs folder and requests a fresh parent grant", async () => {
  const { openLibraryAssistant } = await import("./import-wizard");
  mocks.previewImport.mockResolvedValueOnce({ ...checked, can_import: false, issues: [{ code: "select_project", path: "/old/data/songs" }] }).mockResolvedValue(checked);
  mocks.open.mockResolvedValueOnce("/old/data/songs").mockResolvedValueOnce("/old/data");
  await openLibraryAssistant("import", "/chosen"); get("#importSourcePick").click();
  await settle();
  expect(mocks.open).toHaveBeenLastCalledWith({ directory: true, defaultPath: "/old/data" });
  expect(mocks.previewImport).toHaveBeenLastCalledWith(expect.objectContaining({ root: "/old/data" }));
});

it("persists the destination grant and invalidates the previous preview", async () => {
  const { openLibraryAssistant } = await import("./import-wizard");
  await openLibraryAssistant("import", "/chosen");
  mocks.open.mockResolvedValueOnce("/old"); get("#importSourcePick").click(); await settle();
  mocks.open.mockResolvedValueOnce("/new"); get("#importTargetPick").click();
  await vi.waitFor(() => expect(mocks.previewImport).toHaveBeenLastCalledWith(expect.objectContaining({ songs_dir: "/new" })));
  expect(mocks.rememberFolder).toHaveBeenCalledWith("/new");
});

it("moves an existing library through settings and lets a running transfer be cancelled", async () => {
  const { openLibraryAssistant } = await import("./import-wizard");
  mocks.saveSettings.mockImplementation(() => new Promise(() => {}));
  await openLibraryAssistant("move", "/chosen"); await settle();
  expect(get("#importSourceStep").hidden).toBe(true);
  get("#importRun").click();
  await vi.waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledWith({ songs_dir: "/chosen" }));
  get("#importClose").click();
  expect(mocks.cancelSetup).toHaveBeenCalledOnce();
  expect(mocks.importLibrary).not.toHaveBeenCalled();
  expect(get<HTMLDialogElement>("#importWizard").open).toBe(true);
});

it("shows errors and rechecks before allowing another attempt", async () => {
  const { openLibraryAssistant } = await import("./import-wizard");
  await openLibraryAssistant("import", "/chosen");
  mocks.open.mockResolvedValueOnce("/old"); get("#importSourcePick").click(); await settle();
  mocks.importLibrary.mockRejectedValueOnce(new Error("import_collision"));
  get("#importRun").click();
  await vi.waitFor(() => expect(get("#importError").textContent).toBe("import_collision"));
  expect(mocks.previewImport).toHaveBeenCalledTimes(2);
  expect(get<HTMLButtonElement>("#importClose").disabled).toBe(false);
});

it.each(["import", "move"] as const)("shows byte progress and the commit phase during %s", async mode => {
  const { openLibraryAssistant } = await import("./import-wizard");
  mocks.importLibrary.mockImplementation(() => new Promise(() => {}));
  mocks.saveSettings.mockImplementation(() => new Promise(() => {}));
  await openLibraryAssistant(mode, "/chosen");
  if (mode === "import") { mocks.open.mockResolvedValueOnce("/old"); get("#importSourcePick").click(); }
  await settle();
  get("#importRun").click();
  const progress = get<HTMLProgressElement>("#importProgress");
  expect(progress.hidden).toBe(false);
  expect(progress.hasAttribute("value")).toBe(false);
  const update = mocks.listen.mock.calls[0][1];
  update({ payload: { phase: "copying", copied_bytes: 512, total_bytes: 1024, files: 1, total_files: 2 } });
  expect(progress.value).toBe(0.5);
  expect(get("#importProgressText").textContent).toContain("1 / 2 · 512 B / 1 KiB");
  update({ payload: { phase: "committing", copied_bytes: 1024, total_bytes: 1024, files: 2, total_files: 2 } });
  expect(progress.hasAttribute("value")).toBe(false);
  expect(get("#importProgressText").textContent).toBe("import_committing");
});
