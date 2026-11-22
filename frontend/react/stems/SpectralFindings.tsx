import type { SpectralSelection } from "../../stems";
import { useI18n } from "../i18n";

function timecode(frames: number, rate: number) {
  const ms = Math.round(frames * 1000 / rate);
  const minutes = String(Math.floor(ms / 60_000)).padStart(2, "0");
  const seconds = String(Math.floor(ms % 60_000 / 1000)).padStart(2, "0");
  return `${minutes}:${seconds}.${String(ms % 1000).padStart(3, "0")}`;
}

export function SpectralFindings({ findings, active, frames, rate, first, end, disabled, onSelect }: {
  findings: SpectralSelection[]; active?: number; frames: number; rate: number;
  first: number; end: number; disabled: boolean; onSelect: (index: number) => void;
}) {
  const { language, t } = useI18n();
  const frequency = new Intl.NumberFormat(language, { maximumFractionDigits: 2 });
  if (!findings.length) return <p className="small" role="status">{t("stem_spectral_auto_none")}</p>;
  const label = (finding: SpectralSelection) => {
    const khz = (finding.low_hz + finding.high_hz) / 2000;
    return `${timecode(finding.first, rate)} · ${frequency.format(khz)} kHz`;
  };

  return <div className="spectral-findings">
    <label className="field">
      <span role="status">{t("stem_spectral_findings", findings.length)}</span>
      <select aria-label={t("stem_spectral_finding")} value={active ?? ""} disabled={disabled}
        onChange={event => onSelect(Number(event.target.value))}>
        <option value="" disabled>{t("stem_spectral_finding")}</option>
        {findings.map((finding, index) => <option key={index} value={index}>{label(finding)}</option>)}
      </select>
    </label>
    <div className="spectral-overview">
      <div className="spectral-overview-track" aria-hidden="true">
        <span className="spectral-overview-window" style={{ left: `${first / frames * 100}%`, width: `${(end - first) / frames * 100}%` }} />
        {findings.map((finding, index) => <span className="spectral-overview-mark" key={index} data-active={index === active} title={label(finding)}
          style={{ left: `${finding.first / frames * 100}%`, width: `${(finding.end - finding.first) / frames * 100}%` }} />)}
      </div>
      <div className="spectral-overview-axis" aria-hidden="true"><span>00:00</span><span>{timecode(frames, rate).split(".")[0]}</span></div>
    </div>
  </div>;
}
