import { profileKey } from "../../creator-models";
import { profile } from "../../model-options";
import type { ModelCatalog, ModelSelection } from "../../types";

const baseFamilies = ["acestep-v15-base", "acestep-v15-xl-base"];

function languageOrder(catalog: ModelCatalog) {
  const bySize = catalog.models.filter(model => model.provider === "ace-step" && model.role === "language")
    .sort((a, b) => a.estimated_bytes - b.estimated_bytes);
  const preferred = [
    catalog.selection, catalog.model_profiles?.["ace-step"], ...catalog.recommended_profiles,
  ].flatMap(selection => selection?.provider === "ace-step" ? [selection.language] : []);
  return [...new Set([...preferred, ...bySize.map(model => model.file)])];
}

interface LayerOption {
  selection: ModelSelection;
  value: string;
  label: string;
  download: number;
  verified: boolean;
}

export function layerModels(catalog: ModelCatalog): {
  options: LayerOption[];
  prepare?: LayerOption;
  hint?: "engine_install_required" | "stem_layer_model_expert" | "stem_layer_model_ram" | "stem_layer_generated_model";
} {
  const options: LayerOption[] = [];
  if (catalog.ace_step_available === false) return { options, hint: "engine_install_required" };
  if (!catalog.expert_mode) return { options, hint: "stem_layer_model_expert" };

  const synthesis = catalog.models.filter(model => model.provider === "ace-step" && model.role === "synthesis" && baseFamilies.includes(model.family));
  const languages = languageOrder(catalog);
  let prepare: LayerOption | undefined;
  for (const model of synthesis) {
    const label = `ACE-Step 1.5 ${model.family === "acestep-v15-xl-base" ? "XL Base" : "Base"} · ${model.precision}`;
    let local: LayerOption | undefined;
    for (const language of languages) {
      const selection = { provider: "ace-step", synthesis: model.file, language };
      const candidate = profile(catalog, selection);
      if (!candidate.allowed || !candidate.compatible) continue;
      const option = {
        selection, value: profileKey(selection), label,
        download: candidate.download, verified: candidate.verified,
      };
      if (candidate.models.every(file => file.present)) {
        if (candidate.verified) { local = option; break; }
        local ??= option;
      } else if (!prepare || option.download < prepare.download) {
        prepare = option;
      }
    }
    if (local) options.push(local);
  }
  if (options.length) {
    options.sort((a, b) => Number(b.verified) - Number(a.verified));
    return { options };
  }
  return { options, prepare, hint: prepare || !synthesis.length ? "stem_layer_generated_model" : "stem_layer_model_ram" };
}
