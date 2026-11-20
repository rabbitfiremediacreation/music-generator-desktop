import { modelAllowed, modelLabel } from "./expert-mode";
import type { CatalogModel, CatalogProfile, ModelCatalog, ModelSelection } from "./types";

export function modelProfile(catalog: ModelCatalog, selection: ModelSelection): CatalogProfile | undefined {
  return catalog.profiles?.find(({ selection: profile }) => profile.provider === selection.provider &&
    profile.synthesis === selection.synthesis && profile.language === selection.language);
}

export function profileModels(catalog: ModelCatalog, selection: ModelSelection): CatalogModel[] {
  const metadata = modelProfile(catalog, selection);
  if (metadata) return metadata.files.flatMap(file => catalog.models.filter(m => m.provider === selection.provider && m.file === file));
  return catalog.models.filter(m => m.provider === selection.provider &&
    (m.role === "dependency" || m.file === selection.synthesis || m.file === selection.language));
}

export function aceStepMemory(models: CatalogModel[], replacement?: Pick<CatalogModel, "role" | "estimated_bytes">) {
  const weights = models.reduce((total, model) => total + (model.role === replacement?.role ? replacement.estimated_bytes : model.estimated_bytes), 0);
  const xl = models.some(model => model.role === "synthesis" && model.file.includes("-xl-"));
  return weights + (xl ? 4 : 3) * 1024 ** 3;
}

export function profile(catalog: ModelCatalog, selection: ModelSelection) {
  const models = profileModels(catalog, selection);
  const metadata = modelProfile(catalog, selection);
  const complete = metadata ? metadata.files.length > 0 && models.length === metadata.files.length :
    catalog.providers.some(p => p.id === selection.provider && p.status === "available") &&
    models.some(m => m.role === "synthesis" && m.file === selection.synthesis) &&
    models.some(m => m.role === "language" && m.file === selection.language);
  const valid = complete && (metadata?.available ?? true);
  const filesVerified = complete && models.every(m => m.verified);
  const platforms = [...(metadata?.platforms ?? []), ...(metadata?.evaluation_platforms ?? [])]
    .filter(platform => platform.os === catalog.hardware.platform);
  const memory = metadata?.estimated_ram_bytes ?? aceStepMemory(models);
  const minimumRam = metadata ? (platforms.length ? Math.min(...platforms.map(platform => platform.minimum_ram_bytes)) : 0) : memory;
  const synthesis = models.find(m => m.role === "synthesis");
  return {
    models, metadata, complete, valid, filesVerified, allowed: modelAllowed(selection, catalog.expert_mode, catalog.recommended_profiles), memory, compatible: valid && minimumRam <= catalog.hardware.ram_bytes,
    verified: valid && filesVerified,
    download: models.filter(m => !m.present).reduce((n, m) => n + Math.max(0, m.estimated_bytes - m.partial_bytes), 0),
    steps: synthesis?.suggested_steps ?? synthesis?.recommended_steps,
  };
}

export function modelName(file: string): string {
  return modelLabel(file, true);
}

export function modelRoleLabel(role: CatalogModel["role"] | "title"): string {
  return {
    synthesis: "dit", language: "desktop_language_model", dependency: "picker_dependencies", title: "title_model",
    weights: "provider_weights", codec: "provider_codec", tokenizer: "provider_tokenizer",
    config: "provider_config", license: "provider_license_file",
  }[role];
}

export function modelOptions(catalog: ModelCatalog, selection: ModelSelection, role: "synthesis" | "language", compatibleOnly: boolean): CatalogModel[] {
  const field = role === "synthesis" ? "synthesis" : "language";
  return catalog.models.filter(m => {
    if (m.provider !== selection.provider || m.role !== role) return false;
    if (!catalog.expert_mode) {
      return catalog.recommended_profiles.some(p => p.provider === selection.provider &&
        (role === "synthesis" ? p.synthesis === m.file : p.synthesis === selection.synthesis && p.language === m.file));
    }
    return !compatibleOnly || m.file === selection[field] || profile(catalog, { ...selection, [field]: m.file }).compatible;
  });
}
