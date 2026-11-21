import { Switch } from "../../Switch";
import { useI18n } from "../i18n";
import { HuggingFaceTokenField } from "./HuggingFaceTokenField";
import type { useSettingsDraft } from "./useSettingsDraft";

export function GeneralSettings({ state, modelBusy }: {
  state: ReturnType<typeof useSettingsDraft>; modelBusy: boolean;
}) {
  const { t } = useI18n();
  const { draft, pending, confirmedExpertMode } = state;
  if (!draft) return null;
  return <>
    <fieldset className="settings-fields" disabled={pending || modelBusy}>
      <div className="settings-section">
        <Switch className="settings-toggle" label={t("expert_mode")} name="expert_mode" checked={draft.expert_mode}
          onChange={event => state.change({ expert_mode: event.target.checked })} aria-describedby="expertModeHint" />
        <p id="expertModeHint" className="small">{t("expert_mode_hint")}</p>
        {draft.expert_mode !== confirmedExpertMode && <button type="button" className="sek settings-expert-apply"
          onClick={() => void state.applyExpertMode()}>{t("settings_apply_expert")}</button>}
      </div>
    </fieldset>
    <HuggingFaceTokenField />
  </>;
}
