import { useEffect, useRef, useState } from "react";
import { LANGS, type Language } from "../../locales";
import { modelErrorText } from "../../expert-mode";
import { pickFolder, pathErrorText } from "../../path-dialogs";
import type { Bootstrap } from "../../types";
import { useI18n } from "../i18n";
import { BackendDetails } from "./BackendDetails";
import { HardwareCard } from "./HardwareCard";
import { useSetup } from "./useSetup";

export interface SetupScreenProps {
  bootstrap: Bootstrap; onComplete: () => void; onBack?: () => void; onReady?: () => void;
  onImport?: (target: string, onImported: (songsDir: string) => void) => void;
}

export function SetupScreen({ bootstrap, onComplete, onBack, onReady, onImport }: SetupScreenProps) {
  const { language, setLanguage, t } = useI18n();
  const state = useSetup(bootstrap, onReady);
  const { draft, setDraft, request, setup, progress, stage } = state;
  const [error, setError] = useState<unknown>(null), [imported, setImported] = useState(false);
  const enter = useRef<HTMLButtonElement>(null);
  const bytes = (value: number) => `${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value / 1024 ** 3)} GiB`;
  const errorText = (value: unknown) => pathErrorText(modelErrorText(value, t));
  const result = setup.data, busy = setup.isPending;
  const cancelled = setup.error !== null && (setup.error instanceof Error ? setup.error.message : String(setup.error)) === "Operation cancelled";
  useEffect(() => { if (result) enter.current?.focus(); }, [result]);
  async function browse(field: "models_dir" | "songs_dir") {
    try {
      const path = await pickFolder(field === "models_dir" ? "models" : "songs", draft[field], true);
      if (path) setDraft(current => ({ ...current, [field]: path }));
    } catch (failure) { setError(failure); }
  }
  const models = [...bootstrap.manifest.models.filter(model => model.kind === "required" || model.kind === request.lm || (model.kind === "xl" && request.xl)), bootstrap.title_model];
  const progressText = stage ? t(stage === "starting" ? "desktop_starting" : stage === "testing" ? "desktop_testing" : "desktop_cpu_fallback") : progress
    ? `${t(`desktop_${progress.phase}`)} ${progress.file} · ${bytes(progress.downloaded)} / ${bytes(progress.total)}${progress.bytes_per_second ? ` · ${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(progress.bytes_per_second / 1024 ** 2)} MiB/s` : ""}` : t("desktop_checking");
  return <section id="setupScreen" className="setup-screen" aria-labelledby="setupHeading">
    <h1 id="setupHeading">{t("desktop_welcome")}</h1>
    <p id="bootStatus" role="status">{result ? t("desktop_ready") : bootstrap.error || t(bootstrap.needs_setup ? "desktop_setup_hint" : "desktop_manage_hint")}</p>
    <div id="setupContent">
      <label className="field"><span className="lbl">{t("language")}</span><select value={language} disabled={busy} onChange={event => setLanguage(event.target.value as Language)}>{Object.entries(LANGS).map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
      {!result && <form id="setupForm" onSubmit={event => { event.preventDefault(); if (!busy) { setError(null); setup.mutate(request); } }} onKeyDown={event => { if (event.key === "Enter" && event.target instanceof HTMLSelectElement) event.preventDefault(); }}>
        <fieldset id="setupFields" disabled={busy}>
          <HardwareCard hardware={bootstrap.hardware} backend={state.policy.data?.backend || "unknown"} />
          <section className="import-card"><button type="button" className="sek" hidden={imported} onClick={() => onImport?.(request.songs_dir, songsDir => { setDraft(current => ({ ...current, songs_dir: songsDir })); setImported(true); })}>{t("desktop_import")}</button><p className="small">{t("desktop_import_hint")}</p>{imported && <p role="status">{t("desktop_import_done")}</p>}</section>
          {(["models_dir", "songs_dir"] as const).map(field => <label className="field" key={field}>
            <span className="lbl">{t(field === "models_dir" ? "desktop_models_folder" : "songs_dir")}</span>
            <div className="path-picker"><input required value={draft[field]} aria-describedby="setupPathHint" onChange={event => setDraft(current => ({ ...current, [field]: event.target.value }))} /><button type="button" className="sek" aria-label={`${t("desktop_browse")} ${t(field === "models_dir" ? "desktop_models_folder" : "songs_dir")}`} onClick={() => void browse(field)}>{t("desktop_browse")}</button></div>
          </label>)}
          <p className="small" id="setupPathHint">{t(bootstrap.hardware.platform === "macos" ? "path_hint" : "path_hint_plain")}</p>
          <label className="field"><span className="lbl">{t("desktop_language_model")}</span><select value={request.lm} disabled={!bootstrap.settings.expert_mode} onChange={event => setDraft(current => ({ ...current, lm: event.target.value }))}>{(bootstrap.settings.expert_mode ? ["0.6B", "1.7B", "4B"] : [request.lm]).map(size => <option key={size}>{size}</option>)}</select><span className="small">{t("desktop_recommended")}: {bootstrap.hardware.recommended_lm}</span></label>
          {state.canUseXl && <label className="check-row"><input type="checkbox" checked={draft.xl} onChange={event => setDraft(current => ({ ...current, xl: event.target.checked }))} /><span>{t("desktop_xl")}</span></label>}
          <div className="model-list">{models.map(model => <div key={model.file}>{model.file} · ~{bytes(model.estimated_bytes)}</div>)}</div>
          <p id="spaceEstimate" className="small" aria-live="polite">{state.unsupported ? t("expert_no_recommendation") : state.debouncing ? t("desktop_checking") : state.estimate.error ? errorText(state.estimate.error) : state.estimate.data ? `${t("desktop_space")}: ~${bytes(state.estimate.data.missing_bytes)} / ${bytes(state.estimate.data.free_bytes)}` : t("desktop_checking")}</p>
          <button className="aktion big" type="submit" disabled={state.unsupported || state.debouncing || state.estimate.isFetching || !state.estimate.data || state.estimate.isError}>{t("desktop_start")}</button>
        </fieldset>
      </form>}
      {busy && <div id="setupProgressArea"><progress id="setupProgress" max={1} value={!stage && progress ? progress.downloaded / Math.max(progress.total, 1) : undefined} aria-label={t("picker_download")} /><p id="setupProgressText" role="status" aria-live="polite">{progressText}</p><button className="sek" type="button" disabled={state.cancel.isPending} onClick={() => state.cancel.mutate()}>{t("cancel")}</button></div>}
      {result && <section className="hardware-card" aria-labelledby="setupResultHeading"><h2 id="setupResultHeading">{t("backend_setup_result")}</h2><div role="status" aria-live="polite"><BackendDetails status={result.backend_status} /></div><button type="button" ref={enter} className="aktion big" onClick={onComplete}>{t("backend_enter_studio")}</button></section>}
      {cancelled && !state.cancel.error && <p role="status" aria-live="polite">{t("setup_cancelled")}</p>}
      {(error || (!cancelled && setup.error) || state.cancel.error) && <p role="alert" className="setup-error">{errorText(error || state.cancel.error || setup.error)}</p>}
      {!result && !bootstrap.needs_setup && onBack && <button id="setupBack" className="sek" type="button" disabled={busy} onClick={onBack}>{t("desktop_back")}</button>}
    </div>
  </section>;
}
