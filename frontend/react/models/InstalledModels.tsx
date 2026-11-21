import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { confirm } from "@tauri-apps/plugin-dialog";
import { backend } from "../../backend";
import { nativeProfileFamily } from "../../model-browser";
import { installedModels, installedSelection, type ModelInventorySection } from "../../installed-models";
import { modelErrorText } from "../../expert-mode";
import { modelName, modelProfile, modelRoleLabel, profileModels } from "../../model-options";
import type { ModelRemoval, ModelSelection } from "../../types";
import { useI18n } from "../i18n";
import type { ModelManagerProps } from "./ModelManager";
import { ModelDownloadProgress } from "./ModelDownloadProgress";
import { invalidateModels, useTitleModelDownload } from "./model-state";
import { TitleModelCard } from "./TitleModelCard";

export function InstalledModels({ section, active, expertMode, manager, adding = false, onAdd }: {
  section: ModelInventorySection; active: boolean; expertMode: boolean;
  manager: ModelManagerProps; adding?: boolean; onAdd?: () => void;
}) {
  const { t, language } = useI18n();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["models", "catalog"], queryFn: backend.modelCatalog, enabled: active, networkMode: "always", retry: false, staleTime: 0 });
  const busy = useIsMutating({ mutationKey: ["models"] }) > 0;
  const downloading = useIsMutating({
    predicate: ({ options }) => options.mutationKey?.[0] === "models" &&
      ["install", "title-download"].includes(String(options.mutationKey[1])),
  }) > 0;
  const activate = useMutation({
    mutationKey: ["models", "activate"], networkMode: "always", retry: false,
    mutationFn: ({ next }: { next: ModelSelection; before: number }) => backend.selectModels(next),
    onSuccess: async (selected, { before }) => { manager.onUse(selected, before); await invalidateModels(client); },
  });
  const cancel = useMutation({ mutationFn: backend.cancelModelDownload, networkMode: "always" });
  const remove = useMutation({
    mutationKey: ["models", "remove"], networkMode: "always", retry: false,
    mutationFn: async ({ target, name }: { target: ModelRemoval; name: string }) => {
      if (!await confirm(`${t("model_remove_confirm")}\n\n${name}`, {
        kind: "warning", title: t("model_remove"), okLabel: t("model_remove"), cancelLabel: t("cancel"),
      })) return;
      try { await backend.removeModel(target); }
      finally { await invalidateModels(client); }
    },
  });
  const catalog = query.data ? { ...query.data, expert_mode: expertMode } : undefined;
  const inventory = catalog ? installedModels(catalog, section) : undefined;
  const label = section === "music" ? "models_music" : "models_llm_embeddings";
  const heading = `installedModelsHeading-${section}`;
  const current = manager.currentSelection ?? catalog?.selection;
  const activeFixed = current && catalog && modelProfile(catalog, current);
  const activeFiles = catalog ? new Set(profileModels(catalog, catalog.selection).map(model => model.file)) : undefined;
  const bytes = (value: number) => `${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value / 1024 ** 3)} GiB`;
  const title = useTitleModelDownload();
  const failure = remove.error || activate.error || cancel.error || title.error;
  return <section className="installed-models" aria-labelledby={heading}>
    <div className="installed-models-heading"><div><h4 id={heading}>{t("models_installed_title")} {inventory && <span>{inventory.rows.length}</span>}</h4>
      {inventory && <p className="small">{t("models_total_size")}: {bytes(inventory.totalBytes)}</p>}
    </div>{onAdd && <button type="button" className="aktion" disabled={manager.disabled || remove.isPending} onClick={onAdd}><span aria-hidden="true">＋ </span>{t("models_add")}</button>}</div>
    {query.isPending && <p role="status" className="small">{t("desktop_checking")}</p>}
    {query.error && <div><p role="alert" className="setup-error">{modelErrorText(query.error, t)}</p><button type="button" className="sek" onClick={() => void query.refetch()}>{t("settings_retry")}</button></div>}
    {catalog && inventory && (inventory.rows.length ? <div className="installed-models-category">
      <h5 id={label}>{t(label)}</h5>
      <div className="settings-inventory-table installed-models-table"><table aria-labelledby={label}>
        <thead><tr><th>{t("picker_title")}</th><th>{t("browser_precision")}</th><th>{t("browser_size")}</th><th><span className="sr-only">{t("model_actions")}</span></th></tr></thead>
        <tbody>{inventory.rows.map(model => {
          const selected = model.profile ? model.profile === activeFixed : !!current && (model.file === current.synthesis || model.file === current.language || model.file === (activeFixed && activeFixed.files[0]));
          const next = current && installedSelection(catalog, model.file, current, model.profile);
          const name = model.profile?.name ?? modelName(model.file);
          const family = model.profile && nativeProfileFamily(model.profile);
          const hasVariants = family && (catalog.profiles ?? []).filter(item => nativeProfileFamily(item) === family).length > 1;
          const removeName = hasVariants ? `${name} · ${model.precision}` : name;
          const protectedModel = selected || activeFiles?.has(model.file);
          const target: ModelRemoval = model.profile ? { kind: "profile", selection: model.profile.selection } : { kind: "file", file: model.file };
          const status = model.complete === false ? "picker_missing" : model.verified ? "picker_installed" : "picker_verify";
          return <tr key={model.profile ? JSON.stringify(model.profile.selection) : model.file}><td><span className="settings-inventory-name" title={model.profile?.files.join("\n") ?? model.file}>{name} {selected && <span className="installed-active">{t("browser_active")}</span>}</span>
            <span className="small">{t(modelRoleLabel(model.role))} · {t(status)}</span></td>
            <td><code>{model.precision}</code></td><td>{bytes(model.estimated_bytes)}</td>
            <td><div className="settings-inventory-actions">
              {next && !selected && <button type="button" className="sek" disabled={busy || manager.disabled} onClick={() => activate.mutate({ next, before: manager.selectionRevision })}>{t("picker_use")}</button>}
              <span title={protectedModel ? t("model_remove_active") : undefined}>
                <button type="button" className="sek danger" aria-label={`${t("model_remove")} · ${removeName}`} disabled={protectedModel || busy || manager.disabled} onClick={() => remove.mutate({ target, name: removeName })}>{t("model_remove")}</button>
              </span>
            </div></td>
          </tr>;
        })}</tbody>
      </table></div>
    </div> : <p className="installed-models-empty">{t(onAdd ? "models_installed_empty" : "models_category_empty")}</p>)}
    {catalog && <p className="small installed-models-path">{catalog.models_dir}</p>}
    {section === "text" && catalog && !catalog.title_model.verified && <TitleModelCard catalog={catalog} disabled={busy || !!manager.disabled} onDownload={() => title.mutate()} />}
    {!adding && downloading && <div className="installed-models-progress"><ModelDownloadProgress busy /><button type="button" className="sek" disabled={cancel.isPending} onClick={() => cancel.mutate()}>{t("picker_cancel_download")}</button></div>}
    {failure && <p role="alert" className="setup-error">{modelErrorText(failure, t)}</p>}
  </section>;
}
