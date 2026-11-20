import { modelName, profile } from "./model-options";
import type { CatalogModel, ModelCatalog, ModelSelection } from "./types";

export interface InstalledModel {
  file: string; role: CatalogModel["role"] | "title";
  precision: string; estimated_bytes: number; verified: boolean;
}

/** Include local files awaiting verification, but exclude incomplete downloads. */
export function installedModels(catalog: ModelCatalog): InstalledModel[] {
  const files: InstalledModel[] = catalog.models.filter(model => model.present || model.verified);
  if ((catalog.title_model.present || catalog.title_model.verified) && !files.some(model => model.file === catalog.title_model.file)) {
    files.push({ ...catalog.title_model, role: "title", precision: catalog.title_model.file.match(/-(BF16|Q\d_[\w]+)\.gguf$/)?.[1] ?? "—" });
  }
  const order = { synthesis: 0, weights: 0, language: 1, dependency: 2, codec: 2, tokenizer: 2, config: 2, license: 2, title: 3 };
  return files.sort((a, b) => order[a.role] - order[b.role] || modelName(a.file).localeCompare(modelName(b.file)));
}

/** Installed-row activation must use an entirely verified, permitted local profile. */
export function installedSelection(catalog: ModelCatalog, file: string, current: ModelSelection): ModelSelection | undefined {
  const model = catalog.models.find(item => item.file === file);
  if (!model) return;
  const fixed = catalog.profiles?.find(item => item.selection.provider === model.provider && item.files[0] === file);
  if (!fixed && model.role !== "synthesis") return;
  const recommended = catalog.recommended_profiles.find(item => item.provider === model.provider && item.synthesis === file);
  const language = current.provider === model.provider ? current.language : catalog.model_profiles?.[model.provider]?.language ?? catalog.recommended_profiles.find(item => item.provider === model.provider)?.language ?? "";
  const next = fixed?.selection ?? (catalog.expert_mode ? { provider: model.provider, synthesis: file, language } : recommended);
  if (!next) return;
  const selected = profile(catalog, next);
  if (selected.valid && selected.allowed && selected.verified && selected.compatible) return next;
}
