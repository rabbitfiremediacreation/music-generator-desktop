import { useEffect, useState } from "react";
import { useIsMutating } from "@tanstack/react-query";
import { useI18n } from "../i18n";
import type { ModelManagerProps } from "../models/ModelManager";
import { ModelDialog } from "../models/ModelDialog";
import { InstalledModels } from "../models/InstalledModels";
import type { useSettingsDraft } from "./useSettingsDraft";

export type SettingsModelManager = ModelManagerProps & { onManage?: () => void };

export function ModelsSettings({ state, active, manager: { onManage, ...manager }, onOpenEngines, onOpenExpertSettings }: {
  state: ReturnType<typeof useSettingsDraft>; active: boolean; manager: SettingsModelManager;
  onOpenEngines: () => void; onOpenExpertSettings: () => void;
}) {
  const { t } = useI18n();
  const { draft, pending } = state;
  const modelBusy = useIsMutating({ mutationKey: ["models"] }) > 0;
  const [adding, setAdding] = useState(false);
  useEffect(() => { if (!active) setAdding(false); }, [active]);
  if (!draft) return null;
  return <>
    <div className="settings-section">
      <InstalledModels section="music" active={active} expertMode={state.confirmedExpertMode ?? false} manager={{ ...manager, disabled: pending }} adding={adding} onAdd={() => setAdding(true)} />
      {adding && <ModelDialog {...manager} showTitleModel={false} title={t("models_add")} disabled={pending}
        onClose={() => setAdding(false)}
        onOpenEngines={() => { setAdding(false); onOpenEngines(); }}
        onOpenSettings={() => { setAdding(false); onOpenExpertSettings(); }} />}
    </div>
    {onManage && <div className="settings-section"><p id="settingsModelSetupHint" className="small">{t("desktop_manage_hint")}</p><button type="button" className="sek" disabled={pending || modelBusy} aria-describedby="settingsModelSetupHint" onClick={onManage}>{t("desktop_manage")}</button></div>}
  </>;
}
