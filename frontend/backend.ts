import { Channel, convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { GenerationPolicy, Bootstrap, Filter, Folder, Generation, GenerationFormPreferences, Health, Queue, Settings, SettingsPatch, SetupRequest, SetupResult, Song, Update, UpdateStream, ModelCatalog, ModelSelection, ImportRequest, ImportPreview, ImportResult } from "./types";

async function command<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  try { return await invoke<T>(name, args); }
  catch (error) { throw error instanceof Error ? error : new Error(typeof error === "string" ? error : String(error)); }
}
const audioUrl = (song: Song): Song => ({ ...song, url: song.output_kind !== "midi" && song.path ? convertFileSrc(song.path) : null });

export const backend = {
  mcpHttpConnection: (url: string) => command<import("./types").McpHttpConnection>("get_mcp_http_connection", { url }),
  mcpSettings: () => command<import("./types").McpSettingsStatus>("get_mcp_settings"),
  saveMcpSettings: (settings: import("./types").McpSettings) => command<import("./types").McpSettingsStatus>("save_mcp_settings", { settings }),
  cudaStatus: () => command<import("./types").CudaStatus>("cuda_status"),
  installCuda: () => command<import("./types").CudaStatus>("install_cuda_runtime"),
  dialogDirectory: (current: string | null, remembered: string | null, exporting: boolean) => command<string>("dialog_directory", { current, remembered, exporting }),
  pickAndAnalyzeAudio: (directory: string, title: string, filterName: string, selection: ModelSelection | null, onSelected: (file: { name: string; directory: string }) => void) =>
    command<Record<string, unknown> | null>("pick_and_analyze_audio", { directory, title, filterName, selection, onSelected: new Channel(onSelected) }),
  pickReferenceAudio: (title: string) => command<{ id: string; name: string } | null>("pick_reference_audio", { title }),
  rememberFolder: (path: string) => command<void>("remember_folder", { path }),
  bootstrap: (attempt: number) => command<Bootstrap>("bootstrap", { attempt }),
  setup: (request: SetupRequest) => command<SetupResult>("setup_models", { request }),
  estimate: (request: SetupRequest) => command<{ missing_bytes: number; free_bytes: number }>("setup_estimate", { request }),
  cancelSetup: () => command<void>("cancel_setup"),
  modelCatalog: () => command<ModelCatalog>("model_catalog"),
  downloadTitleModel: () => command<void>("download_title_model"),
  selectModels: (selection: ModelSelection) => command<ModelSelection>("select_models", { selection }),
  useModels: (selection: ModelSelection) => command<ModelSelection>("use_models", { selection }),
  verifyImportedModels: (selection: ModelSelection) => command<void>("verify_imported_models", { selection }),
  cancelModelDownload: () => command<void>("cancel_model_download"),
  previewImport: (request: ImportRequest) => command<ImportPreview>("preview_import", { request }),
  previewMove: (songs_dir: string) => command<ImportPreview>("preview_library_move", { songsDir: songs_dir }),
  importLibrary: (request: ImportRequest) => command<ImportResult>("import_library", { request }),
  songs: async (filter: Filter = {}) => (await command<Song[]>("list_songs", { filter })).map(audioUrl),
  songPage: async (filter: Filter, offset: number, limit: number) => {
    const page = await command<import("./types").SongPage>("list_song_page", { filter, offset, limit });
    return { ...page, songs: page.songs.map(audioUrl) };
  },
  song: async (id: string) => audioUrl(await command<Song>("get_song", { id })),
  songAudio: async (id: string): Promise<ArrayBuffer> => {
    // Tauri's postMessage fallback returns a byte array instead of an ArrayBuffer.
    const bytes = await command<ArrayBuffer | number[]>("read_song_audio", { id });
    return Array.isArray(bytes) ? new Uint8Array(bytes).buffer : bytes;
  },
  generate: (request: Generation) => command<{ ids: string[] }>("generate", { request }),
  patch: (id: string, patch: { title?: string; favorite?: boolean; folder_id?: string | null }) => command<Song>("patch_song", { id, patch }),
  cancel: (id: string) => command<boolean>("cancel_song", { id }),
  remove: (id: string) => command<void>("delete_song", { id }),
  retry: (id: string) => command<Song>("retry_song", { id }),
  folders: () => command<{ folders: Folder[]; all: number; none: number }>("list_folders"),
  saveFolder: (name: string, id: string | null = null) => command<Folder>("save_folder", { id, name }),
  deleteFolder: (id: string) => command<void>("delete_folder", { id }),
  queue: () => command<Queue>("queue"),
  settings: () => command<Settings>("get_settings"),
  configureSettingsMenu: (text: string, enabled: boolean) => command<void>("configure_settings_menu", { text, enabled }),
  saveSettings: (values: SettingsPatch) => command<Settings>("save_settings", { values }),
  openSongsFolder: () => command<void>("open_songs_folder"),
  phoneAccess: () => command<import("./types").PhoneAccess>("phone_access_status"),
  setPhoneAccess: (change: { enabled?: boolean; newToken?: boolean }) => command<import("./types").PhoneAccess>("set_phone_access", { enabled: change.enabled ?? null, newToken: change.newToken ?? false }),
  generationPolicy: (selection?: ModelSelection, refresh = false) => command<GenerationPolicy>("generation_policy", { selection: selection ?? null, refresh }),
  generationFormPreferences: () => command<GenerationFormPreferences>("get_generation_form_preferences"),
  saveGenerationFormPreferences: (values: GenerationFormPreferences) => command<void>("save_generation_form_preferences", { values }),
  health: () => command<Health>("health"),
  analyze: async (file: File, selection?: ModelSelection) => {
    if (file.size > 60 * 1024 * 1024) throw new Error("audio_size");
    const filename = /\.(wav|mp3|flac|m4a|ogg)$/i.test(file.name) ? file.name : `${file.name}.wav`;
    const query = new URLSearchParams({ filename });
    if (selection) query.set("selection", JSON.stringify(selection));
    const url = `${convertFileSrc("analyze", "audio-analysis")}?${query}`;
    const body = await file.arrayBuffer();
    const response = await fetch(url, { method: "POST", body }).catch(() => { throw new Error("audio_read"); });
    const result = await response.json();
    if (!response.ok) throw new Error(typeof result === "string" ? result : "audio_read");
    return result as Record<string, unknown>;
  },
  export: (kind: "audio" | "midi" | "lyrics" | "zip", destination: string, id: string | null = null, folder: string | null = null) => command<void>("export_file", { kind, destination, id, folder }),
  exportDefaultPath: (filename: string) => command<string>("export_default_path", { filename }),
  checkUpdate: (stream: UpdateStream) => command<Update>("check_update", { stream }),
  exit: () => command<void>("exit_app"),
};
