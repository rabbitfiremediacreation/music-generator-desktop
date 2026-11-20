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

export function catalogWithHeartMuLa(): ModelCatalog {
  return catalogWithProvider("heartmula");
}

export function catalogWithStableAudio(available = false): ModelCatalog {
  return catalogWithProvider("stable-audio-3", available);
}

export function catalogWithMiniMax(): ModelCatalog {
  return catalogWithProvider("minimax-music3");
}

export function catalogWithMagenta(available = false): ModelCatalog {
  const catalog = catalogWithProvider("magenta-realtime-2", available);
  if (available) {
    const profile = catalog.profiles![0];
    catalog.hardware = { ...catalog.hardware, ram_bytes: profile.platforms[0].minimum_ram_bytes };
    catalog.recommended_profiles.push(profile.selection);
  }
  return catalog;
}

function catalogWithProvider(id: string, available = false): ModelCatalog {
  return {
    ...structuredClone(catalogFixture),
    providers: source.providers.filter(provider => provider.id === "ace-step" || provider.id === id).map(provider => ({ ...provider, status: provider.status === "preview" ? "preview" : "available" })),
    profiles: source.profiles.filter(profile => profile.selection.provider === id).map(profile => ({ ...profile, platforms: available ? profile.platforms : [], available, unavailable_reason: profile.release_hold, acquisition: profile.acquisition === "manual" ? "manual" : "download" })),
    models: source.models.filter(model => model.provider === "ace-step" || model.provider === id).map(model => ({ ...model, role: model.role as CatalogModel["role"], verified: model.provider === "ace-step", present: model.provider === "ace-step", partial_bytes: 0 })),
  };
}

