import { useQueries } from "@tanstack/react-query";
import { ActivityProgress } from "../GenerationActivity";
import type { DownloadProgress } from "../types";
import { GenerationStatus } from "./generation/GenerationStatus";
import { useI18n } from "./i18n";

const downloadQueries = ["engines", "models", "setup"].map(source => ({
  queryKey: [source, "progress"],
  queryFn: async (): Promise<DownloadProgress | null> => null,
  enabled: false,
}));

export function ActivityStatus({ className, showGeneration = false }: { className?: string; showGeneration?: boolean }) {
  const { t } = useI18n();
  const progress = useQueries({ queries: downloadQueries }).find(query => query.data)?.data;
  if (!progress) return showGeneration ? <GenerationStatus className={className} /> : null;

  const label = t(progress.phase === "installing" ? "engine_installing" : `desktop_${progress.phase}`);
  const { downloaded, total, bytes_per_second: rate } = progress;
  const value = total > 0 ? Math.min(100, Math.floor(downloaded / total * 100)) : undefined;
  const remaining = progress.phase === "downloading" && rate > 0 && total > downloaded
    ? Math.ceil((total - downloaded) / rate) : undefined;
  return <ActivityProgress className={className} label={label} details={`${label} · ${progress.file}`}
    value={value} remaining={remaining} remainingLabel={t("desktop_progress_remaining")} />;
}
