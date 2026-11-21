import source from "../models/catalog.json";
import type { CatalogProfile, ModelSelection, Settings, SettingsPatch } from "./types";

export function bundledProfile(selection: ModelSelection | null | undefined) {
  if (!selection) return undefined;
  const profiles = (source as { profiles?: Omit<CatalogProfile, "available">[] }).profiles;
  return profiles?.find(profile => profile.selection.provider === selection.provider &&
    profile.selection.synthesis === selection.synthesis && profile.selection.language === selection.language);
}

// Studio runtime availability is checked separately by the generation policy.
export function modelAllowed(selection: ModelSelection | undefined, expertMode: boolean, recommendations: readonly ModelSelection[]): boolean {
  if (!selection || expertMode) return true;
  const profile = bundledProfile(selection);
  if (profile) return !profile.expert_only;
  return recommendations.some(profile =>
    profile.provider === selection.provider && profile.synthesis === selection.synthesis && profile.language === selection.language);
}

export function modelLabel(file: string, expertMode: boolean): string {
  if (!expertMode && source.basic_models.synthesis.includes(file)) return file.includes("-xl-") ? "XL" : "Standard";
  if (!expertMode) return file.match(/-(0\.6B|1\.7B|4B)-/)?.[1] || file;
  return file.replace(/\.gguf$/, "").replace(/^acestep-v15-/, "").replace(/^acestep-5Hz-lm-/, "LM ");
}

export function modelErrorText(error: unknown, translate: (key: string) => string): string {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw === "Open the ModelPicker and download or verify the selected models first" ? "model_setup_required" : raw;
  return [
    "expert_mode_required", "model_setup_required", "text2midi_runtime_required", "model_remove_active", "model_remove_queued",
    "model_remove_unsafe", "model_remove_use_profile", "hf_download_auth", "hf_token_read_failed", "engine_install_required",
  ].includes(message) ? translate(message) : message;
}

// Send only edits so an Expert Mode toggle can be saved during an active generation.
export function settingsChanges(before: Settings, values: SettingsPatch): SettingsPatch {
  return Object.fromEntries(Object.entries(values).filter(([key, value]) =>
    before[key as keyof Settings] !== value));
}
