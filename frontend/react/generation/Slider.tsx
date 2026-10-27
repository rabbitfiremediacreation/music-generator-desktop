import type { CSSProperties } from "react";
import { useI18n } from "../i18n";

interface Props { name: string; label: string; title?: string; value: number; min: number; max: number; step?: number; format?: "duration" | "bpm" | "temperature"; risk?: boolean; onChange: (value: number) => void }
export function Slider({ name, label, title, value, min, max, step = 1, format, risk = false, onChange }: Props) {
  const { t } = useI18n();
  const actual = format === "bpm" && value === 0 ? min : value;
  const text = format === "duration" ? `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}` : format === "temperature" ? value.toFixed(2) : format === "bpm" && value <= min ? "AUTO" : String(value);
  const ariaText = format === "duration" ? t("vt_dur", Math.floor(value / 60), value % 60) : format === "bpm" ? value <= min ? t("vt_auto") : `${value} BPM` : text;
  return <div className={`slider${risk ? " cpu-risk" : ""}`} data-fmt={format === "duration" ? "dur" : format === "temperature" ? "temp" : format === "bpm" ? "bpm" : "int"} style={{ "--p": (actual - min) / (max - min) } as CSSProperties}>
    <div className="fill" /><div className="knob"><span className={text === "AUTO" ? "small" : undefined}>{text}</span></div>
    <input name={name} type="range" min={min} max={max} step={step} value={actual} aria-label={label} title={title} aria-valuetext={ariaText} aria-describedby={risk ? "cpuGenerationWarning" : undefined} onChange={event => onChange(format === "bpm" && Number(event.target.value) <= min ? 0 : Number(event.target.value))} />
  </div>;
}
