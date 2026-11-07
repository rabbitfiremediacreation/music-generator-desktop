import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { backend } from "../../backend";
import { installedModels, installedSelection } from "../../installed-models";
import { modelErrorText } from "../../expert-mode";
import { modelName } from "../../model-options";
import type { ModelSelection } from "../../types";
import { useI18n } from "../i18n";
import type { ModelManagerProps } from "./ModelManager";
import { ModelDownloadProgress } from "./ModelDownloadProgress";
import { invalidateModels } from "./model-state";

export function InstalledModels({ active, expertMode, manager, adding, onAdd }: {
  active: boolean; expertMode: boolean; manager: ModelManagerProps; adding: boolean; onAdd: () => void;
}) {
  const { t, language } = useI18n();
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["models", "catalog"], queryFn: backend.modelCatalog, enabled: active, networkMode: "always", retry: false, staleTime: 0 });
  const busy = useIsMutating({ mutationKey: ["models"] }) > 0;
  const activate = useMutation({
    mutationKey: ["models", "activate"], networkMode: "always", retry: false,
    mutationFn: ({ next }: { next: ModelSelection; before: number }) => backend.selectModels(next),
    onSuccess: async (selected, { before }) => { manager.onUse(selected, before); await invalidateModels(client); },
  });
  const cancel = useMutation({ mutationFn: backend.cancelModelDownload, networkMode: "always" });
  const catalog = query.data ? { ...query.data, expert_mode: expertMode } : undefined;
  const files = catalog ? installedModels(catalog) : [];
  const current = manager.currentSelection ?? catalog?.selection;
  const bytes = (value: number) => `${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value / 1024 ** 3)} GiB`;
  const failure = activate.error || cancel.error;
  return <section className="installed-models" aria-labelledby="installedModelsHeading">
    <div className="installed-models-heading"><div><h4 id="installedModelsHeading">{t("models_installed_title")} {catalog && <span>{files.length}</span>}</h4>
      {catalog && <p className="small">{t("models_total_size")}: {bytes(files.reduce((total, model) => total + model.estimated_bytes, 0))}</p>}
    </div><button type="button" className="aktion" disabled={manager.disabled} onClick={onAdd}><span aria-hidden="true">＋ </span>{t("models_add")}</button></div>
    {query.isPending && <p role="status" className="small">{t("desktop_checking")}</p>}
    {query.error && <div><p role="alert" className="setup-error">{modelErrorText(query.error, t)}</p><button type="button" className="sek" onClick={() => void query.refetch()}>{t("settings_retry")}</button></div>}
    {catalog && (files.length ? <div className="installed-models-table"><table>
      <thead><tr><th>{t("picker_title")}</th><th>{t("browser_precision")}</th><th>{t("browser_size")}</th><th><span className="sr-only">{t("picker_use")}</span></th></tr></thead>
      <tbody>{files.map(model => {
        const selected = !!current && (model.file === current.synthesis || model.file === current.language);
        const next = current && installedSelection(catalog, model.file, current);
        return <tr key={model.file}><td><span className="installed-model-name" title={model.file}>{modelName(model.file)} {selected && <span className="installed-active">{t("browser_active")}</span>}</span>
          <span className="small">{t(model.role === "synthesis" ? "dit" : model.role === "language" ? "desktop_language_model" : model.role === "title" ? "title_model" : "picker_dependencies")} · {t(model.verified ? "picker_installed" : "picker_verify")}</span></td>
          <td><code>{model.precision}</code></td><td>{bytes(model.estimated_bytes)}</td>
          <td>{next && !selected && <button type="button" className="sek" disabled={busy || manager.disabled} onClick={() => activate.mutate({ next, before: manager.selectionRevision })}>{t("picker_use")}</button>}</td>
        </tr>;
      })}</tbody>
    </table></div> : <p className="installed-models-empty">{t("models_installed_empty")}</p>)}
    {catalog && <p className="small installed-models-path">{catalog.models_dir}</p>}
    {!adding && busy && <div className="installed-models-progress"><ModelDownloadProgress busy /><button type="button" className="sek" disabled={cancel.isPending} onClick={() => cancel.mutate()}>{t("picker_cancel_download")}</button></div>}
    {failure && <p role="alert" className="setup-error">{modelErrorText(failure, t)}</p>}
  </section>;
}
