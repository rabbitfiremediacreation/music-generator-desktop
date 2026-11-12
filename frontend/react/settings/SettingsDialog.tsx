import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useIsMutating } from "@tanstack/react-query";
import { pathErrorText } from "../../path-dialogs";
import { modelErrorText } from "../../expert-mode";
import { useI18n } from "../i18n";
import { useSettingsDraft } from "./useSettingsDraft";
import { PhoneAccessField } from "./PhoneAccessField";
import { McpSettings } from "./McpSettings";
import { SettingsNavigation, settingsGroups, type SettingsPage } from "./SettingsNavigation";
import { GenerationSettings } from "./GenerationSettings";
import { ModelsSettings } from "./ModelsSettings";
import type { ModelManagerProps } from "../models/ModelManager";
import { LibrarySettings } from "./LibrarySettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { AboutSettings } from "./AboutSettings";
import "./settings.css";

export interface SettingsDialogProps {
  open: boolean; onClose: () => void; onBusyChange: (busy: boolean) => void;
  modelManager: ModelManagerProps; onMoveLibrary: () => void;
  initialPage?: SettingsPage;
  layout: "auto" | "stack" | "side"; onLayoutChange: (value: "auto" | "stack" | "side") => void;
}

export function SettingsDialog(props: SettingsDialogProps) {
  const { t } = useI18n();
  const state = useSettingsDraft(props.open, props.onClose, props.onBusyChange);
  const modelBusy = useIsMutating({ mutationKey: ["models"] }) > 0;
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const backdropPress = useRef(false);
  const [page, setPage] = useState<SettingsPage>("generation");
  const [mcpSaving, setMcpSaving] = useState(false);
  const [pathError, setPathError] = useState<unknown>();
  const { draft, loading, saving, pending, status, failure } = state;
  useEffect(() => {
    if (props.open && !dialog.current?.open) {
      setPage(props.initialPage ?? "generation"); setPathError(undefined);
      dialog.current?.showModal();
    }
    if (!props.open && dialog.current?.open) dialog.current?.close();
  }, [props.open, props.initialPage]);
  if (!props.open) return null;
  const navigate = (action: () => void) => { props.onClose(); action(); };
  const error = failure ?? pathError;
  const errorText = error instanceof Error && error.message === "mp3_failed" ? t("mp3_failed") : error ? pathErrorText(modelErrorText(error, t)) : "";
  const outside = (x: number, y: number) => {
    const bounds = dialog.current!.getBoundingClientRect();
    return x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom;
  };
  const busy = saving || mcpSaving;
  const dismiss = () => { if (!busy) props.onClose(); };
  const selectPage = (value: SettingsPage) => {
    setPage(value);
    if (content.current) content.current.scrollTop = 0;
  };
  return <dialog ref={dialog} id="settingsDlg" aria-labelledby="settingsHeading"
    onCancel={event => { event.preventDefault(); dismiss(); }}
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dismiss(); } }}
    onPointerDown={event => { backdropPress.current = event.target === event.currentTarget && outside(event.clientX, event.clientY); }}
    onClick={event => {
      const startedOutside = backdropPress.current; backdropPress.current = false;
      if (startedOutside && event.target === event.currentTarget && outside(event.clientX, event.clientY)) { event.preventDefault(); dismiss(); }
    }}>
    <form id="settingsForm" aria-busy={busy || pending || modelBusy}
      onInvalidCapture={event => {
        // Reveal invalid controls on other pages before native validation focuses them.
        const panel = (event.target as HTMLElement).closest<HTMLElement>("[data-settings-page]");
        if (panel) flushSync(() => selectPage(panel.dataset.settingsPage as SettingsPage));
      }}
      onSubmit={event => { event.preventDefault(); if (!busy && !modelBusy) void state.submit(); }}>
      <SettingsNavigation page={page} onChange={selectPage} disabled={busy} />
      <div className="settings-main">
        <header className="settings-page-header">
          <div><h3 id="settingsPageHeading">{t(`settings_page_${page}`)}</h3><p>{t(`settings_description_${page}`)}</p></div>
          <div className="settings-close-wrap"><button type="button" className="settings-close" aria-label={t("desktop_close")} disabled={busy} onClick={dismiss}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
          </button><span aria-hidden="true">ESC</span></div>
        </header>
        <div className="settings-content" ref={content}>
          <p id="settingsStatus" className="small" role="status" aria-live="polite">{status && t(status)}</p>
          {status === "settings_load_failed" && <button type="button" className="sek" onClick={() => void state.load()}>{t("settings_retry")}</button>}
          {settingsGroups.flatMap(group => group.pages).map(value => <section key={value} id={`settings-${value}`} data-settings-page={value} hidden={page !== value} aria-labelledby="settingsPageHeading">
            {value === "phone" ? <PhoneAccessField /> : <fieldset className="settings-fields" disabled={loading || !draft || busy}>
              {value === "generation" && <GenerationSettings state={state} />}
              {value === "models" && <ModelsSettings state={state} active={page === "models"} manager={props.modelManager} />}
              {value === "library" && <LibrarySettings state={state} onMoveLibrary={() => navigate(props.onMoveLibrary)} />}
              {value === "appearance" && <AppearanceSettings layout={props.layout} onLayoutChange={props.onLayoutChange} />}
              {value === "mcp" && <McpSettings onBusyChange={setMcpSaving} />}
              {value === "about" && <AboutSettings onError={setPathError} />}
            </fieldset>}
          </section>)}
        </div>
        <footer className={`settings-footer${state.dirty ? " has-changes" : ""}`}>
          <div className="settings-save-status">
            {saving ? <p role="status">{t("settings_saving")}</p> : state.dirty && <p role="status">{t("settings_unsaved")}</p>}
            {errorText && <p role="alert" className="small err">{t("error")}: {errorText}</p>}
          </div>
          <div className="submit"><button type="button" className="sek" disabled={busy} onClick={props.onClose}>{t("cancel")}</button><button type="submit" className="aktion" disabled={loading || !draft || pending || busy || modelBusy}>{t("save")}</button></div>
        </footer>
      </div>
    </form>
  </dialog>;
}
