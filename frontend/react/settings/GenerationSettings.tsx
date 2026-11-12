import type { Settings } from "../../types";
import { useI18n } from "../i18n";
import type { useSettingsDraft } from "./useSettingsDraft";

export function GenerationSettings({ state }: {
  state: ReturnType<typeof useSettingsDraft>;
}) {
  const { t } = useI18n();
  const { draft, change } = state;
  if (!draft) return null;
  return <div className="settings-section">
    <label className="field"><span className="lbl">{t("cpu_behavior_label")}</span><select name="cpu_iteration_behavior" aria-label={t("cpu_behavior_label")} value={draft.cpu_iteration_behavior} onChange={event => change({ cpu_iteration_behavior: event.target.value as Settings["cpu_iteration_behavior"] })} aria-describedby="cpuBehaviorHint">
      <option value="ask">{t("cpu_behavior_ask")}</option><option value="limit_30">{t("cpu_behavior_limit")}</option><option value="continue">{t("cpu_behavior_continue")}</option>
    </select><span id="cpuBehaviorHint" className="small">{t("cpu_behavior_hint")}</span></label>
    <label className="field settings-timeout"><span className="lbl">{t("timeout")}</span><input name="timeout_minutes" type="number" min="1" max="600" required value={draft.timeout_minutes} onChange={event => change({ timeout_minutes: Number(event.target.value) })} /></label>
  </div>;
}
