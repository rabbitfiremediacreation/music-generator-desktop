import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import catalog from "../models/catalog.json";
import { setupFixture, standard } from "./react/setup/fixtures";
import type { Filter, GenerationFormPreferences, HuggingFaceCandidate, HuggingFacePin, ModelRemoval, ModelSelection, Settings, SettingsPatch, Song } from "./types";

export function installBrowserPreview() {
  const [, owner, repository, , revision] = new URL(catalog.base_url).pathname.split("/");
  const discovery = catalog.models.flatMap((model): HuggingFaceCandidate[] => {
    const legacy = model.provider === "ace-step" && (model.role === "synthesis" || model.role === "language");
    const source = legacy ? { repository: `${owner}/${repository}`, revision, path: model.file } : model.source;
    const profile = legacy ? standard : catalog.profiles.find(item => item.files.includes(model.file))?.selection;
    if (!source || !profile || (!legacy && (model.role !== "weights" ||
      !["Serveurperso/YuE2-GGUF", "audio-cpp/audio.cpp-gguf", "themindstudio/HeartMuLa-GGUF"].includes(source.repository)))) return [];
    return [{
      pin: { source, bytes: model.estimated_bytes, sha256: model.sha256 },
      selection: profile, provider: model.provider, role: model.role, family: model.family, precision: model.precision,
    }];
  });
  let settings: Settings = { ...setupFixture.settings, setup_complete: true, recommended_profiles: [standard] };
  let huggingFaceTokenConfigured = false;
  let preferences: GenerationFormPreferences = { duration: 90, bpm: 0, inference_steps: 30, lm_temperature: 1.2, variants: 2 };
  let selection = standard;
  const removedModels = new Set<string>();
  const songs: Song[] = [
    { id: "preview-1", title: "Night Train", caption: "A mellow jazz trio with brushed drums", favorite: true },
    { id: "preview-2", title: "First Light", caption: "Ambient synths and soft piano", favorite: false },
  ].map(song => ({
    ...song, group_id: song.id, letter: "A", created_at: "2026-11-01T10:00:00Z",
    finished_at: "2026-11-01T10:01:00Z", status: "done", message: null, lyrics: "[Instrumental]",
    seed: 42, params: { prompt: song.caption, duration: 30, model_selection: standard },
    result_meta: null, file: null, audio_missing: true, folder_id: null, path: null,
  }));

  function listSongs(filter: Filter = {}) {
    const query = filter.q?.trim().toLowerCase();
    return songs.filter(song =>
      (!query || `${song.title} ${song.caption}`.toLowerCase().includes(query)) &&
      (!filter.favorites || song.favorite) &&
      (!filter.group || song.group_id === filter.group) &&
      (!filter.folder || filter.folder === "none" || song.folder_id === filter.folder));
  }

  mockWindows("main");
  mockIPC((command, payload) => {
    const args = (payload ?? {}) as Record<string, unknown>;
    switch (command) {
      case "startup_status": return { attempt: 1 };
      case "startup_allowed": return true;
      case "startup_show_main":
      case "startup_complete":
      case "configure_app_menu":
        return undefined;
      case "bootstrap": return { ...setupFixture, needs_setup: false, settings };
      case "get_settings": return settings;
      case "save_settings":
        settings = { ...settings, ...(args.values as SettingsPatch) };
        return settings;
      case "get_generation_form_preferences": return preferences;
      case "save_generation_form_preferences":
        preferences = args.values as GenerationFormPreferences;
        return undefined;
      case "generation_policy":
        return { backend: "gpu", detected_backend: "metal", cpu_iteration_behavior: settings.cpu_iteration_behavior, recommended_steps: 30, defaults: preferences };
      case "health": {
        const component = { state: "not_started", backend: "unknown", device: null, reason: null };
        return { ok: true, backend_status: { state: "not_started", synthesis: component, language_model: component } };
      }
      case "list_songs": return listSongs(args.filter as Filter);
      case "list_song_page": {
        const matching = listSongs(args.filter as Filter);
        const offset = Number(args.offset);
        return { songs: matching.slice(offset, offset + Number(args.limit)), total: matching.length };
      }
      case "get_song": return songs.find(song => song.id === args.id);
      case "list_folders": return { folders: [], all: songs.length, none: songs.length };
      case "queue": return { running: [], queued: 0, active: false, progress: null, library: { count: songs.length, bytes: 0 } };
      case "model_catalog": {
        const titlePresent = !removedModels.has(setupFixture.title_model.file);
        return {
          ...catalog, expert_mode: settings.expert_mode, selection, recommended_profiles: [standard],
          hardware: setupFixture.hardware, free_bytes: null, models_dir: settings.models_dir, busy: false,
          title_model: { ...setupFixture.title_model, verified: titlePresent, present: titlePresent, partial_bytes: 0 },
          models: catalog.models.map(model => {
            const present = !removedModels.has(model.file);
            return { ...model, verified: present, present, partial_bytes: 0 };
          }),
        };
      }
      case "discover_hugging_face_models":
        return { candidates: discovery, unavailable_repositories: [] };
      case "hugging_face_token_status":
        return huggingFaceTokenConfigured;
      case "set_hugging_face_token":
        return huggingFaceTokenConfigured = Boolean(args.token);
      case "adopt_hugging_face_model": {
        const pin = args.pin as HuggingFacePin;
        const result = discovery.find(item => item.pin.source.repository === pin.source.repository && item.pin.source.path === pin.source.path);
        if (!result) throw new Error("hf_model_unsupported");
        if (result.selection?.provider === "ace-step") {
          const draft = args.draft as ModelSelection;
          return { ...(draft.provider === "ace-step" ? draft : standard), [result.role]: result.pin.source.path };
        }
        return result.selection;
      }
      case "plugin:dialog|message": {
        const [ok, cancel] = (args.buttons as { OkCancelCustom: [string, string] }).OkCancelCustom;
        return window.confirm(String(args.message)) ? ok : cancel;
      }
      case "remove_model": {
        const target = args.target as ModelRemoval;
        const files = target.kind === "file" ? [target.file] : catalog.profiles.find(({ selection }) =>
          selection.provider === target.selection.provider && selection.synthesis === target.selection.synthesis &&
          selection.language === target.selection.language)?.files ?? [];
        files.forEach(file => removedModels.add(file));
        return undefined;
      }
      case "select_models":
      case "use_models":
        selection = args.selection as ModelSelection;
        return selection;
      default: throw new Error(`Command unavailable in browser preview: ${command}`);
    }
  }, { shouldMockEvents: true });
}
