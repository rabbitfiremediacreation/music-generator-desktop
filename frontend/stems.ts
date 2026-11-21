import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { AudioFormat } from "./audio-formats";

export interface Pin { model: string; repository: string; revision: string }
export interface StemFile { file: string; bytes: number; sha256: string }
export interface StemRevision extends Pin { artifact: StemFile }
export interface StemProfile {
  id: string;
  name: string;
  author: string;
  repository: string;
  revision: string;
  roles: string[];
  architecture: string;
  engine: string;
  engine_version: string;
  code_license: string;
  weights_license: string;
  artifact: StemFile;
  configuration: StemFile;
  error: string | null;
  active: StemRevision | null;
  installed: StemRevision[];
  pending: StemRevision | null;
  status: string;
  downloaded: number;
}
export interface StemCatalog { engine_ready: boolean; python_required: boolean; platform_supported: boolean; models: StemProfile[] }
export interface HubHit { repository: string; revision: string | null; license: string | null; restricted: boolean; pin: Pin | null; artifact: StemFile | null; adapter_check_required: boolean }
export interface ModelRemoval { bytes: number; files: { file: string; bytes: number; shared: boolean }[]; busy: boolean }
export interface StemSource {
  id: string;
  song_id: string | null;
  name: string;
  hash: string;
  audio: { rate: number; channels: number; frames: number; peaks: number[] };
}
export interface StemRequest {
  source_id: string;
  pin: Pin;
  name: string;
  folder_id?: string | null;
  start: number;
  end: number | null;
  quality: "standard" | "fast";
  overlap: number;
  outputs: string[];
  preview: boolean;
}
export interface StemProject {
  rate: number;
  channels: number;
  frames: number;
  source_start_frame: number;
  source_frames: number;
  roles: string[];
  engine: string;
  engine_version: string;
  backend: string;
  original_peak: number;
  track_peaks: number[];
}
export interface StemJob {
  id: string;
  request: StemRequest;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  phase: string;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  project: StemProject | null;
  source: StemSource;
}
export interface ChannelFx {
  low_db: number; mid_db: number; high_db: number; comp: number; limit: number; width: number; filter: number;
}
export interface Track {
  role: string; name: string; replacement?: string; gain_db: number; pan: number;
  mute: boolean; solo: boolean; fade_in: number; fade_out: number;
  fx?: Partial<ChannelFx>; gain_off?: boolean; export?: boolean;
}
export interface StemMix {
  tracks: Track[]; master_db: number; first: number; end: number; looping: boolean;
  version?: number; master_comp?: number; master_limit?: number; master_off?: boolean;
}
export interface MixVersion { id: string; name: string; mix: StemMix; updated_at: string }
export type ExportKind = "raw" | "processed" | "mix" | "package";
export type WaveFormat = "float32" | "pcm16" | "pcm24";
export interface StemExportRequest {
  project_id: string; kind: ExportKind; mix: StemMix; selected: string[];
  format: AudioFormat; wav_format: WaveFormat; sample_rate?: number; channels?: number; keep_position: boolean;
  include_original: boolean; include_mix: boolean;
}
export interface StemExport {
  id: string;
  status: StemJob["status"];
  progress: number;
  error: string | null;
  outputs: { file: string; peak: number | null; clipped: boolean }[];
}

export const neutralFx: Readonly<ChannelFx> = { low_db: 0, mid_db: 0, high_db: 0, comp: 0, limit: 0, width: 100, filter: 0 };

export function defaultTrack(role: string): Track {
  return { role, name: role, gain_db: 0, pan: 0, mute: false, solo: false, fade_in: 0, fade_out: 0,
    fx: { ...neutralFx }, gain_off: false, export: true };
}

export function defaultMix(project: StemProject): StemMix {
  return { version: 2, tracks: project.roles.map(defaultTrack), master_db: 0, master_comp: 0, master_limit: 0,
    master_off: false, first: 0, end: project.frames, looping: false };
}

export function upgradeMix(mix: StemMix): StemMix {
  return { ...mix, version: 2, master_comp: mix.master_comp ?? 0, master_limit: mix.master_limit ?? 0, master_off: mix.master_off ?? false,
    tracks: mix.tracks.map(track => ({ ...defaultTrack(track.role), ...track, fx: { ...neutralFx, ...track.fx } })) };
}

