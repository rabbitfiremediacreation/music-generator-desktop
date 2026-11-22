import { audioFormats, type AudioFormat } from "../../audio-formats";
import type { songUsage } from "../../song-usage";
import { useI18n } from "../i18n";
import { ProfileLink } from "../models/ProfileLink";
import { Dialog } from "../ui";
import "./song-usage-i18n";

type Usage = ReturnType<typeof songUsage>;

function SongUsageText({ usage }: { usage: Usage }) {
  const { t } = useI18n();
  return <div className="song-usage-text">
    <p>{usage.text}</p>
    {usage.reference && <p>{t("song_usage_reference")}</p>}
    {usage.sources.length > 0 && <ul>{usage.sources.map((url, index) => <li key={url}>
      <ProfileLink url={url}>{`${t("song_usage_source")}${usage.sources.length > 1 ? ` ${index + 1}` : ""}`}</ProfileLink>
    </li>)}</ul>}
  </div>;
}

export function SongUsageDetails({ usage }: { usage: Usage }) {
  const { t } = useI18n();
  return <details className="song-usage-details">
    <summary>{t("song_usage_terms")}{usage.short && ` · ${t(usage.short)}`}</summary>
    <SongUsageText usage={usage} />
  </details>;
}

export function SongExportDialog({ usage, format, label, onClose, onExport }: {
  usage: Usage; format: AudioFormat | null; label: string; onClose: () => void; onExport: (format: AudioFormat) => void;
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
