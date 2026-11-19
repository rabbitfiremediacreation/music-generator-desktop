import source from "../../../models/catalog.json";
import type { CatalogModel, ModelCatalog, Settings } from "../../types";
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

export function catalogWithNativeProfiles(): ModelCatalog {
  return {
    ...structuredClone(catalogFixture),
    providers: source.providers.map(provider => ({ ...provider, status: "available" })),
    profiles: source.profiles.map(profile => ({ ...profile, available: false, acquisition: profile.acquisition === "manual" ? "manual" : "download" })),
    models: source.models.map(model => ({ ...model, role: model.role as CatalogModel["role"], verified: model.provider === "ace-step", present: model.provider === "ace-step", partial_bytes: 0 })),
  };
}

