import { modelAllowed, modelLabel } from "./expert-mode";
import type { ModelSelection, Settings } from "./types";
import catalog from "../models/catalog.json";

export function selectionLabel(selection: ModelSelection): string {
  const profiles = (catalog as { profiles?: { selection: ModelSelection; name: string }[] }).profiles;
  const name = profiles?.find(profile => profile.selection.provider === selection.provider && profile.selection.synthesis === selection.synthesis)?.name;
  return name ?? (selection.language ? modelLabel(selection.synthesis, false) : selection.synthesis);
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

// Recommendations stay simple even in Expert Mode. Advanced profiles are chosen in Settings.
export function creatorOptions(recommendations: readonly ModelSelection[], chosen: ModelSelection | undefined, expertMode: boolean) {
  const options = recommendations.map(selection => ({ selection, value: profileKey(selection), label: selectionLabel(selection), disabled: false }));
  if (chosen && !options.some(option => option.value === profileKey(chosen))) {
    const label = chosen.language ? `${modelLabel(chosen.synthesis, true)} · ${modelLabel(chosen.language, true)}` : selectionLabel(chosen);
    options.unshift({ selection: chosen, value: profileKey(chosen), label, disabled: !modelAllowed(chosen, expertMode, recommendations) });
  }
  return options;
}
