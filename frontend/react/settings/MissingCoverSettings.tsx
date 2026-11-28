import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { backend } from "../../backend";
import type { CoverBatchProgress } from "../../types";
import { invalidateLibrary, queueQuery } from "../data";
import { useI18n } from "../i18n";

const batchKey = ["cover-art-batch"] as const;
const progressKey = ["cover-art-batch", "progress"] as const;

export function MissingCoverSettings({ installed }: { installed: boolean }) {
  const { t, language } = useI18n(), client = useQueryClient();
  const lastRun = useMutationState({ filters: { mutationKey: batchKey, exact: true },
    select: mutation => ({ status: mutation.state.status, error: mutation.state.error }) }).at(-1);
  const pending = lastRun?.status === "pending";
  const missing = useQuery({
    queryKey: ["songs", "missing-cover-count"], queryFn: backend.missingCoverCount, enabled: !pending, staleTime: 0,
  });
  const queue = useQuery(queueQuery());
  const progress = useQuery<CoverBatchProgress | null>({ queryKey: progressKey, queryFn: () => null, enabled: false }).data;
  const cancel = useMutation({ mutationFn: backend.cancelMissingCovers });
  const batch = useMutation({
    mutationKey: batchKey,
    mutationFn: () => backend.generateMissingCovers(update => client.setQueryData(progressKey, update)),
    onMutate: () => { cancel.reset(); client.setQueryData(progressKey, null); },
    onSuccess: result => { client.setQueryData(progressKey, result); },
    onSettled: () => invalidateLibrary(client),
  });
  const fmt = (n: number) => n.toLocaleString(language);
  const error = cancel.error ?? lastRun?.error ?? missing.error;
  return <section className="field cover-batch">
    <h4>{t("library")}</h4>
    {pending ? <>
      <span role="status">{progress ? t("cover_art_batch_progress", fmt(progress.processed), fmt(progress.total)) : t("desktop_progress_cover_art")}</span>
      {progress && <progress max={progress.total || 1} value={progress.processed} aria-label={t("desktop_progress_cover_art")} />}
      <div><button type="button" className="sek" disabled={!progress || cancel.isPending || cancel.isSuccess} onClick={() => cancel.mutate()}>{t("cover_art_cancel")}</button></div>
    </> : missing.data === 0 ? <span className="small" role="status">{t("cover_art_complete")}</span> :
      missing.data !== undefined && <div><button type="button" className="sek" disabled={!installed || queue.data?.active || missing.isFetching}
        onClick={() => batch.mutate()}>{t("cover_art_fill", fmt(missing.data))}</button></div>}
    {!pending && lastRun?.status === "success" && progress && progress.processed < progress.total && !!missing.data &&
      <span className="small" role="status">{t("cancelled")} · {t("cover_art_batch_progress", fmt(progress.processed), fmt(progress.total))}</span>}
    {(pending || !!missing.data) && progress?.last_failure && <p className="small err" role="status">
      {t("cover_art_batch_failed", fmt(progress.failed))} · {progress.last_failure[0]} · {t(progress.last_failure[1])}
    </p>}
    {error && <p className="small err" role="alert">{t(error.message)}</p>}
  </section>;
}
