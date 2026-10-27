import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { GenerationPolicy, Bootstrap, Filter, Folder, Generation, GenerationFormPreferences, Health, Queue, Settings, SettingsPatch, SetupRequest, SetupResult, Song, Update, ModelCatalog, ModelSelection, ImportRequest, ImportPreview, ImportResult } from "./types";

async function command<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  try { return await invoke<T>(name, args); }
  catch (error) { throw error instanceof Error ? error : new Error(typeof error === "string" ? error : String(error)); }
}
const audioUrl = (song: Song): Song => ({ ...song, url: song.path ? convertFileSrc(song.path) : null });

export const backend = {
  dialogDirectory: (current: string | null, remembered: string | null, exporting: boolean) => command<string>("dialog_directory", { current, remembered, exporting }),
  pickAudioFile: (directory: string, title: string, filterName: string) => command<{ name: string; directory: string; data: number[] } | null>("pick_audio_file", { directory, title, filterName }),
  rememberFolder: (path: string) => command<void>("remember_folder", { path }),
  bootstrap: (attempt: number) => command<Bootstrap>("bootstrap", { attempt }),
  setup: (request: SetupRequest) => command<SetupResult>("setup_models", { request }),
  estimate: (request: SetupRequest) => command<{ missing_bytes: number; free_bytes: number }>("setup_estimate", { request }),
  cancelSetup: () => command<void>("cancel_setup"),
  modelCatalog: () => command<ModelCatalog>("model_catalog"),
  downloadTitleModel: () => command<void>("download_title_model"),
  selectModels: (selection: ModelSelection) => command<ModelSelection>("select_models", { selection }),
  useModels: (selection: ModelSelection) => command<ModelSelection>("use_models", { selection }),
  cancelModelDownload: () => command<void>("cancel_model_download"),
  previewImport: (request: ImportRequest) => command<ImportPreview>("preview_import", { request }),
  previewMove: (songs_dir: string) => command<ImportPreview>("preview_library_move", { songsDir: songs_dir }),
  importLibrary: (request: ImportRequest) => command<ImportResult>("import_library", { request }),
  songs: async (filter: Filter = {}) => (await command<Song[]>("list_songs", { filter })).map(audioUrl),
  song: async (id: string) => audioUrl(await command<Song>("get_song", { id })),
  generate: (request: Generation) => command<{ ids: string[] }>("generate", { request }),
  patch: (id: string, patch: { title?: string; favorite?: boolean; folder_id?: string | null }) => command<Song>("patch_song", { id, patch }),
  remove: (id: string) => command<{ cancelled: boolean; deleted: boolean }>("delete_song", { id }),
  retry: (id: string) => command<Song>("retry_song", { id }),
  folders: () => command<{ folders: Folder[]; all: number; none: number }>("list_folders"),
  saveFolder: (name: string, id: string | null = null) => command<Folder>("save_folder", { id, name }),
  deleteFolder: (id: string) => command<void>("delete_folder", { id }),
  queue: () => command<Queue>("queue"),
  settings: () => command<Settings>("get_settings"),
  saveSettings: (values: SettingsPatch) => command<Settings>("save_settings", { values }),
  generationPolicy: (selection?: ModelSelection, refresh = false) => command<GenerationPolicy>("generation_policy", { selection: selection ?? null, refresh }),
  generationFormPreferences: () => command<GenerationFormPreferences>("get_generation_form_preferences"),
  saveGenerationFormPreferences: (values: GenerationFormPreferences) => command<void>("save_generation_form_preferences", { values }),
  health: () => command<Health>("health"),
  analyze: async (file: File, selection?: ModelSelection) => {
    if (file.size > 60 * 1024 * 1024) throw new Error("audio_size");
    const filename = /\.(wav|mp3|flac|m4a|ogg)$/i.test(file.name) ? file.name : `${file.name}.wav`;
    return command<Record<string, unknown>>("analyze", { data: Array.from(new Uint8Array(await file.arrayBuffer())), filename, selection });
  },
  export: (kind: "audio" | "lyrics" | "zip", destination: string, id: string | null = null, folder: string | null = null) => command<void>("export_file", { kind, destination, id, folder }),
  exportDefaultPath: (filename: string) => command<string>("export_default_path", { filename }),
  checkUpdate: () => command<Update>("check_update"),
  exit: () => command<void>("exit_app"),
};
