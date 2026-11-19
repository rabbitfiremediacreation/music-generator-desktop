export type UpdateStream = "stable" | "daily" | "develop";
export type CpuIterationBehavior = "ask" | "limit_30" | "continue";
export interface McpSettings { enabled: boolean; port: number; scope: "local" | "network" }
export interface McpHttpConnection { url: string; token: string; client_config: string }
export interface McpSettingsStatus extends McpSettings {
  running: boolean; url: string | null; urls: string[]; config_path: string; client_config: string;
  managed_by_environment: boolean; error: string | null;
}
export interface Settings {
  models_dir: string; songs_dir: string; lm_model: string; dit: "standard" | "xl";
  model_provider: string; synthesis_model: string;
  model_profiles?: Record<string, ModelSelection>;
  lm_device: "auto" | "cpu"; export_format: "wav" | "mp3"; mp3_available?: boolean;
  expert_mode: boolean;
  update_stream: UpdateStream;
  cpu_iteration_behavior: CpuIterationBehavior;
  recommended_profiles?: ModelSelection[];
  cpu_only?: boolean;
  poll_interval: number; timeout_minutes: number; mode: "single" | "split";
  vae_chunk: number | null; tested_fingerprint: string; setup_complete: boolean;
  songs_dir_default?: string; dit_xl_available?: boolean;
}
export interface GenerationFormPreferences {
  duration: number; bpm: number; inference_steps: number; lm_temperature: number; variants: number;
}
export interface Generation {
  model_selection?: ModelSelection;
  prompt?: string; style?: string; caption?: string; lyrics?: string; instrumental?: boolean;
  keep_caption?: boolean; title?: string; duration?: number; bpm?: number; keyscale?: string;
  timesignature?: string; vocal_language?: string; seed?: number; variants?: number;
  inference_steps?: number; lm_temperature?: number; group_id?: string; folder_id?: string | null;
}
export interface Song {
  id: string; group_id: string; created_at: string; finished_at: string | null;
  started_at?: string | null;
  status: "queued" | "running" | "done" | "error" | "cancelled"; message: string | null;
  title: string | null; caption: string; lyrics: string | null; seed: number;
  params: Generation; result_meta: Record<string, unknown> | null; file: string | null;
  audio_missing: boolean;
  favorite: boolean; folder_id: string | null; letter: string; path: string | null; url?: string | null;
}
export interface Folder { id: string; name: string; count: number }
export interface Filter { q?: string; favorites?: boolean; group?: string; folder?: string }
export interface SongPage { songs: Song[]; total: number }
export interface Queue { progress: JobProgress | null; running: { id: string; caption: string; message: string | null }[]; queued: number; active: boolean; library: { count: number; bytes: number } }
export type BackendReason = "cpu_requested" | "cpu_only" | "lm_selftest_failed" | "cuda_architecture_unsupported" | "cuda_initialization_failed";
export interface ComponentBackend {
  state: "not_started" | "unconfirmed" | "confirmed" | "stopped";
  backend: "cuda" | "vulkan" | "metal" | "cpu" | "unknown";
  device: string | null; reason: BackendReason | null;
}
export interface BackendStatus {
  state: "not_started" | "running" | "stopped";
  synthesis: ComponentBackend; language_model: ComponentBackend;
}
export interface Health { ok: boolean; error?: string; props?: { models?: Record<string, string[]> }; backend_status: BackendStatus }
export interface SetupResult { ok: boolean; mode: string; backend_status: BackendStatus }
export interface CudaStatus {
  state: "not_applicable" | "unsupported_build" | "unsupported_gpu" | "check_failed" | "driver_error" | "runtime_missing" | "cuda_failed" | "ready";
  download_bytes: number; details: string | null;
}
export interface Update { available: boolean; current: string; latest?: string; url?: string | null; notes?: string | null }
export interface Model { file: string; estimated_bytes: number; sha256: string; kind: string }
export interface Bootstrap {
  recommended_profiles: ModelSelection[];
  needs_setup: boolean; settings: Settings; version: string; data_dir: string; error: string | null;
  hardware: {
    ram_bytes: number; gpu: string; vram_bytes: number | null; recommended_lm: string; vae_chunk: number | null; platform: string; cpu_only: boolean;
    nvidia?: { compute_capability: string | null; driver_version: string | null } | null;
    cuda?: { minimum_compute_capability: string; architecture_supported: boolean | null } | null;
  };
  title_model: Model;
  manifest: { version: number; base_url: string; models: Model[] };
}
export interface SetupRequest { lm: string; xl: boolean; models_dir: string; songs_dir: string }
export interface DownloadProgress { file: string; phase: "downloading" | "verifying"; downloaded: number; total: number; bytes_per_second: number }

