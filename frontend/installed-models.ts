import { modelName, profile } from "./model-options";
import type { ModelCatalog, ModelSelection } from "./types";

export interface InstalledModel {
  file: string; role: "synthesis" | "language" | "dependency" | "title";
  precision: string; estimated_bytes: number; verified: boolean;
}

/** Include local files awaiting verification, but exclude incomplete downloads. */
export function installedModels(catalog: ModelCatalog): InstalledModel[] {
  const files: InstalledModel[] = catalog.models.filter(model => model.present || model.verified);
  if ((catalog.title_model.present || catalog.title_model.verified) && !files.some(model => model.file === catalog.title_model.file)) {
    files.push({ ...catalog.title_model, role: "title", precision: catalog.title_model.file.match(/-(BF16|Q\d_[\w]+)\.gguf$/)?.[1] ?? "—" });
  }
  const order = { synthesis: 0, language: 1, dependency: 2, title: 3 };
  return files.sort((a, b) => order[a.role] - order[b.role] || modelName(a.file).localeCompare(modelName(b.file)));
}

/** Installed-row activation must use an entirely verified, permitted local profile. */
export function installedSelection(catalog: ModelCatalog, file: string, current: ModelSelection): ModelSelection | undefined {
  const model = catalog.models.find(item => item.file === file && item.role === "synthesis");
  if (!model) return;
  const recommended = catalog.recommended_profiles.find(item => item.provider === model.provider && item.synthesis === file);
  const next = catalog.expert_mode ? { provider: model.provider, synthesis: file, language: current.language } : recommended;
  if (!next) return;
  const selected = profile(catalog, next);
  if (selected.valid && selected.allowed && selected.verified && selected.compatible) return next;
}
