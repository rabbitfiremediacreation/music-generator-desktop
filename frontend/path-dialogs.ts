import { open, save } from "@tauri-apps/plugin-dialog";
import { backend } from "./backend";
import { t } from "./i18n.js";

export type FolderPurpose = "models" | "songs" | "import_root" | "import_songs";
export type ExportPurpose = "export_audio" | "export_generated_audio" | "export_lyrics" | "export_zip";
type Purpose = FolderPurpose | "audio_import";
const storageKey = "dialog-folders:v1";

function history(): Partial<Record<Purpose, string>> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

export function rememberDialogFolder(purpose: Purpose, directory: string): void {
  try { localStorage.setItem(storageKey, JSON.stringify({ ...history(), [purpose]: directory })); }
  catch { /* Native selection also works when preferences cannot be stored. */ }
}

export async function dialogDirectory(purpose: Purpose, current = ""): Promise<string> {
  const remembered = history()[purpose];
  return backend.dialogDirectory(current.trim() || null, typeof remembered === "string" ? remembered : null, false);
}

/** Persist access only for destinations; import sources need a session grant. */
export async function pickFolder(purpose: FolderPurpose, current = "", persistAccess = false): Promise<string | null> {
  const chosen = await open({ directory: true, defaultPath: await dialogDirectory(purpose, current), title: t(`dialog_${purpose}`) }).catch(dialogFailure);
  if (typeof chosen !== "string") return null;
  if (persistAccess) await backend.rememberFolder(chosen);
  rememberDialogFolder(purpose, chosen);
  return chosen;
}

export async function saveExport(purpose: ExportPurpose, filename: string, extension: string): Promise<string | null> {
  try {
    const defaultPath = await backend.exportDefaultPath(filename);
    const chosen = await save({ defaultPath, title: t(`dialog_${purpose}`), filters: [{ name: extension.toUpperCase(), extensions: [extension] }] }).catch(dialogFailure);
    return chosen;
  } catch (error) { throw new Error(pathErrorText(error)); }
}

function dialogFailure(): never { throw new Error("dialog_failed"); }

export function pathErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /^(path_|audio_|dialog_)/.test(message) ? t(message) : message;
}
