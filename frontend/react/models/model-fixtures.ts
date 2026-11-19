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
  const result = structuredClone(catalogFixture);
  result.providers.push({ id: "heartmula", name: "HeartMuLa", status: "available", adapter: "heartmula", source: "https://github.com/HeartMuLa/heartlib" });
  result.profiles = [{
    selection: { provider: "heartmula", synthesis: "heartmula-oss-3b-hny", language: "" },
    name: "HeartMuLa 3B HNY", files: [], available: false, platforms: [],
    capabilities: {
      min_duration: 5, max_duration: 30, max_variants: 1, prompt: false,
      lyrics: true, lyrics_required: true, instrumental: false,
      bpm: false, advanced: false, analysis: false, max_seed: 4294967295,
    },
    runtime: { name: "HeartMuLa", revision: "test-runtime", source: "https://github.com/HeartMuLa/heartlib", license: "Apache-2.0", license_url: "https://www.apache.org/licenses/LICENSE-2.0" },
    upstream_sources: [
      { id: "model", role: "model", repository: "HeartMuLa/HeartMuLa-oss-3B-happy-new-year", revision: "test-model", license: "Apache-2.0", license_url: "https://www.apache.org/licenses/LICENSE-2.0" },
      { id: "codec", role: "codec", repository: "HeartMuLa/HeartCodec-oss-20260123", revision: "test-codec", license: "Apache-2.0", license_url: "https://www.apache.org/licenses/LICENSE-2.0" },
    ],
    usage: { model_use: "Private and commercial use", redistribution: "Keep license and notices", outputs: "Check composition rights" },
  }];
  return result;
}

export function catalogWithProfile(providerId: string, available: boolean): ModelCatalog {
  const profiles = source.profiles as Omit<CatalogProfile, "available">[];
  const profile = profiles.find(value => value.selection.provider === providerId);
  if (!profile) throw new Error(`Missing catalog fixture for ${providerId}`);
  return {
    ...structuredClone(catalogFixture),
    providers: source.providers.filter(provider => provider.id === "ace-step" || provider.id === providerId).map(provider => ({ ...provider, status: "available" })),
    profiles: [{ ...profile, available, platforms: available ? profile.platforms : [] }],
    models: source.models.filter(model => model.provider === "ace-step" || model.provider === providerId).map(model => ({ ...model, role: model.role as CatalogModel["role"], verified: model.provider === "ace-step", present: model.provider === "ace-step", partial_bytes: 0 })),
  };
}

