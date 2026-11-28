import { audioFormats, type AudioFormat } from "../../audio-formats";
import type { SongUsage } from "../../song-usage";
import { useI18n } from "../i18n";
import { ProfileLink } from "../models/ProfileLink";
import { Dialog } from "../ui";
import "./song-usage-i18n";

export function SongUsageBadges({ usage, hasOutput }: { usage: SongUsage; hasOutput: boolean }) {
  const { t } = useI18n();
  if (!usage.modelLicense && !hasOutput) return null;
  return <div className="song-licenses" role="group" aria-label={t("song_usage_terms")}>
    {usage.modelLicense && <span className="license-badge model-license" title={t("model_weight_license")}>
      <span>{t("song_model_license")}</span> <b>{usage.modelLicense}</b>
    </span>}
    {hasOutput && <span className="license-badge" data-terms={usage.badge} title={usage.text}>{t(usage.badge)}</span>}
    {hasOutput && usage.reference && <span className="license-badge" data-terms="reference" title={t("song_usage_reference")}>{t("song_reference_badge")}</span>}
  </div>;
}

function SongUsageText({ usage }: { usage: SongUsage }) {
  const { t } = useI18n();
  return <div className="song-usage-text">
    <p>{usage.text}</p>
    {usage.reference && <p>{t("song_usage_reference")}</p>}
    {usage.sources.length > 0 && <ul>{usage.sources.map((url, index) => <li key={url}>
      <ProfileLink url={url}>{`${t("song_usage_source")}${usage.sources.length > 1 ? ` ${index + 1}` : ""}`}</ProfileLink>
    </li>)}</ul>}
  </div>;
}

export function SongUsageDetails({ usage }: { usage: SongUsage }) {
  const { t } = useI18n();
  return <div className="song-usage-details">
    <h4>{t("song_usage_terms")}</h4>
    <SongUsageText usage={usage} />
  </div>;
}

export function SongExportDialog({ usage, format, label, onClose, onExport }: {
  usage: SongUsage; format: AudioFormat | null; label: string; onClose: () => void; onExport: (format: AudioFormat) => void;
}) {
  const { t } = useI18n();
  return <Dialog open={format !== null} title={t("song_export_audio")} onClose={onClose} className="song-export-dialog">
    {format !== null && <>
      <h2>{t("song_export_audio")}</h2>
      <p>{label} · {audioFormats[format].label ?? t("download_original")}</p>
      <SongUsageText usage={usage} />
      <div className="submit">
        <button type="button" className="sek" ref={button => { button?.setAttribute("autofocus", ""); }} onClick={onClose}>{t("cancel")}</button>
        <button type="button" className="aktion" onClick={() => onExport(format)}>{t("song_export_continue")}</button>
      </div>
    </>}
  </Dialog>;
}
