import catalog from "../models/catalog.json";
import { bundledProfile, modelLabel } from "./expert-mode";
import { familyName } from "./model-browser";
import { songMachineGeneratedBy } from "./song-result";
import type { Song } from "./types";

const aceStep = catalog.providers.find(({ id }) => id === "ace-step")?.name ?? "ACE-Step";

function providerName(provider: string): string | undefined {
  if (provider === "ace-step" || provider === "acestep_cpp") return "ACE-Step";
  if (provider === "heartmula") return "HeartMuLa";
  return catalog.providers.find(({ id }) => id === provider)?.name;
}

/** Describe the saved selection, falling back to recorded provenance for older songs. */
export function songModel(song: Song) {
  const selection = song.params.model_selection;
  const saved = song.params.generation_profile;
  const revision = saved?.model_revision;
  const synthesis = selection?.synthesis?.trim();
  if (!selection || !synthesis) {
    const provider = selection?.provider || saved?.provider;
    const name = songMachineGeneratedBy(song) ?? (provider ? providerName(provider) ?? provider : providerName(song.engine ?? ""));
    return { name, revision, hasVariant: false };
  }

  const provider = selection.provider;
  if (provider === "ace-step") {
    const model = catalog.models.find(asset => asset.provider === provider && asset.file === synthesis && asset.role === "synthesis");
    const variant = model ? `${aceStep} ${familyName(model.family)} · ${model.precision}` : `ACE-Step · ${synthesis}`;
    const language = selection.language?.trim();
    const name = language ? `${variant} · ${modelLabel(language, true)}` : variant;
    return { name, revision, hasVariant: true };
  }

  const profile = bundledProfile(selection);
  if (profile) {
    const precisions = new Set(catalog.models.filter(asset => asset.provider === provider && profile.files.includes(asset.file) &&
      (asset.role === "synthesis" || asset.role === "weights")).map(asset => asset.precision).filter(Boolean));
    const variant = [...precisions].join(" / ") || synthesis;
    return { name: `${profile.name} · ${variant}`, revision, hasVariant: true };
  }

  return { name: `${providerName(provider) ?? provider} · ${synthesis}`, revision, hasVariant: true };
}