export function audibleTracks(mix: StemMix) {
  const solo = mix.tracks.some(track => track.solo);
  return mix.tracks.filter(track => !track.mute && (!solo || track.solo));
}

export function stemRole(role: string, t: (key: string) => string) {
  return t(role.startsWith("layer_") ? "stem_imported_track" : `stem_role_${role}`);
}

export function samePin(a: Pin | null | undefined, b: Pin | null | undefined) {
  return Boolean(a && b && a.model === b.model && a.repository === b.repository && a.revision === b.revision);
}

export function sourceDuration(source: StemSource) {
  return source.audio.frames / source.audio.rate;
}

export const stemApi = {
  models: () => invoke<StemCatalog>("stem_models"),
  search: (query: string, limit: number) => invoke<HubHit[]>("stem_search", { query, limit }),
  cancelSearch: () => invoke("stem_cancel_search"),
  checkConnection: () => invoke("stem_hf_check"),
  checkUpdate: (id: string) => invoke<HubHit>("stem_check_update", { id }),
  installEngine: () => invoke("stem_install_engine"),
  installModel: (pin: Pin) => invoke("stem_install_model", { pin }),
  pause: (id: string) => invoke("stem_pause_transfer", { id }),
  discard: (id: string) => invoke("stem_discard_partial", { id }),
  removal: (pin: Pin) => invoke<ModelRemoval>("stem_model_removal", { pin }),
  remove: (pin: Pin) => invoke("stem_remove_model", { pin }),
  activate: (pin: Pin) => invoke("stem_activate_model", { pin }),
  songSource: (id: string) => invoke<StemSource>("stem_song_source", { id }),
  pickSources: (title: string) => invoke<{ name: string; source: StemSource | null; error: string | null }[]>("stem_pick_sources", { title }),
  async upload(file: File) {
    if (file.size > 60 * 1024 * 1024) throw new Error("audio_size");
    const url = `${convertFileSrc("stems", "audio-analysis")}?filename=${encodeURIComponent(file.name)}`;
    const response = await fetch(url, { method: "POST", body: await file.arrayBuffer() });
    const value = await response.json();
    if (!response.ok) throw new Error(typeof value === "string" ? value : "audio_read");
    return value as StemSource;
  },
  sourceAudio: async (id: string) => convertFileSrc(await invoke<string>("stem_source_audio", { id })),
  relink: (id: string, title: string) => invoke<boolean>("stem_relink_source", { id, title }),
  addTrack: (id: string, title: string) => invoke<{ role: string; name: string } | null>("stem_add_track", { id, title }),
  projectAudio: async (id: string, role: string) => convertFileSrc(await invoke<string>("stem_project_audio", { id, role })),
  preflight: (request: StemRequest) => invoke<{ frames: number; bytes: number; seconds: number }>("stem_preflight", { request }),
  start: (request: StemRequest) => invoke<string>("stem_start", { request }),
  jobs: (songId?: string, sourceId?: string, offset = 0, folderId?: string) => invoke<StemJob[]>("stem_jobs", { songId: songId ?? null, sourceId: sourceId ?? null, folderId: folderId || null, offset }),
  job: (id: string) => invoke<StemJob>("stem_job", { id }),
  latestProject: (songId: string) => invoke<StemJob>("stem_latest_project", { songId }),
  removeProject: (id: string) => invoke<void>("stem_remove_project", { id }),
  cancel: (id: string) => invoke("stem_cancel", { id }),
  retry: (id: string) => invoke("stem_retry", { id }),
  mixes: (id: string) => invoke<MixVersion[]>("stem_mixes", { id }),
  saveMix: (id: string, version: string | null, name: string, mix: StemMix) => invoke<MixVersion>("stem_save_mix", { id, version, name, mix }),
  startExport: (request: StemExportRequest) => invoke<string>("stem_start_export", { request }),
  exports: (id: string) => invoke<StemExport[]>("stem_exports", { id }),
  cancelExport: (id: string) => invoke("stem_cancel_export", { id }),
  saveExport: (id: string, title: string) => invoke<string | null>("stem_save_export", { id, title }),
  openExport: (id: string) => invoke("stem_open_export", { id }),
};

export function stemError(error: unknown, t: (key: string) => string) {
  const key = error instanceof Error ? error.message : String(error);
  return t(key);
}
