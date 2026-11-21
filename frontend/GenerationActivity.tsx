import type { JobProgress } from "./types";
import { audioTime } from "./song-result";
import "./generation-activity.css";

export function WaveLogo({ active = false, className = "" }: { active?: boolean; className?: string }) {
  return <svg className={`app-wave ${className}`} data-active={active || undefined} viewBox="0 0 84 84" aria-hidden="true">
    <rect className="app-wave-background" x="1" y="1" width="82" height="82" rx="14" />
    <g className="app-wave-bars">{[12, 28, 44, 24, 36, 16].map((height, index) =>
      <rect key={index} x={16 + index * 9} y={(84 - height) / 2} width="5" height={height} rx="2.5" />,
    )}</g>
  </svg>;
}

type ActivityProgressProps = {
  label: string; details: string; remainingLabel?: string; wave?: boolean; className?: string;
  value?: number; remaining?: number | null; approximate?: boolean;
};

export function GenerationProgress({ progress, ...props }: Omit<ActivityProgressProps, "value" | "remaining" | "approximate"> & { progress?: JobProgress | null }) {
  return <ActivityProgress {...props} value={progress?.overall_percent} remaining={progress?.estimated_remaining_seconds} approximate />;
}

export function ActivityProgress({ value, remaining, approximate, label, details, remainingLabel, wave = true, className = "" }: ActivityProgressProps) {
  const percentage = value === undefined ? undefined : `${approximate && value > 0 && value < 100 ? "≈ " : ""}${value}%`;
  const estimate = remainingLabel && remaining != null && remaining > 0 ? `${remainingLabel} ≈ ${audioTime(remaining)}` : undefined;
  const valueText = [details, percentage, estimate].filter(Boolean).join(" · ");
  return <div className={`song-activity ${className}`}>
    {wave && <WaveLogo active />}
    <div className="song-activity-body">
      <div className="song-activity-line">
        <div className="song-activity-text" title={details}>{details}</div>
        <div className="song-activity-measures">
          {percentage && <span className="song-activity-percent">{percentage}</span>}
          {estimate && <span className="song-activity-estimate">{estimate}</span>}
        </div>
      </div>
      <progress className="song-activity-meter" aria-label={label} aria-valuetext={valueText} max={100} value={value} />
    </div>
  </div>;
}
