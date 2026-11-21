import { useEffect, useState } from "react";
import { stemApi, stemError } from "../../stems";
import { useI18n } from "../i18n";
import { ModelPickerDialog } from "../models/ModelPickerDialog";
import { StemInstalledModels } from "../stems/StemInstalledModels";
import { StemModelCatalog } from "../stems/StemModels";
import { mib, stemInstallLabel, StemRemovalConfirmation, StemRuntimeRequirement, StemTransferProgress } from "../stems/StemModelTasks";
import { useStemModelManager } from "../stems/useStemModelManager";

export function StemModelsSettings({ active, onOpenEngines }: { active: boolean; onOpenEngines: () => void }) {
  const { t } = useI18n();
  const manager = useStemModelManager(active);
  const { catalog, error, transfer, working, install, run } = manager;
  const [adding, setAdding] = useState(false);
  useEffect(() => { if (!active) setAdding(false); }, [active]);
  if (!active) return null;
  return <>
    <div className="settings-section">
      <StemInstalledModels manager={manager} onAdd={() => setAdding(true)} />
      {catalog.isPending && <p role="status" className="small">{t("desktop_checking")}</p>}
      {catalog.error && <div>
        <p role="alert" className="setup-error">{stemError(catalog.error, t)}</p>
        <button type="button" className="sek" onClick={() => void catalog.refetch()}>{t("settings_retry")}</button>
      </div>}
      {!adding && error && <p role="alert" className="setup-error">{error}</p>}
      {!adding && <StemRemovalConfirmation manager={manager} />}
      {!adding && <StemTransferProgress manager={manager} />}
      {!adding && catalog.data?.models.map(profile => {
        const pending = profile.pending;
        if (!pending || transfer === profile.id) return null;
        const total = pending.artifact.bytes + profile.configuration.bytes;
        return <div className="installed-models-progress" key={profile.id}>
          <strong>{profile.name}</strong>
          <p className="small">{mib(profile.downloaded)} / {mib(total)} · {t(profile.error || "stem_paused")}</p>
          <div className="stem-row">
            <button type="button" className="sek" disabled={working || !catalog.data?.engine_ready}
              onClick={() => install(pending)}>{t(stemInstallLabel(profile))}</button>
            <button type="button" className="sek" disabled={working}
              onClick={() => void run(() => stemApi.discard(profile.id))}>{t("stem_discard")}</button>
          </div>
        </div>;
      })}
    </div>
    {catalog.data && (!catalog.data.platform_supported || !catalog.data.engine_ready) &&
      <div className="settings-section"><StemRuntimeRequirement catalog={catalog.data} onOpenEngines={onOpenEngines} /></div>}
    {adding && <ModelPickerDialog title={t("models_add")} onClose={() => setAdding(false)}>
      <StemModelCatalog manager={manager} onOpenEngines={() => { setAdding(false); onOpenEngines(); }} />
    </ModelPickerDialog>}
  </>;
}
