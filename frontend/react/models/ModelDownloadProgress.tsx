import { useQuery } from "@tanstack/react-query";
import type { DownloadProgress } from "../../types";
import { useI18n } from "../i18n";

export function ModelDownloadProgress({ busy, message }: { busy: boolean; message?: string }) {
  const { t, language } = useI18n();
  const progress = useQuery<DownloadProgress | null>({ queryKey: ["models", "progress"], queryFn: async () => null, enabled: false, networkMode: "always" }).data;
  const number = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
  const bytes = (value: number) => `${number.format(value / 1024 ** 3)} GiB`;
  if (!busy && !message) return null;
  return <div id="modelProgressArea">
    {busy && <progress id="modelProgress" max={progress ? Math.max(1, progress.total) : undefined} value={progress?.downloaded} aria-label={t("picker_download")} />}
    <p className="small" role="status" aria-live="polite">{message || (progress ? `${progress.file} · ${t(progress.phase === "verifying" ? "desktop_verifying" : "desktop_downloading")} ${bytes(progress.downloaded)} / ${bytes(progress.total)}${progress.bytes_per_second ? ` · ${number.format(progress.bytes_per_second / 1024 ** 2)} MiB/s` : ""}` : t("desktop_verifying"))}</p>
  </div>;
}
