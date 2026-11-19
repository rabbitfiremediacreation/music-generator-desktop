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
  const catalog = structuredClone(catalogFixture);
  const heartmula: CatalogProfile = {
    selection: { provider: "heartmula", synthesis: "heartmula-oss-3b-hny", language: "" },
    name: "HeartMuLa 3B HNY", available: false, platforms: [],
    files: ["heartmula-weights.safetensors", "heartmula-codec.safetensors"],
    acquisition: "download",
    capabilities: { prompt: false, lyrics: true, lyrics_required: true, instrumental: false, bpm: false, advanced: false, analysis: false, min_duration: 5, max_duration: 30, max_variants: 1, max_seed: 4294967295 },
    runtime: { name: "heartlib", revision: "test-revision", source: "https://github.com/HeartMuLa/heartlib", license: "Apache-2.0", license_url: "https://www.apache.org/licenses/LICENSE-2.0" },
    upstream_sources: [
      { id: "weights", role: "weights", repository: "HeartMuLa/HeartMuLa-oss-3B-happy-new-year", revision: "test-revision", license: "Apache-2.0", license_url: "https://www.apache.org/licenses/LICENSE-2.0" },
      { id: "codec", role: "codec", repository: "HeartMuLa/HeartCodec-oss-20260123", revision: "test-revision", license: "Apache-2.0", license_url: "https://www.apache.org/licenses/LICENSE-2.0" },
    ],
    usage: { model_use: "Apache-2.0", redistribution: "Preserve licensing notices.", outputs: "See the model card." },
  };
  return {
    ...catalog,
    providers: [...catalog.providers, { id: "heartmula", name: "HeartMuLa", adapter: "heartlib", source: heartmula.runtime.source, status: "available" }],
    profiles: [heartmula],
    models: [...catalog.models, ...heartmula.files.map((file, index): CatalogModel => ({
      provider: "heartmula", family: heartmula.selection.synthesis, file, role: index === 0 ? "weights" : "codec",
      precision: "FP16", estimated_bytes: 1024, sha256: "0".repeat(64), recommended_steps: null,
      verified: false, present: false, partial_bytes: 0,
    }))],
  };
}

export function catalogWithMimetic(): ModelCatalog {
  const catalog = structuredClone(catalogFixture);
  const profile = source.profiles.find(item => item.selection.provider === "mimetic-a0")!;
  const provider = source.providers.find(item => item.id === "mimetic-a0")!;
  return {
    ...catalog,
    providers: [...catalog.providers, { ...provider, status: "available" }],
    profiles: [{ ...profile, acquisition: "download", available: true }],
    recommended_profiles: [...catalog.recommended_profiles, profile.selection],
    models: [...catalog.models, ...source.models.filter(model => model.provider === "mimetic-a0").map(model => ({
      ...model, role: model.role as CatalogModel["role"], verified: false, present: false, partial_bytes: 0,
    }))],
  };
}
