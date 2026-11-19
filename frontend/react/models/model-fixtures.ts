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
  const selection = { provider: "heartmula", synthesis: "heartmula-oss-3b-hny", language: "" };
  const base = "https://github.com/0xShug0/audio.cpp";
  const upstream = ["HeartMuLa/HeartMuLa-oss-3B-happy-new-year", "HeartMuLa/HeartCodec-oss-20260123"];
  const upstream_sources = upstream.map((repository, index) => ({
    id: repository, role: index ? "codec" : "weights", repository, revision: "fixture",
    license: "Apache-2.0", license_url: "https://www.apache.org/licenses/LICENSE-2.0",
  }));
  const weights: CatalogModel[] = upstream_sources.map((item, index) => ({
    file: `heartmula/${index ? "codec" : "weights"}.safetensors`, provider: selection.provider,
    role: index ? "codec" : "weights", family: "heartmula", precision: "BF16",
    estimated_bytes: 1024, sha256: "a".repeat(64), recommended_steps: null,
    verified: false, present: false, partial_bytes: 0,
    source: { repository: item.repository, revision: item.revision, path: "model.safetensors" },
  }));
  const profile: CatalogProfile = {
    selection, name: "HeartMuLa 3B Happy New Year", files: weights.map(model => model.file),
    capabilities: { min_duration: 5, max_duration: 30, max_variants: 1, prompt: false, lyrics: true,
      lyrics_required: true, instrumental: false, bpm: false, advanced: false, analysis: false, max_seed: 4294967295 },
    runtime: { name: "audio.cpp", revision: "fixture", source: base, license: "Apache-2.0", license_url: `${base}/blob/main/LICENSE` },
    upstream_sources, usage: { model_use: "Apache-2.0", redistribution: "Apache-2.0", outputs: "Check the applicable rights." },
    platforms: [], available: false,
  };
  const catalog = structuredClone(catalogFixture);
  return {
    ...catalog,
    providers: [...catalog.providers, { id: selection.provider, name: profile.name, status: "available", adapter: "audio.cpp", source: base }],
    profiles: [profile],
    models: [...catalog.models, ...weights],
  };
}

