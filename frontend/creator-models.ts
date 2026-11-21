import { modelLabel } from "./expert-mode";
import { installedSelection } from "./installed-models";
import { modelProfile, profile } from "./model-options";
import type { ModelCatalog, ModelSelection, Settings } from "./types";

function selectionLabel(catalog: ModelCatalog, selection: ModelSelection, recommended: boolean): string {
  const metadata = modelProfile(catalog, selection);
  if (metadata) {
    const variants = catalog.profiles?.some(profile => profile.selection.provider === selection.provider && profile.name === metadata.name && profile.selection.synthesis !== selection.synthesis);
    const precision = variants && catalog.models.find(model => model.file === metadata.files[0] && model.provider === selection.provider)?.precision;
    const name = metadata.name;
    if (precision) return `${name} · ${precision}`;
    return name;
  }
  if (recommended) return modelLabel(selection.synthesis, false);
  return `${modelLabel(selection.synthesis, true)} · ${modelLabel(selection.language, true)}`;
}

export const profileKey = (selection: ModelSelection): string =>
  JSON.stringify([selection.provider, selection.synthesis, selection.language]);

/** Resolve the saved profile while retaining the pre-catalog Standard/XL settings fallback. */
export function selectionFromSettings(settings: Settings): ModelSelection {
  return {
    provider: settings.model_provider || "ace-step",
    synthesis: settings.synthesis_model || (settings.dit === "xl" ? "acestep-v15-xl-sft-Q8_0.gguf" : "acestep-v15-sft-Q8_0.gguf"),
    language: settings.lm_model,
  };
}

/** Offer complete, verified profiles whose runtime and hardware can run them. */
export function creatorOptions(catalog: ModelCatalog, chosen: ModelSelection | undefined) {
  const recommended = new Set(catalog.recommended_profiles.map(profileKey));
  const options = new Map<string, { selection: ModelSelection; value: string; label: string }>();
  function add(selection: ModelSelection) {
    const value = profileKey(selection);
    if (options.has(value) || (selection.provider === "ace-step" && catalog.ace_step_available === false)) return;
    const candidate = profile(catalog, selection);
    if (!candidate.allowed || !candidate.compatible || !candidate.verified || candidate.models.some(model => !model.present)) return;
    options.set(value, { selection, value, label: selectionLabel(catalog, selection, recommended.has(value)) });
  }
  if (chosen && !recommended.has(profileKey(chosen))) add(chosen);
  catalog.recommended_profiles.forEach(add);
  catalog.profiles?.forEach(profile => add(profile.selection));
  if (catalog.expert_mode) {
    for (const model of catalog.models) {
      if (model.role !== "synthesis" || !model.verified || !model.present) continue;
      const selection = installedSelection(catalog, model.file, chosen ?? catalog.selection);
      if (selection) add(selection);
    }
  }
  return [...options.values()];
}
