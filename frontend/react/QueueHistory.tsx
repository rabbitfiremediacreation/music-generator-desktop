import { useInfiniteQuery } from "@tanstack/react-query";
import { backend } from "../backend";
import { useI18n } from "./i18n";

export function QueueHistory() {
  const { t, language } = useI18n();
  const history = useInfiniteQuery({
    queryKey: ["queue", "completed"],
    queryFn: ({ pageParam }) => backend.completedWork(pageParam),
    initialPageParam: 0,
    getNextPageParam: page => page.next_offset ?? undefined,
    staleTime: 0,
  });
  const date = new Intl.DateTimeFormat(language, { dateStyle: "short", timeStyle: "short" });
  const jobs = history.data?.pages.flatMap(page => page.jobs) ?? [];

  return <section className="queue-card" aria-labelledby="queue-completed">
    <h2 id="queue-completed">{t("queue_completed")}</h2>
    {history.isPending && <p className="small" role="status">{t("desktop_checking")}</p>}
    {history.error && <p className="setup-error" role="alert">{t(history.error.message)}</p>}
    {history.isSuccess && jobs.length === 0 && <p className="small">{t("queue_no_completed")}</p>}
    {jobs.length > 0 && <ul>{jobs.map(job => {
      const kind = t(`queue_${job.kind}`);
      const finished = new Date(job.finished_at);
      return <li key={`${job.kind}:${job.id}`} data-state="done">
        <div>
          <strong>{job.label || kind}</strong>
          <p className="small queue-item-status">{kind} · {t("queue_done")}</p>
        </div>
        {!Number.isNaN(finished.getTime()) &&
          <time className="small queue-completion-date" dateTime={job.finished_at}>{date.format(finished)}</time>}
      </li>;
    })}</ul>}
    {history.hasNextPage && <button type="button" className="sek mini" disabled={history.isFetching}
      onClick={() => void history.fetchNextPage()}>{t("queue_show_older")}</button>}
  </section>;
}
