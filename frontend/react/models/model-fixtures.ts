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
  // The shared UI tests also run before the HeartMuLa provider catalog lands.
  const selection = { provider: "heartmula", synthesis: "heartmula-fixture", language: "" };
  const name = "HeartMuLa 3B";
  const repositories = ["HeartMuLa/HeartMuLa-oss-3B-happy-new-year", "HeartMuLa/HeartCodec-oss-20260123"];
  const files = ["heartmula-fixture/weights.gguf", "heartmula-fixture/codec.gguf"];
  const catalog = structuredClone(catalogFixture);
  return {
    ...catalog,
    providers: [...catalog.providers, { id: selection.provider, name, status: "available", adapter: "audio.cpp", source: "https://github.com/0xShug0/audio.cpp" }],
    profiles: [{
      selection, name, files, available: false, platforms: [], acquisition: "download",
      capabilities: { min_duration: 10, max_duration: 240, max_variants: 1, prompt: false, lyrics: true, lyrics_required: true, instrumental: false, bpm: false, advanced: false, analysis: false },
      runtime: { name: "audio.cpp", revision: "test-runtime", source: "https://github.com/0xShug0/audio.cpp", license: "Apache-2.0", license_url: "https://github.com/0xShug0/audio.cpp/blob/main/LICENSE" },
      upstream_sources: repositories.map((repository, index) => ({
        id: repository, repository, revision: "test-revision", role: index ? "codec" : "weights", license: "Apache-2.0",
        license_url: `https://huggingface.co/${repository}/blob/main/LICENSE`,
      })),
      usage: { model_use: "", redistribution: "", outputs: "" },
    }],
    models: [...catalog.models, ...files.map((file, index): CatalogModel => ({
      file, provider: selection.provider, role: index ? "codec" : "weights", family: name,
      precision: "GGUF", estimated_bytes: 1024, sha256: "a".repeat(64), recommended_steps: null,
      verified: false, present: false, partial_bytes: 0,
    }))],
  };
}

export function catalogWithMiniMax(): ModelCatalog {
  const provider = source.providers.find(item => item.id === "minimax-music3")!;
  const profile = source.profiles.find(item => item.selection.provider === provider.id)!;
  const catalog = structuredClone(catalogFixture);
  return {
    ...catalog,
    providers: [...catalog.providers, { ...provider, status: "preview" }],
    profiles: [{ ...profile, acquisition: "manual", available: false, unavailable_reason: profile.release_hold }],
    models: [...catalog.models, ...source.models.filter(model => model.provider === provider.id).map(model => ({
      ...model, role: model.role as CatalogModel["role"], present: true, verified: false, partial_bytes: 0,
    }))],
  };
}

