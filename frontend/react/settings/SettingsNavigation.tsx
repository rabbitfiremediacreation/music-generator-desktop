import { useI18n } from "../i18n";

export const settingsGroups = [
  { title: "settings_app", pages: ["generation", "models", "library", "appearance"] },
  { title: "settings_connections", pages: ["phone", "mcp"] },
  { title: "settings_information", pages: ["about"] },
] as const;

export type SettingsPage = typeof settingsGroups[number]["pages"][number];

const icons: Record<SettingsPage, string> = {
  generation: "M4 7h16M4 17h16M8 4v6m8 4v6",
  models: "M7 7h10v10H7ZM9 3v4m6-4v4M9 17v4m6-4v4M3 9h4m-4 6h4m10-6h4m-4 6h4",
  library: "M3 7V5a1 1 0 0 1 1-1h6l2 3h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z",
  appearance: "M4 4h16v16H4ZM10 4v16m0-10h10",
  phone: "M8 2h8a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm3 17h2",
  mcp: "m8 3 1 5m7-5-1 5M6 8h12v3a6 6 0 0 1-12 0V8Zm6 9v5",
  about: "M12 11v6m0-10v.1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
};

export function SettingsNavigation({ page, onChange, disabled }: {
  page: SettingsPage; onChange: (page: SettingsPage) => void; disabled: boolean;
}) {
  const { t } = useI18n();
  return <aside className="settings-sidebar">
    <h2 id="settingsHeading">{t("settings_title")}</h2>
    <nav aria-label={t("settings_title")}>
      {settingsGroups.map(group => <div className="settings-nav-group" key={group.title}>
        <p className="settings-nav-label">{t(group.title)}</p>
        {group.pages.map(value => <button key={value} type="button" className="settings-nav-item"
          aria-current={page === value ? "page" : undefined} aria-controls={`settings-${value}`}
          disabled={disabled} onClick={() => onChange(value)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icons[value]} /></svg>
          <span>{t(`settings_page_${value}`)}</span>
        </button>)}
      </div>)}
    </nav>
    <div className="settings-sidebar-brand">Music Generator</div>
  </aside>;
}
