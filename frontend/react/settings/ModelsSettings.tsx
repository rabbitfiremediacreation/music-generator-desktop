import { useEffect, useState } from "react";
import { useIsMutating } from "@tanstack/react-query";
import type { Settings } from "../../types";
import { useI18n } from "../i18n";
import type { ModelManagerProps } from "../models/ModelManager";
import { ModelDialog } from "../models/ModelDialog";
import { InstalledModels } from "../models/InstalledModels";
import type { useSettingsDraft } from "./useSettingsDraft";

export function ModelsSettings({ state, active, manager }: {
  state: ReturnType<typeof useSettingsDraft>; active: boolean; manager: ModelManagerProps;
}) {
  const { t } = useI18n();
  const { draft, pending } = state;
  const modelBusy = useIsMutating({ mutationKey: ["models"] }) > 0;
  const [adding, setAdding] = useState(false);
  useEffect(() => { if (!active) setAdding(false); }, [active]);
  if (!draft) return null;
  return <>
    <div className="settings-section">
      <InstalledModels active={active} expertMode={state.confirmedExpertMode ?? false} manager={{ ...manager, disabled: pending }} adding={adding} onAdd={() => setAdding(true)} />
      {adding && <ModelDialog {...manager} title={t("models_add")} disabled={pending} onClose={() => setAdding(false)} />}
    </div>
    <fieldset className="settings-fields" disabled={pending || modelBusy}>
      <div className="settings-section">
        <label className="field"><span className="lbl" title={t("lm_dev_tip")}>{t("lm_dev")}</span>
          <select name="lm_device" aria-label={t("lm_dev")} value={draft.lm_device} onChange={event => void state.device(event.target.value as Settings["lm_device"])}>
            <option value="auto">{t("lm_dev_auto")}</option><option value="cpu">{t("lm_dev_cpu")}</option>
          </select><span className="small">{t("settings_device_hint")}</span>{draft.cpu_only && <span className="small">{t("desktop_intel_cpu_hint")}</span>}
        </label>
      </div>
      <div className="settings-section">
        <label className="check-row settings-toggle"><span>{t("expert_mode")}</span><input type="checkbox" name="expert_mode" checked={draft.expert_mode} onChange={event => state.change({ expert_mode: event.target.checked })} aria-describedby="expertModeHint" /></label>
        <p id="expertModeHint" className="small">{t("expert_mode_hint")}</p>
        {draft.expert_mode !== state.confirmedExpertMode && <button type="button" className="sek settings-expert-apply" onClick={() => void state.applyExpertMode()}>{t("settings_apply_expert")}</button>}
      </div>
    </fieldset>
    {manager.onManage && <div className="settings-section"><p id="settingsModelSetupHint" className="small">{t("desktop_manage_hint")}</p><button type="button" className="sek" disabled={pending || modelBusy} aria-describedby="settingsModelSetupHint" onClick={manager.onManage}>{t("desktop_manage")}</button></div>}
  </>;
}
