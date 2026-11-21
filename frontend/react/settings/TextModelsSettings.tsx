import { useIsMutating } from "@tanstack/react-query";
import type { Settings } from "../../types";
import { useI18n } from "../i18n";
import { InstalledModels } from "../models/InstalledModels";
import type { ModelManagerProps } from "../models/ModelManager";
import type { useSettingsDraft } from "./useSettingsDraft";

export function TextModelsSettings({ state, manager }: {
  state: ReturnType<typeof useSettingsDraft>; manager: ModelManagerProps;
}) {
  const { t } = useI18n();
  const { draft, pending } = state;
  const modelBusy = useIsMutating({ mutationKey: ["models"] }) > 0;
  if (!draft) return null;
  return <>
    <div className="settings-section">
      <InstalledModels section="text" active expertMode={state.confirmedExpertMode ?? false} manager={{ ...manager, disabled: pending }} />
    </div>
    <div className="settings-section">
      <label className="field"><span className="lbl" title={t("lm_dev_tip")}>{t("lm_dev")}</span>
        <select name="lm_device" aria-label={t("lm_dev")} value={draft.lm_device} disabled={pending || modelBusy}
          onChange={event => void state.device(event.target.value as Settings["lm_device"])}>
          <option value="auto">{t("lm_dev_auto")}</option><option value="cpu">{t("lm_dev_cpu")}</option>
        </select>
        <span className="small">{t("settings_device_hint")}</span>
        {draft.cpu_only && <span className="small">{t("desktop_intel_cpu_hint")}</span>}
      </label>
    </div>
  </>;
}
