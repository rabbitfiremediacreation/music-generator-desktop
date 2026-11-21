import { useQuery } from "@tanstack/react-query";
import { GenerationProgress } from "../../GenerationActivity";
import { progressText } from "../../progress";
import type { JobProgress } from "../../types";
import { queryKeys, queueQuery } from "../data";
import { useI18n } from "../i18n";

export function useGenerationStatus() {
  const queue = useQuery(queueQuery()).data;
  const live = useQuery<Record<string, JobProgress>>({ queryKey: queryKeys.progress, queryFn: async () => ({}), enabled: false }).data;
  const running = queue?.running?.[0];
  const latest = Object.values(live ?? {}).reduce<JobProgress | undefined>((current, value) =>
    !current || value.sequence > current.sequence ? value : current, undefined);
  const progress = latest ?? (running && queue?.progress?.job_id === running.id ? queue.progress : undefined);
  return { active: Boolean(running || progress), progress };
}

export function GenerationStatus({ className, wave }: { className?: string; wave?: boolean }) {
  const { t } = useI18n();
  const { active, progress } = useGenerationStatus();
  if (!active) return null;
  const label = t("desktop_progress_generation");
  return <GenerationProgress className={className} wave={wave} label={label} progress={progress} remainingLabel={t("desktop_progress_remaining")}
    details={progress ? progressText(progress, t) : label} />;
}
