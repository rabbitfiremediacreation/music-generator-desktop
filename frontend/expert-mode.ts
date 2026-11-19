import source from "../models/catalog.json";
import type { ModelSelection, Settings, SettingsPatch } from "./types";

// Both views use the backend's complete hardware-aware recommendations.
export function modelAllowed(selection: ModelSelection | undefined, expertMode: boolean, recommendations: readonly ModelSelection[]): boolean {
  if (!selection || expertMode) return true;
  const matches = (profile: ModelSelection) => profile.provider === selection.provider &&
    profile.synthesis === selection.synthesis && profile.language === selection.language;
  const profiles = (source as { profiles?: { selection: ModelSelection }[] }).profiles;
  return recommendations.some(matches) || profiles?.some(profile => matches(profile.selection)) === true;
}

export function modelLabel(file: string, expertMode: boolean): string {
  if (!expertMode && source.basic_models.synthesis.includes(file)) return file.includes("-xl-") ? "XL" : "Standard";
  if (!expertMode) return file.match(/-(0\.6B|1\.7B|4B)-/)?.[1] || file;
  return file.replace(/\.gguf$/, "").replace(/^acestep-v15-/, "").replace(/^acestep-5Hz-lm-/, "LM ");
}

export function modelErrorText(error: unknown, translate: (key: string) => string): string {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw === "Open the ModelPicker and download or verify the selected models first" ? "model_setup_required" : raw;
  return ["expert_mode_required", "model_setup_required"].includes(message) ? translate(message) : message;
}

// Send only edits so an Expert Mode toggle can be saved during an active generation.
export function settingsChanges(before: Settings, values: SettingsPatch): SettingsPatch {
  return Object.fromEntries(Object.entries(values).filter(([key, value]) =>
    before[key as keyof Settings] !== value));
}
