import { modelName, modelOptions } from "./model-options";
import type { CatalogModel, ModelCatalog, ModelSelection } from "./types";

export type ModelFilter = "all" | "installed" | "recommended";
export interface ModelFamily { id: string; name: string; variants: CatalogModel[]; recommended: boolean }

export function familyName(family: string): string {
  return modelName(family).replace(/sftturbo50/g, "SFT Turbo 50").split("-").map(part =>
    ["sft", "xl"].includes(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

/** Search only models visible under the current Expert Mode and RAM policy. */
export function modelFamilies(catalog: ModelCatalog, draft: ModelSelection, compatible: boolean, query: string, filter: ModelFilter): ModelFamily[] {
  const options = modelOptions(catalog, draft, "synthesis", compatible);
  const current = catalog.models.find(model => model.file === draft.synthesis && model.provider === draft.provider);
  if (current && !options.some(model => model.file === current.file)) options.push(current);
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const provider = catalog.providers.find(item => item.id === draft.provider)?.name ?? draft.provider;
  const groups = new Map<string, ModelFamily>();
  for (const model of options) {
    const recommended = catalog.recommended_profiles.some(item => item.provider === model.provider && item.synthesis === model.file);
    const searchable = `${provider} ${model.family} ${familyName(model.family)} ${model.file} ${model.precision}`.toLocaleLowerCase();
    if (filter === "installed" && !model.verified || filter === "recommended" && !recommended || !terms.every(term => searchable.includes(term))) continue;
    const group = groups.get(model.family) ?? { id: model.family, name: familyName(model.family), variants: [], recommended: false };
    group.variants.push(model); group.recommended ||= recommended; groups.set(model.family, group);
  }
  return [...groups.values()].sort((a, b) => Number(b.recommended) - Number(a.recommended) || a.name.localeCompare(b.name));
}

/** Retain the chosen precision where possible and keep basic profiles hardware-recommended. */
export function familySelection(catalog: ModelCatalog, draft: ModelSelection, family: ModelFamily): ModelSelection {
  const current = catalog.models.find(model => model.file === draft.synthesis);
  const model = family.variants.find(item => item.file === draft.synthesis)
    ?? (catalog.expert_mode ? family.variants.find(item => item.precision === current?.precision) : undefined)
    ?? family.variants.find(item => catalog.recommended_profiles.some(profile => profile.provider === item.provider && profile.synthesis === item.file))
    ?? family.variants.find(item => item.precision === "Q8_0") ?? family.variants[0];
  const recommended = catalog.recommended_profiles.find(item => item.provider === model.provider && item.synthesis === model.file);
  return { ...draft, synthesis: model.file, language: !catalog.expert_mode && recommended ? recommended.language : draft.language };
}
