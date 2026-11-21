import { useIsMutating, useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { backend } from "../../backend";
import type { DownloadProgress } from "../../types";
import { useI18n } from "../i18n";
import { invalidateModels } from "../models/model-state";
import { EngineTable } from "./EngineTable";

type EngineAction = { id: string } | { title: string } | { remove: string };

export function EnginesSettings() {
  const { t } = useI18n(), client = useQueryClient();
  const packages = useQuery({ queryKey: ["engines"], queryFn: backend.enginePackages, networkMode: "always", retry: false });
  const progress = useQuery<DownloadProgress | null>({ queryKey: ["engines", "progress"], queryFn: async () => null, enabled: false }).data;
  const modelBusy = useIsMutating({ mutationKey: ["models"] }) > 0;
  const pending = useMutationState({
    filters: { mutationKey: ["models", "engines"], status: "pending" },
    select: mutation => mutation.state.variables as EngineAction | undefined,
  }).at(-1);
  const change = useMutation({
    mutationKey: ["models", "engines"], networkMode: "always",
    mutationFn: (action: EngineAction) => "remove" in action ? backend.removeEngine(action.remove) : backend.installEngine(action),
    onMutate: () => cancel.reset(),
    onSettled: async () => {
      await Promise.all([client.invalidateQueries({ queryKey: ["engines"] }), client.invalidateQueries({ queryKey: ["cuda"] }), invalidateModels(client)]);
    },
  });
  const cancel = useMutation({ mutationFn: backend.cancelModelDownload, networkMode: "always" });
  const cancelled = change.error?.message === "Operation cancelled";
  return <>
    <div className="engine-table-toolbar">
      <button type="button" className="sek" disabled={modelBusy || packages.isFetching} onClick={() => { void packages.refetch(); void invalidateModels(client); }}>{t("engine_refresh")}</button>
      {packages.data?.some(engine => engine.bytes > 0) && <button type="button" className="sek" disabled={modelBusy} onClick={() => change.mutate({ title: t("engine_import") })}>{t("engine_import")}</button>}
    </div>
    {packages.isPending && <p role="status">{t("desktop_checking")}</p>}
    {packages.error && <p role="alert" className="setup-error">{packages.error.message}</p>}
    {packages.data?.length === 0 && <p role="status">{t("engine_package_unavailable")}</p>}
    {!!packages.data?.length && <EngineTable packages={packages.data} busy={modelBusy}
      onInstall={id => change.mutate({ id })} onRemove={id => change.mutate({ remove: id })} />}
    {pending && ("remove" in pending ? <p className="small" role="status">{t("engine_removing")}</p> : <div>
        <progress max={progress?.total || 1} value={progress?.total ? progress.downloaded : undefined} aria-label={t("picker_download")} />
        <p className="small" role="status">{progress ? t(progress.phase === "installing" ? "engine_installing" : `desktop_${progress.phase}`) : t("desktop_checking")}</p>
        <button type="button" className="sek" disabled={cancel.isPending || progress?.phase === "installing"} onClick={() => cancel.mutate()}>{t("cancel")}</button>
    </div>)}
    {change.error && <p role={cancelled ? "status" : "alert"} className="setup-error">{t(cancelled ? "engine_cancelled" : change.error.message)}</p>}
    {cancel.error && <p role="alert" className="setup-error">{cancel.error.message}</p>}
  </>;
}
