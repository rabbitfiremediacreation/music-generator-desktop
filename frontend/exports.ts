import { saveExport } from "./path-dialogs";
import { backend } from "./backend";
import type { Song } from "./types";
import { t } from "./i18n.js";

function safeName(name: string): string { return name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "Song"; }

export async function exportSong(song: Song, lyrics = false): Promise<void> {
  const kind = lyrics ? "lyrics" : song.output_kind === "midi" ? "midi" : "audio";
  const format = kind === "audio" ? (await backend.settings()).export_format : null;
  const ext = kind === "lyrics" ? "txt" : kind === "midi" ? "mid" : format === "mp3" ? "mp3" : song.file?.split(".").pop() || "wav";
  const path = await saveExport(`export_${kind}`, `${safeName(song.title || song.caption)}.${ext}`, ext);
  if (path) await performExport(kind, path, song.id);
}

export async function exportFolder(folder: string): Promise<void> {
  const path = await saveExport("export_zip", "Music Generator.zip", "zip");
  if (path) await performExport("zip", path, null, folder);
}

async function performExport(kind: Parameters<typeof backend.export>[0], path: string, id: string | null = null, folder: string | null = null): Promise<void> {
  try { await backend.export(kind, path, id, folder); }
  catch (error) { if (error instanceof Error && error.message === "mp3_failed") throw new Error(t("mp3_failed")); throw error; }
}
