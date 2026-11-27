import type { Settings } from "../../types";
import { useI18n } from "../i18n";
import type { useSettingsDraft } from "./useSettingsDraft";

export function GenerationSettings({ state, onCoverModels }: {
  state: ReturnType<typeof useSettingsDraft>;
  onCoverModels: () => void;
}) {
  const { t } = useI18n();
  const { draft, change } = state;
  if (!draft) return null;
  return <div className="settings-section">
    <div className="field">
      <Switch className="settings-toggle" name="generate_cover_art" label={t("cover_art_enable")}
        checked={!!draft.generate_cover_art} disabled={draft.cover_art_supported === false} aria-describedby="coverArtHint"
        onChange={event => change({ generate_cover_art: event.target.checked })} />
      <p id="coverArtHint" className="small">{t(draft.cover_art_supported === false ? "cover_art_unsupported" : "cover_art_hint")}</p>
      {draft.cover_art_supported && <div><button type="button" className="sek" onClick={onCoverModels}>{t("cover_art_manage")}</button></div>}
    </div>
    <label className="field"><span className="lbl">{t("cpu_behavior_label")}</span><select name="cpu_iteration_behavior" aria-label={t("cpu_behavior_label")} value={draft.cpu_iteration_behavior} onChange={event => change({ cpu_iteration_behavior: event.target.value as Settings["cpu_iteration_behavior"] })} aria-describedby="cpuBehaviorHint">
      <option value="ask">{t("cpu_behavior_ask")}</option><option value="limit_30">{t("cpu_behavior_limit")}</option><option value="continue">{t("cpu_behavior_continue")}</option>
    </select><span id="cpuBehaviorHint" className="small">{t("cpu_behavior_hint")}</span></label>
    <label className="field settings-timeout"><span className="lbl">{t("timeout")}</span><input name="timeout_minutes" type="number" min="1" max="600" required value={draft.timeout_minutes} onChange={event => change({ timeout_minutes: Number(event.target.value) })} /></label>
  </div>;
}
import { Switch } from "../../Switch";
