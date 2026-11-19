import source from "../../../models/catalog.json";
import type { CatalogModel, CatalogProfile, ModelCatalog, Settings } from "../../types";
import { setupFixture, standard } from "../setup/fixtures";

export const xl = { ...standard, synthesis: "acestep-v15-xl-sft-Q8_0.gguf" };
export const turbo = { ...standard, synthesis: "acestep-v15-turbo-Q8_0.gguf" };
export const saved = (selection = standard): Settings => ({ ...setupFixture.settings, model_provider: selection.provider, synthesis_model: selection.synthesis, lm_model: selection.language, expert_mode: true, recommended_profiles: [standard, xl] });
export const catalogFixture: ModelCatalog = { ...source, expert_mode: true, recommended_profiles: [standard, xl], selection: standard,
  hardware: setupFixture.hardware, free_bytes: null, models_dir: "/models", busy: false,
  title_model: { ...setupFixture.title_model, verified: true, present: true, partial_bytes: 0 },
  providers: source.providers.filter(provider => provider.id === "ace-step").map(provider => ({ ...provider, status: "available" })),
  profiles: [],
  models: source.models.filter(model => model.provider === "ace-step").map(model => ({ ...model, role: model.role as CatalogModel["role"], verified: true, present: true, partial_bytes: 0 })),
};

export function catalogWithHeartMuLa(): ModelCatalog {
  // The shared provider UI tests also run on branches that do not ship HeartMuLa.
  const file = "heartmula/HeartMuLa-oss-3B/config.json";
  const sources = [
    { id: "heartmula-hny", role: "weights", repository: "HeartMuLa/HeartMuLa-oss-3B-happy-new-year", revision: "41d4faafc5bde6990bf8505daa70840fb3c4a3e7" },
    { id: "heartcodec-20260123", role: "codec", repository: "HeartMuLa/HeartCodec-oss-20260123", revision: "58ec14fd02a123316e4fdaa9fe49fa7a902d1a6f" },
  ].map(source => ({ ...source, license: "Apache-2.0", license_url: "https://www.apache.org/licenses/LICENSE-2.0" }));
  return {
    ...structuredClone(catalogFixture),
    providers: [...catalogFixture.providers, { id: "heartmula", name: "HeartMuLa", status: "available", adapter: "audio.cpp", source: "https://github.com/HeartMuLa/heartlib" }],
    profiles: [{
      selection: { provider: "heartmula", synthesis: "heartmula-oss-3b-hny", language: "" }, name: "HeartMuLa 3B Happy New Year", files: [file],
      capabilities: { min_duration: 5, max_duration: 30, max_variants: 1, prompt: false, lyrics: true, lyrics_required: true, instrumental: false, bpm: false, advanced: false, analysis: false, max_seed: 4294967295 },
      upstream_sources: sources, runtime: { name: "audio.cpp", revision: "v0.9.5", source: "https://github.com/0xShug0/audio.cpp", license: sources[0].license, license_url: sources[0].license_url },
      usage: { model_use: "Apache-2.0", redistribution: "Include the license", outputs: "Check output rights" },
      platforms: [], available: false,
    }],
    models: [...structuredClone(catalogFixture.models), { file, role: "weights", provider: "heartmula", family: "heartmula-hny", precision: "", estimated_bytes: 308, sha256: "a05bf0650f560d235fb3a0c109173d44eb3a9b6231fe599968e12706cd20edf4", recommended_steps: null, verified: false, present: false, partial_bytes: 0 }],
  };
}

export function catalogWithMagenta(available = false): ModelCatalog {
  const id = "magenta-realtime-2";
  const profile = source.profiles.find(profile => profile.selection.provider === id)!;
  return {
    ...structuredClone(catalogFixture),
    hardware: { ...catalogFixture.hardware, ram_bytes: profile.platforms[0]?.minimum_ram_bytes ?? catalogFixture.hardware.ram_bytes },
    providers: [...catalogFixture.providers, { ...source.providers.find(provider => provider.id === id)!, status: "available" }],
    profiles: [{ ...profile, acquisition: profile.acquisition as CatalogProfile["acquisition"], available }],
    models: [...structuredClone(catalogFixture.models), ...source.models.filter(model => model.provider === id).map(model => ({ ...model, role: model.role as CatalogModel["role"], verified: false, present: false, partial_bytes: 0 }))],
  };
}

