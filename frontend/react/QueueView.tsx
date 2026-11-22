import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { backend } from "../backend";
import { stemApi } from "../stems";
import type { WorkJob, QueuedDownload } from "../types";
import { workQueueQuery } from "./data";
import { useI18n } from "./i18n";
import { QueueHistory } from "./QueueHistory";
import { usesDownloadSlot } from "./work-queue";

type Item = { download: QueuedDownload } | { job: WorkJob };
const canCancel = (download: QueuedDownload) => download.phase === "queued" || usesDownloadSlot(download);

export function QueueView({ onModels, onEngines }: { onModels: () => void; onEngines: () => void }) {
  const { t, language } = useI18n();
  const client = useQueryClient();
  const queue = useQuery(workQueueQuery());
  const cancel = useMutation({
    mutationFn: async (item: Item) => {
      if ("download" in item) await backend.cancelDownload(item.download.id);
      else if (item.job.kind === "song") await backend.cancel(item.job.id);
      else if (item.job.kind === "separation") await stemApi.cancel(item.job.id);
      else if (item.job.kind === "stem_generation") await stemApi.cancelTrackGeneration(item.job.id);
      else await stemApi.cancelExport(item.job.id);
    },
    onSettled: () => client.invalidateQueries({ queryKey: ["queue"] }),
  });
  const number = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
  const bytes = (value: number) => value >= 1024 ** 3
    ? `${number.format(value / 1024 ** 3)} GiB`
    : `${number.format(value / 1024 ** 2)} MiB`;
  const data = queue.data;
  const downloads = data ? [
    ...data.downloads.filter(usesDownloadSlot),
    ...data.downloads.filter(download => download.phase === "queued"),
    ...data.downloads.filter(download => !canCancel(download)).reverse(),
  ] : [];

  function cancelButton(item: Item, label: string) {
    return <button type="button" className="sek mini" aria-label={`${t("cancel")} · ${label}`}
      disabled={cancel.isPending} onClick={() => cancel.mutate(item)}>{t("cancel")}</button>;
  }

  return <main className="queue-view" aria-labelledby="queue-title">
    <header className="queue-heading">
      <h1 id="queue-title">{t("workspace_queue")}</h1>
      <div>
        <button type="button" className="sek" onClick={onModels}>{t("settings_page_models")}</button>
        <button type="button" className="sek" onClick={onEngines}>{t("settings_page_engines")}</button>
      </div>
    </header>
    {queue.isPending && <p role="status">{t("desktop_checking")}</p>}
    {(queue.error || cancel.error) && <p role="alert" className="setup-error">{t(queue.error?.message ?? cancel.error?.message ?? "")}</p>}
    <div className="queue-columns">
      <div className="queue-audio">
        {data && <section className="queue-card" aria-labelledby="queue-jobs">
          <h2 id="queue-jobs">{t("queue_jobs")}</h2>
          {data.jobs.length === 0 ? <p className="small">{t("queue_no_jobs")}</p> : <ul>
            {data.jobs.map(job => {
              const label = job.title || job.caption || t(`queue_${job.kind}`);
              const progress = data.progress?.job_id === job.id ? data.progress.overall_percent : undefined;
              return <li key={job.id} data-state={job.status}>
                <div><strong>{label}</strong>
                  <p className="small queue-item-status">{t(`queue_${job.kind}`)} · {t(`queue_${job.status}`)}</p>
                  {job.status === "running" && <progress max={100} value={progress} aria-label={label} />}
                </div>
                {cancelButton({ job }, label)}
              </li>;
            })}
          </ul>}
        </section>}
        <QueueHistory />
      </div>
      {data && <section className="queue-card" aria-labelledby="queue-downloads">
        <h2 id="queue-downloads">{t("queue_downloads")}</h2>
        <p className="small">{t("queue_slots", downloads.filter(usesDownloadSlot).length, data.download_limit)}</p>
        {downloads.length === 0 ? <p className="small">{t("queue_no_downloads")}</p> : <ul>
          {downloads.map(download => {
            const status = usesDownloadSlot(download) ? `desktop_${download.phase}` : `queue_${download.phase}`;
            return <li key={download.id} data-state={download.phase}>
              <div><strong>{download.file}</strong>
                <p className="small queue-item-status">{t(status)}{download.total > 0 && ` · ${bytes(download.downloaded)} / ${bytes(download.total)}`}</p>
                {usesDownloadSlot(download) && <progress max={download.total || 1} value={download.total ? download.downloaded : undefined} aria-label={download.file} />}
                {download.error && <p className="setup-error">{t(download.error)}</p>}
              </div>
              {canCancel(download) && cancelButton({ download }, download.file)}
            </li>;
          })}
        </ul>}
      </section>}
    </div>
  </main>;
}
