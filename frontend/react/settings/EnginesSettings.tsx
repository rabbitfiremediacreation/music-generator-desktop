import { useIsMutating, useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { backend } from "../../backend";
import { stemApi, stemError } from "../../stems";
import type { DownloadProgress } from "../../types";
import { useI18n } from "../i18n";
import { invalidateModels } from "../models/model-state";
import { useStemCatalog } from "../stems/data";
import { DemucsEngineRow } from "./DemucsEngineRow";
import { EngineTable } from "./EngineTable";

type EngineAction = { id: string } | { title: string } | { remove: string } | { demucs: true };

export function EnginesSettings() {
  const { t } = useI18n(), client = useQueryClient();
  const packages = useQuery({ queryKey: ["engines"], queryFn: backend.enginePackages, networkMode: "always", retry: false });
  const stems = useStemCatalog();
  const progress = useQuery<DownloadProgress | null>({ queryKey: ["engines", "progress"], queryFn: async () => null, enabled: false }).data;
  const modelBusy = useIsMutating({ mutationKey: ["models"] }) > 0;
  const pending = useMutationState({
    filters: { mutationKey: ["models", "engines"], status: "pending" },
    select: mutation => mutation.state.variables as EngineAction | undefined,
  }).at(-1);
  const installingDemucs = !!pending && "demucs" in pending;
  const phase = progress?.phase ?? (installingDemucs ? "installing" : null);
  const change = useMutation({
    mutationKey: ["models", "engines"], networkMode: "always",
    async mutationFn(action: EngineAction) {
      if ("demucs" in action) await stemApi.installEngine();
      else if ("remove" in action) await backend.removeEngine(action.remove);
      else await backend.installEngine(action);
    },
    onMutate: () => {
      cancel.reset();
      client.setQueryData(["engines", "progress"], null);
    },
    onSettled: async () => {
      await Promise.all([client.invalidateQueries({ queryKey: ["engines"] }), client.invalidateQueries({ queryKey: ["cuda"] }),
        client.invalidateQueries({ queryKey: ["stem-models"] }), invalidateModels(client)]);
    },
  });
  const cancel = useMutation({
    mutationFn: (action: EngineAction) => "demucs" in action ? stemApi.pause("engine") : backend.cancelModelDownload(),
    networkMode: "always",
  });
  const failure = change.error && stemError(change.error, t);
  const cancelled = failure === "Operation cancelled";
  return <>
    <div className="engine-table-toolbar">
      <button type="button" className="sek" disabled={modelBusy || packages.isFetching || stems.isFetching}
        onClick={() => { void packages.refetch(); void stems.refetch(); void invalidateModels(client); }}>{t("engine_refresh")}</button>
      {packages.data?.some(engine => engine.bytes > 0) && <button type="button" className="sek" disabled={modelBusy} onClick={() => change.mutate({ title: t("engine_import") })}>{t("engine_import")}</button>}
    </div>
    {(packages.isPending || stems.isPending) && <p role="status">{t("desktop_checking")}</p>}
    {packages.error && <p role="alert" className="setup-error">{packages.error.message}</p>}
    {stems.error && <p role="alert" className="setup-error">{t("stem_engine")} · {stemError(stems.error, t)}</p>}
    {packages.data?.length === 0 && !stems.isPending && !stems.data?.platform_supported && <p role="status">{t("engine_package_unavailable")}</p>}
    {(!!packages.data?.length || stems.data) && <EngineTable packages={packages.data ?? []} busy={modelBusy}
      onInstall={id => change.mutate({ id })} onRemove={id => change.mutate({ remove: id })}>
      {stems.data && <DemucsEngineRow catalog={stems.data} busy={modelBusy} installing={installingDemucs}
        onInstall={() => change.mutate({ demucs: true })} />}
    </EngineTable>}
    {pending && ("remove" in pending ? <p className="small" role="status">{t("engine_removing")}</p> : <div>
        <progress max={progress?.total || 1} value={progress?.total ? progress.downloaded : undefined} aria-label={t("picker_download")} />
        <p className="small" role="status">{t(phase === "installing" ? "engine_installing" : phase ? `desktop_${phase}` : "desktop_checking")}</p>
        <button type="button" className="sek" disabled={cancel.isPending || progress?.phase === "installing"} onClick={() => cancel.mutate(pending)}>{t("cancel")}</button>
    </div>)}
    {failure && <p role={cancelled ? "status" : "alert"} className="setup-error">{cancelled ? t("engine_cancelled") : failure}</p>}
    {cancel.error && <p role="alert" className="setup-error">{stemError(cancel.error, t)}</p>}
  </>;
}
