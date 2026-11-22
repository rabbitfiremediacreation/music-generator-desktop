import { useQuery } from "@tanstack/react-query";
import { workQueueQuery } from "./data";
import { useI18n } from "./i18n";
import { runningWorkCount } from "./work-queue";
import "./workspace.css";

const icons = {
  create: "M9 17V5l11-2v12 M9 17a3 2 0 1 1-6 0 3 2 0 1 1 6 0 M20 15a3 2 0 1 1-6 0 3 2 0 1 1 6 0",
  remix: "M3 6h3c4 0 5 12 10 12h5m-4-4 4 4-4 4M3 18h3c1.5 0 2.5-1.5 3.5-3.5M14 8.5c.7-1.5 1.8-2.5 3-2.5h4m-4-4 4 4-4 4",
  mix: "M5 3v6m0 4v8m7-18v11m0 4v3m7-18v4m0 4v10M2 9h6v4H2zm7 5h6v4H9zm7-7h6v4h-6z",
  queue: "M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1",
};
export type WorkspaceMode = keyof typeof icons;
const modes: WorkspaceMode[] = ["create", "remix", "mix", "queue"];

export function WorkspaceNavigation({ mode, active, onChange, onSettings }: {
  mode: WorkspaceMode; active: boolean; onChange: (mode: WorkspaceMode) => void; onSettings: () => void;
}) {
  const { t } = useI18n();
  const { data: running = 0 } = useQuery({ ...workQueueQuery(), enabled: active, refetchInterval: 750, select: runningWorkCount });
  return <nav className="workspace-nav" aria-label={t("workspace_navigation")}>
    {modes.map(value => {
      const label = t(`workspace_${value}`);
      const count = value === "queue" ? running : 0;
      const status = count ? t("queue_running_count", count) : undefined;
      return <button key={value} type="button" aria-label={label} aria-description={status} title={status ? `${label} · ${status}` : label}
        aria-current={value === mode ? "page" : undefined} onClick={() => onChange(value)}>
        <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
          strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={icons[value]} /></svg>
        {count > 0 && <span className="workspace-queue-count" aria-hidden="true">{count}</span>}
      </button>;
    })}
    <button type="button" className="workspace-settings" aria-label={t("settings_title")} title={t("settings_title")} onClick={onSettings}>
      <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
        strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3.2"/>
        <path d="M9 3h6l1 4 4 2v6l-4 2-1 4H9l-1-4-4-2V9l4-2z"/>
      </svg>
    </button>
  </nav>;
}
