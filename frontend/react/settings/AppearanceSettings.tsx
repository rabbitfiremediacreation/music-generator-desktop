import { useI18n } from "../i18n";
import type { SettingsDialogProps } from "./SettingsDialog";

export function AppearanceSettings({ layout, onLayoutChange }: Pick<SettingsDialogProps, "layout" | "onLayoutChange">) {
  const { t } = useI18n();
  return <div className="settings-section">
    <h4 id="settingsLayoutLabel">{t("layout")}</h4>
    <div className="settings-layout-options" role="group" aria-labelledby="settingsLayoutLabel">
      {(["auto", "stack", "side"] as const).map(value => <button key={value} type="button" className="settings-layout-option"
        aria-pressed={layout === value} title={value === "side" ? t("side_tip") : undefined} onClick={() => onLayoutChange(value)}>
        <span className={`settings-layout-preview is-${value}`} aria-hidden="true"><span /><span /></span>
        <span>{t(value === "auto" ? "vt_auto" : value === "stack" ? "stacked" : "side")}</span>
      </button>)}
    </div>
    <p className="small">{t("settings_appearance_hint")}</p>
  </div>;
}
