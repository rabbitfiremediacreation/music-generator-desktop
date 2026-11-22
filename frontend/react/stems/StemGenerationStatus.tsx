import { useI18n } from "../i18n";
import type { RunningStemGeneration } from "./useStemGeneration";

export function StemGenerationStatus({ job }: { job: RunningStemGeneration }) {
  const { t, language } = useI18n();
  const { progress, cancelling } = job;
  const percent = progress?.overall_percent || undefined;
  return <div className="stem-progress">
    <progress max={100} value={percent} aria-label={t("stem_layer_progress")} />
    <p role="status" className="small">
      {t(cancelling ? "stem_layer_cancelling" : progress?.phase === "context" ? "stem_layer_mixing"
        : progress?.phase === "saving" ? "stem_layer_saving" : "stem_layer_running")}
      {progress?.step != null && progress.total_steps != null && !cancelling && ` · ${progress.step}/${progress.total_steps}`}
      {percent !== undefined && !cancelling && ` · ${new Intl.NumberFormat(language, { style: "percent" }).format(percent / 100)}`}
    </p>
  </div>;
}
