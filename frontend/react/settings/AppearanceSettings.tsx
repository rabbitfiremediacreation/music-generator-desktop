import { useSyncExternalStore } from "react";
import { currentTheme, desktopThemes, setTheme, subscribeTheme } from "../../desktop-theme";
import { LANGS, type Language } from "../../locales";
import { currentTitlebarDesign, setTitlebarDesign, subscribeTitlebarDesign, titlebarDesigns } from "../../titlebar-design";
import { useI18n } from "../i18n";
import type { SettingsDialogProps } from "./SettingsDialog";

export function AppearanceSettings({ layout, onLayoutChange }: Pick<SettingsDialogProps, "layout" | "onLayoutChange">) {
  const { language, setLanguage, t } = useI18n();
  const theme = useSyncExternalStore(subscribeTheme, currentTheme);
  const titlebar = useSyncExternalStore(subscribeTitlebarDesign, currentTitlebarDesign);
  const titlebarNames = { auto: t("vt_auto"), classic: "Classic", dev: "Dev", nightly: "Nightly" };
  return <>
    <div className="settings-section">
      <label className="field">
        <span className="lbl">{t("language")}</span>
        <select id="uiLang" value={language} onChange={event => setLanguage(event.target.value as Language)}>
          {Object.entries(LANGS).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
      </label>
    </div>
    <div className="settings-section">
      <label className="field">
        <span className="lbl">{t("settings_titlebar_design")}</span>
        <select value={titlebar} onChange={event => setTitlebarDesign(event.target.value)}>
          {titlebarDesigns.map(id => <option key={id} value={id}>{titlebarNames[id]}</option>)}
        </select>
      </label>
    </div>
    <div className="settings-section">
      <fieldset className="settings-theme" aria-describedby="settingsThemeHint">
        <legend>{t("settings_theme")}</legend>
        <div className="settings-theme-options">
          {desktopThemes.map(({ id, name }) => <label key={id} className="settings-theme-option">
            <input type="radio" name="desktop-theme" value={id} checked={theme === id} onChange={() => setTheme(id)} />
            <span className="settings-theme-preview" data-theme={id} aria-hidden="true">
              <span className="settings-theme-preview-controls" />
              <span className="settings-theme-preview-wave"><span /><span /><span /><span /><span /></span>
            </span>
            <span className="settings-theme-name">{name}</span>
          </label>)}
        </div>
        <p id="settingsThemeHint" className="small">{t("settings_theme_hint")}</p>
      </fieldset>
    </div>
    <div className="settings-section">
      <h4 id="settingsLayoutLabel">{t("layout")}</h4>
      <div className="settings-layout-options" role="group" aria-labelledby="settingsLayoutLabel">
        {(["auto", "stack", "side"] as const).map(value => <button key={value} type="button" className="settings-layout-option"
          aria-pressed={layout === value} title={value === "side" ? t("side_tip") : undefined} onClick={() => onLayoutChange(value)}>
          <span className={`settings-layout-preview is-${value}`} aria-hidden="true"><span /><span /></span>
          <span>{t(value === "auto" ? "vt_auto" : value === "stack" ? "stacked" : "side")}</span>
        </button>)}
      </div>
      <p className="small">{t("settings_appearance_hint")}</p>
    </div>
  </>;
}