export interface JobProgress {
  job_id: string; sequence: number; phase: "starting" | "loading" | "lm" | "synth" | "dit" | "vae" | "saving" | "title" | "title_download";
  step: number | null; total_steps: number | null; elapsed_seconds: number;
}

export interface ModelSelection { provider: string; synthesis: string; language: string }
export interface ModelAbilities {
  min_duration: number; max_duration: number; max_variants: number;
  prompt: boolean; lyrics: boolean; lyrics_required: boolean; instrumental: boolean;
  bpm: boolean; advanced: boolean; analysis: boolean;
  max_seed?: number;
}
export interface ProfileSource {
  id: string; role: string; repository: string; revision: string; license: string; license_url: string;
}
export interface ProfilePlatform {
  os: string; arch: string; backend: string; minimum_ram_bytes: number; minimum_vram_bytes?: number | null;
}
export interface CatalogProfile {
  selection: ModelSelection; name: string; files: string[]; capabilities: ModelAbilities;
  acquisition?: "download" | "manual";
  upstream_sources: ProfileSource[];
  runtime: { name: string; revision: string; source: string; license: string; license_url: string };
  usage: { model_use: string; redistribution: string; outputs: string; policy_url?: string };
  platforms: ProfilePlatform[];
  available: boolean; unavailable_reason?: string | null;
}
export interface ActiveGenerationProfile {
  selection: ModelSelection; name: string; capabilities: ModelAbilities;
  available: boolean; unavailable_reason?: string | null;
}
export interface CatalogModel {
  file: string; provider: string; role: "synthesis" | "language" | "dependency" | "weights" | "codec" | "tokenizer"; family: string;
  precision: string; estimated_bytes: number; sha256: string; recommended_steps: number | null; suggested_steps?: number | null;
  verified: boolean; present: boolean; partial_bytes: number;
  source?: { repository: string; revision: string; path: string } | null;
}
export interface TitleModel extends Model { verified: boolean; present: boolean; partial_bytes: number }
export interface ModelCatalog {
  title_model: TitleModel;
  version: number; revision: string; models: CatalogModel[];
  expert_mode: boolean; expert_families: string[];
  basic_models: { synthesis: string[]; language: string[] };
  recommended_profiles: ModelSelection[];
  profiles?: CatalogProfile[];
  providers: { id: string; name: string; status: "available" | "planned"; adapter: string | null; source: string }[];
  selection: ModelSelection; hardware: Bootstrap["hardware"]; free_bytes: number | null;
  model_profiles?: Record<string, ModelSelection>;
  models_dir: string; busy: boolean;
}

export type SettingsPatch = Partial<Pick<Settings, "timeout_minutes" | "songs_dir" | "lm_device" | "export_format" | "expert_mode" | "cpu_iteration_behavior" | "update_stream">>;

export interface ImportRequest { root: string; songs_source: string | null; songs_dir: string; allow_partial: boolean }
export interface MissingAudio { id: string; title: string; file: string | null }
export interface ImportIssue { code: string; path: string }
export interface ImportPreview {
  songs: number; folders: number; files: number; bytes: number; free_bytes: number | null;
  songs_source: string; missing: MissingAudio[]; issues: ImportIssue[]; can_import: boolean;
}
export interface ImportResult { songs: number; files: number; songs_dir: string; missing: MissingAudio[] }
export interface ImportProgress { phase: "checking" | "copying" | "committing"; copied_bytes: number; total_bytes: number; files: number; total_files: number }

export interface GenerationPolicy {
  backend: "cpu" | "gpu" | "unknown";
  legacy_inference_steps?: number;
  probed_backend?: "cpu" | "gpu" | "unknown";
  detected_backend?: ComponentBackend["backend"];
  lm_device?: "auto" | "cpu";
  backend_status?: BackendStatus;
  cpu_iteration_behavior: CpuIterationBehavior;
  recommended_steps: number;
  defaults: GenerationFormPreferences;
  capabilities?: ModelAbilities;
  available?: boolean;
  unavailable_reason?: string | null;
}

/** Shared access switch for the native app and the HTTPS web app. */
export interface PhoneAccess {
  enabled: boolean; port: number; token: string; addresses: string[];
  web_port?: number; web_addresses?: string[]; certificate_fingerprint?: string | null;
}
