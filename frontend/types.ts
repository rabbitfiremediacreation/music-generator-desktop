import type { AudioFormat } from "./audio-formats";

export type UpdateStream = "stable" | "daily" | "develop";
export type CpuIterationBehavior = "ask" | "limit_30" | "continue";
export interface McpSettings { enabled: boolean; port: number; scope: "local" | "network" }
export interface McpHttpConnection { url: string; token: string; client_config: string }
export interface McpSettingsStatus extends McpSettings {
  running: boolean; url: string | null; urls: string[]; config_path: string; client_config: string;
  managed_by_environment: boolean; error: string | null; certificate_fingerprint?: string | null;
}
export interface Settings {
  models_dir: string; songs_dir: string; lm_model: string; dit: "standard" | "xl";
  model_provider: string; synthesis_model: string;
  model_profiles?: Record<string, ModelSelection>;
  lm_device: "auto" | "cpu"; export_format: AudioFormat; mp3_available?: boolean;
  export_formats?: AudioFormat[];
  expert_mode: boolean;
  generate_cover_art?: boolean;
  cover_art_supported?: boolean;
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
export type RemixMode = "cover" | "cover-nofsq";
export interface Generation {
  model_selection?: ModelSelection;
  reference_audio?: string;
  remix?: { mode: RemixMode; source_song_id?: string };
  prompt?: string; style?: string; caption?: string; lyrics?: string; instrumental?: boolean;
  keep_caption?: boolean; title?: string; duration?: number; bpm?: number; bars?: number; keyscale?: string;
  ignore_recommended_duration?: boolean;
  timesignature?: string; vocal_language?: string; seed?: number; variants?: number;
  inference_steps?: number; lm_temperature?: number; group_id?: string; folder_id?: string | null;
  yue2?: Yue2Options;
}
export type Yue2Sampling = Partial<Record<"temperature" | "top_p" | "top_k" | "repetition_penalty" | "penalty_window" | "min_tokens" | "max_tokens", number>>;
export interface Yue2Options {
  lm_seed?: number;
  steps?: number;
  cot?: "full" | "melody" | "off";
  cfg_scale?: number;
  peak_clip?: number;
  abc?: string;
  abc_sampling?: Yue2Sampling;
  semantic_sampling?: Yue2Sampling;
}
export type OutputKind = "audio" | "midi";
export interface Song {
  stem_project_count?: number;
  stem_mix_count?: number;
  stem_status?: "queued" | "running" | "done" | "error" | "cancelled";
  id: string; group_id: string; created_at: string; finished_at: string | null;
  started_at?: string | null;
  status: "queued" | "running" | "done" | "error" | "cancelled"; message: string | null;
  title: string | null; caption: string; lyrics: string | null; seed: number;
  params: Generation & { generation_profile?: { provider?: string; model_revision?: string; capabilities?: Partial<ModelAbilities> } };
  result_meta: Record<string, unknown> | null; file: string | null;
  engine?: string | null;
  output_kind?: OutputKind; audio_missing: boolean;
  favorite: boolean; folder_id: string | null; letter: string; path: string | null; url?: string | null;
  cover_path?: string; cover_url?: string;
}
export interface Folder { id: string; name: string; count: number }
export interface Filter { q?: string; favorites?: boolean; group?: string; folder?: string }
export interface SongPage { songs: Song[]; total: number }
export interface Queue { progress: JobProgress | null; running: { id: string; caption: string; message: string | null }[]; queued: number; active: boolean; library: { count: number; bytes: number }; audio_export?: { default_format: AudioFormat; formats: AudioFormat[] } }

export interface WorkJob {
  id: string; caption: string; title?: string | null; status: "queued" | "running"; kind: "song" | "separation" | "export" | "stem_generation";
  progress?: number | null;
}
export interface QueuedDownload {
  id: string; file: string; phase: "queued" | "downloading" | "verifying" | "done" | "cancelled" | "error";
  downloaded: number; total: number; error: string | null;
}
export interface WorkQueue {
  jobs: WorkJob[]; progress: Pick<JobProgress, "job_id" | "overall_percent"> | null; downloads: QueuedDownload[]; download_limit: number;
}
export interface CompletedWorkPage {
  jobs: { id: string; kind: WorkJob["kind"] | "remix"; label: string | null; finished_at: string }[];
  next_offset: number | null;
}
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
export interface EngineVersion { tag: string | null; revision: string }
export interface EnginePackage {
  id: string; bytes: number; installed: boolean; update_available: boolean; removable: boolean; install_command: string | null;
  installed_version: EngineVersion | null; available_version: EngineVersion | null;
}
export interface CudaStatus {
  state: "not_applicable" | "unsupported_build" | "unsupported_gpu" | "check_failed" | "driver_error" | "runtime_missing" | "cuda_failed" | "ready";
  download_bytes: number; details: string | null;
}
export interface Update { native?: boolean; available: boolean; current: string; latest?: string; url?: string | null; notes?: string | null }
export interface Model { file: string; estimated_bytes: number; sha256: string; kind: string }
export interface Bootstrap {
  recommended_profiles: ModelSelection[];
  optional_engines?: boolean;
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
export interface DownloadProgress { file: string; phase: "downloading" | "verifying" | "installing"; downloaded: number; total: number; bytes_per_second: number }

export interface JobProgress {
  job_id: string; sequence: number; phase: "starting" | "loading" | "generation" | "planning" | "lm" | "synth" | "dit" | "vae" | "saving" | "saving_midi" | "title" | "title_download" | "cover_art_download" | "cover_art" | "complete";
  step: number | null; total_steps: number | null; elapsed_seconds: number;
  overall_percent?: number;
  estimated_remaining_seconds?: number;
}

export interface ModelSelection { provider: string; synthesis: string; language: string }
export interface HuggingFacePin {
  source: { repository: string; revision: string; path: string };
  bytes: number;
  sha256: string;
}
export interface HuggingFaceCandidate {
  pin: HuggingFacePin;
  provider: string;
  role: string;
  family: string;
  precision: string;
  estimated_ram_bytes?: number | null;
  selection: ModelSelection | null;
}
export interface HuggingFaceDiscovery {
  candidates: HuggingFaceCandidate[];
  unavailable_repositories: string[];
}
export type ModelRemoval = { kind: "file"; file: string } | { kind: "profile"; selection: ModelSelection };
export interface ModelAbilities {
  min_duration: number; max_duration: number; max_variants: number;
  prompt: boolean; lyrics: boolean; lyrics_required: boolean; instrumental: boolean;
  style_description?: boolean;
  bpm: boolean; advanced: boolean; analysis: boolean;
  reference_audio?: boolean;
  yue2_options?: boolean;
  max_seed?: number;
  bars?: number[];
  output_kind?: OutputKind;
}
export interface ProfileSource {
  id: string; role: string; repository: string; revision: string; license: string; license_url: string;
  source_url?: string;
  gated?: boolean;
}
export interface ProfilePlatform {
  os: string; arch: string; backend: string; minimum_ram_bytes: number; minimum_vram_bytes?: number | null;
}
interface ProfileRuntimeComponent { name: string; revision: string; source: string; license: string; license_url: string }
export interface CatalogProfile {
  selection: ModelSelection; name: string; files: string[]; capabilities: ModelAbilities;
  estimated_ram_bytes: number;
  acquisition?: "download" | "manual";
  upstream_sources: ProfileSource[];
  runtime: ProfileRuntimeComponent & { components?: ProfileRuntimeComponent[] };
  usage: { model_use: string; redistribution: string; outputs: string; policy_url?: string; noncommercial_evaluation?: boolean };
  platforms: ProfilePlatform[];
  evaluation_platforms?: ProfilePlatform[];
  runtime_note?: string;
  expert_only?: boolean;
  available: boolean; engine_installed?: boolean; unavailable_reason?: string | null;
  install_command?: string;
}
export interface ActiveGenerationProfile {
  selection: ModelSelection; name: string; capabilities: ModelAbilities;
  analysis_available?: boolean;
  available: boolean; unavailable_reason?: string | null;
}
export interface CatalogModel {
  file: string; provider: string; role: "synthesis" | "language" | "dependency" | "weights" | "codec" | "tokenizer" | "config" | "license"; family: string;
  category?: "llm" | "embedding";
  precision: string; estimated_bytes: number; sha256: string; recommended_steps: number | null; suggested_steps?: number | null;
  verified: boolean; present: boolean; partial_bytes: number;
  source?: { repository: string; revision: string; path: string } | null;
  hf_discovered?: boolean;
}
export interface TitleModel extends Model { verified: boolean; present: boolean; partial_bytes: number }
export interface ModelCatalog {
  title_model: TitleModel;
  version: number; revision: string; models: CatalogModel[];
  expert_mode: boolean; expert_families: string[];
  basic_models: { synthesis: string[]; language: string[] };
  recommended_profiles: ModelSelection[];
  profiles?: CatalogProfile[];
  providers: { id: string; name: string; status: "available" | "planned" | "preview"; adapter: string | null; source: string }[];
  ace_step_available?: boolean;
  selection: ModelSelection; hardware: Bootstrap["hardware"]; free_bytes: number | null;
  model_profiles?: Record<string, ModelSelection>;
  models_dir: string; busy: boolean;
}

export type SettingsPatch = Partial<Pick<Settings, "timeout_minutes" | "songs_dir" | "lm_device" | "export_format" | "expert_mode" | "cpu_iteration_behavior" | "update_stream" | "generate_cover_art">>;

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
  analysis_available?: boolean;
  available?: boolean;
  unavailable_reason?: string | null;
}

/** Shared access switch for the native app and the HTTPS web app. */
export interface PhoneAccess {
  enabled: boolean; port: number; token: string; addresses: string[];
  web_port?: number; web_addresses?: string[]; certificate_fingerprint?: string | null;
}
