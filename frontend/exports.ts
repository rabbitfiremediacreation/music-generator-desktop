import { audioFormats, type AudioFormat } from "./audio-formats";
import { saveExport, type ExportPurpose } from "./path-dialogs";
import { backend } from "./backend";
import { songMachineGeneratedBy } from "./song-result";
import type { Song } from "./types";
import { t } from "./i18n.js";

function safeName(name: string): string { return name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "Song"; }

export async function exportSong(song: Song, lyrics = false, format?: AudioFormat): Promise<void> {
  const kind = lyrics ? "lyrics" : song.output_kind === "midi" ? "midi" : "audio";
  const selected = kind === "audio" ? format ?? (await backend.settings()).export_format : null;
  const sourceExtension = song.file?.split(".").pop() || "wav";
  const audioExtension = selected && (format || selected !== "wav") ? audioFormats[selected]?.extension ?? sourceExtension : sourceExtension;
  const ext = kind === "lyrics" ? "txt" : kind === "midi" ? "mid" : audioExtension;
  const purpose: ExportPurpose = kind === "audio" && songMachineGeneratedBy(song) ? "export_generated_audio" : `export_${kind}`;
  const path = await saveExport(purpose, `${safeName(song.title || song.caption)}.${ext}`, ext);
  if (path) await performExport(kind, path, song.id, null, kind === "audio" ? format : undefined);
}

export async function exportFolder(folder: string, format?: AudioFormat): Promise<void> {
  const path = await saveExport("export_zip", "Music Generator.zip", "zip");
  if (path) await performExport("zip", path, null, folder, format);
}

async function performExport(kind: Parameters<typeof backend.export>[0], path: string, id: string | null, folder: string | null, format?: AudioFormat): Promise<void> {
  try {
    if (format) await backend.export(kind, path, id, folder, format);
    else await backend.export(kind, path, id, folder);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "mp3_failed") throw new Error(t(format ? "audio_conversion_failed" : error.message));
      if (["audio_conversion_failed", "audio_export_format_unavailable", "audio_export_extension_mismatch"].includes(error.message)) throw new Error(t(error.message));
    }
    throw error;
  }
}
