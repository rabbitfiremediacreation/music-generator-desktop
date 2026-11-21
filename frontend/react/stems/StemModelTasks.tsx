import { samePin, stemApi, type StemCatalog, type StemProfile } from "../../stems";
import { useI18n } from "../i18n";
import type { StemModelManager } from "./useStemModelManager";

export const mib = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(1)} MiB`;

export function stemInstallLabel(profile: StemProfile) {
  if (profile.status === "damaged" && !profile.pending) return "stem_repair";
  if (profile.error) return "retry";
  return profile.downloaded ? "stem_resume" : "stem_install";
}

export function StemRuntimeRequirement({ catalog, onOpenEngines }: {
  catalog?: StemCatalog; onOpenEngines: () => void;
}) {
  const { t } = useI18n();
  if (!catalog) return null;
  if (!catalog.platform_supported) return <p role="status">{t("stem_platform_unsupported")}</p>;
  if (catalog.engine_ready) return null;
  return <div>
    <p className="small">{t("stem_engine_missing")}</p>
    <button type="button" className="sek" onClick={onOpenEngines}>{t("settings_page_engines")}</button>
  </div>;
}

export function StemTransferProgress({ manager }: { manager: StemModelManager }) {
  const { t } = useI18n();
  const { transfer, progress, catalog } = manager;
  if (!transfer) return null;
  const name = catalog.data?.models.find(model => model.id === transfer)?.name ?? transfer;
  const speed = progress?.bytes_per_second ? ` · ${mib(progress.bytes_per_second)}/s` : "";
  return <div className="installed-models-progress">
    <progress max={progress ? Math.max(1, progress.total) : undefined} value={progress?.downloaded} aria-label={t("picker_download")} />
    <p className="small" role="status">{name} · {t(progress ? `stem_${progress.phase}` : "stem_installing")}
      {progress && ` · ${progress.file} · ${mib(progress.downloaded)} / ${mib(progress.total)}${speed}`}</p>
    <button type="button" className="sek" onClick={() => void stemApi.pause(transfer)}>{t("stem_pause")}</button>
  </div>;
}

export function StemModelUpdate({ manager, profile }: { manager: StemModelManager; profile: StemProfile }) {
  const { t } = useI18n();
  const update = manager.updates[profile.id];
  const pin = update?.pin;
  const updateBytes = profile.installed.some(item => item.artifact.sha256 === update?.artifact?.sha256) ? 0 : (update?.artifact?.bytes ?? 0);
  return <>
    <button type="button" className="sek" disabled={manager.working} onClick={() => manager.checkUpdate(profile.id)}>
      {t("stem_check_update")}
    </button>
    {update && (pin && !samePin(profile.active, pin) ?
      <button type="button" className="sek" title={pin.revision} disabled={manager.working || !manager.catalog.data?.engine_ready}
        onClick={() => manager.install(pin)}>{t("stem_update")} · {mib(updateBytes)}</button> :
      <span className="small" role="status">{t(pin ? "stem_up_to_date" : "stem_hf_unconfirmed")}</span>)}
  </>;
}

export function StemRemovalConfirmation({ manager }: { manager: StemModelManager }) {
  const { t } = useI18n();
  const { removal } = manager;
  if (!removal) return null;
  return <div className="installed-models-progress" role="group" aria-label={t("stem_remove")}>
    <strong>{t("stem_remove")} {removal.pin.revision.slice(0, 12)}</strong>
    {removal.impact.files.map(file => <p className="small" key={file.file}>{file.file}{file.shared && ` · ${t("stem_shared")}`}</p>)}
    <p>{t("stem_freed")} · {mib(removal.impact.bytes)}</p>
    {removal.impact.busy && <p role="status">{t("stem_model_in_use")}</p>}
    <div className="stem-row"><button type="button" className="sek" onClick={manager.cancelRemoval}>{t("cancel")}</button>
      <button type="button" className="sek danger" disabled={removal.impact.busy || manager.working}
        onClick={() => manager.confirmRemoval(removal.pin)}>{t("stem_remove")}</button>
    </div>
  </div>;
}
