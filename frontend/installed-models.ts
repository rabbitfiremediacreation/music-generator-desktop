import { modelName, profile, profileModels } from "./model-options";
import type { CatalogModel, CatalogProfile, ModelCatalog, ModelSelection } from "./types";

export interface InstalledModel {
  file: string; role: CatalogModel["role"] | "title";
  category?: CatalogModel["category"];
  precision: string; estimated_bytes: number; verified: boolean;
  profile?: CatalogProfile; complete?: boolean;
}

/** Include local files awaiting verification, but exclude incomplete downloads. */
export function installedModels(catalog: ModelCatalog) {
  const local = catalog.models.filter(model => model.present || model.verified);
  const grouped = new Set<CatalogModel>();
  const groups: InstalledModel[] = [];
  const ownership = new Map<string, number>();
  for (const metadata of catalog.profiles ?? []) {
    for (const file of metadata.files) ownership.set(file, (ownership.get(file) ?? 0) + 1);
  }
  for (const metadata of catalog.profiles ?? []) {
    if (!metadata.files.length) continue;
    const members = profileModels(catalog, metadata.selection);
    const present = members.filter(model => model.present || model.verified);
    if (!present.some(model => ownership.get(model.file) === 1)) continue;
    present.forEach(model => grouped.add(model));
    const primary = members[0];
    const complete = present.length === metadata.files.length;
    groups.push({
      file: primary.file, role: primary.role, category: primary.category, profile: metadata, complete,
      precision: [...new Set(members.filter(model => model.role === primary.role).map(model => model.precision).filter(Boolean))].join(", "),
      estimated_bytes: present.reduce((total, model) => total + model.estimated_bytes, 0),
      verified: complete && present.every(model => model.verified),
    });
  }
  const rows: InstalledModel[] = [...local.filter(model => !grouped.has(model)), ...groups];
  let totalBytes = local.reduce((total, model) => total + model.estimated_bytes, 0);
  if ((catalog.title_model.present || catalog.title_model.verified) && !local.some(model => model.file === catalog.title_model.file)) {
    rows.push({ ...catalog.title_model, role: "title", category: "llm", precision: catalog.title_model.file.match(/-(BF16|Q\d_[\w]+)\.gguf$/)?.[1] ?? "—" });
    totalBytes += catalog.title_model.estimated_bytes;
  }
  const order = { synthesis: 0, weights: 0, language: 1, dependency: 2, codec: 2, tokenizer: 2, config: 2, license: 2, title: 3 };
  rows.sort((a, b) => order[a.role] - order[b.role] || (a.profile?.name ?? modelName(a.file)).localeCompare(b.profile?.name ?? modelName(b.file)));
  return { rows, totalBytes };
}

/** Installed-row activation must use an entirely verified, permitted local profile. */
export function installedSelection(catalog: ModelCatalog, file: string, current: ModelSelection, bundle?: CatalogProfile): ModelSelection | undefined {
  const model = catalog.models.find(item => item.file === file);
  if (!model) return;
  const fixed = bundle ?? catalog.profiles?.find(item => item.selection.provider === model.provider && item.files[0] === file);
  if (!fixed && model.role !== "synthesis") return;
  const recommended = catalog.recommended_profiles.find(item => item.provider === model.provider && item.synthesis === file);
  const language = current.provider === model.provider ? current.language : catalog.model_profiles?.[model.provider]?.language ?? catalog.recommended_profiles.find(item => item.provider === model.provider)?.language ?? "";
  const next = fixed?.selection ?? (catalog.expert_mode ? { provider: model.provider, synthesis: file, language } : recommended);
  if (!next) return;
  const selected = profile(catalog, next);
  if (selected.valid && selected.allowed && selected.verified && selected.compatible) return next;
}
