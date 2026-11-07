import { useEffect, useRef, useState } from "react";
import { LANGS, type Language } from "../../locales";
import { modelErrorText } from "../../expert-mode";
import { pickFolder, pathErrorText } from "../../path-dialogs";
import type { Bootstrap } from "../../types";
import { useI18n } from "../i18n";
import { BackendDetails } from "./BackendDetails";
import { HardwareCard } from "./HardwareCard";
import { CudaSetup } from "./CudaSetup";
import { useSetup } from "./useSetup";
import { PhoneAccessField } from "../settings/PhoneAccessField";

export interface SetupScreenProps {
  bootstrap: Bootstrap; onComplete: () => void; onBack?: () => void; onReady?: () => void;
  onImport?: (target: string, onImported: (songsDir: string) => void) => void;
}

export function SetupScreen({ bootstrap, onComplete, onBack, onReady, onImport }: SetupScreenProps) {
  const { language, setLanguage, t } = useI18n();
  const state = useSetup(bootstrap, onReady);
  const { draft, setDraft, request, setup, progress, stage } = state;
  const [error, setError] = useState<unknown>(null), [imported, setImported] = useState(false);
  const [step, setStep] = useState(1);
  const enter = useRef<HTMLButtonElement>(null);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const stepContent = useRef<HTMLDivElement>(null);
  const previousStep = useRef(step);
  const bytes = (value: number) => `${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value / 1024 ** 3)} GiB`;
  const errorText = (value: unknown) => pathErrorText(modelErrorText(value, t));
  const result = setup.data, busy = setup.isPending || state.cuda.operation.isPending;
  const cancelled = setup.error !== null && (setup.error instanceof Error ? setup.error.message : String(setup.error)) === "Operation cancelled";
  useEffect(() => { if (result) enter.current?.focus(); }, [result]);
  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    stepContent.current?.scrollTo?.(0, 0);
    stepHeading.current?.focus();
  }, [step]);
  async function browse(field: "models_dir" | "songs_dir") {
    try {
      const path = await pickFolder(field === "models_dir" ? "models" : "songs", draft[field], true);
      if (path) setDraft(current => ({ ...current, [field]: path }));
    } catch (failure) { setError(failure); }
  }
  const models = [...bootstrap.manifest.models.filter(model => model.kind === "required" || model.kind === request.lm || (model.kind === "xl" && request.xl)), bootstrap.title_model];
  const activeProgress = state.cuda.operation.isPending ? state.cuda.progress : progress;
  const activeStage = state.cuda.operation.isPending ? state.cuda.stage : stage;
  const progressText = state.cuda.operation.isPending ? activeStage ? t(activeStage === "installing" ? "cuda_installing" : "cuda_checking") : activeProgress ? `${t("cuda_downloading")} ${activeProgress.file} · ${bytes(activeProgress.downloaded)} / ${bytes(activeProgress.total)}` : t(state.cuda.operation.variables ? "cuda_downloading" : "cuda_checking") : stage ? t(stage === "starting" ? "desktop_starting" : stage === "testing" ? "desktop_testing" : "desktop_cpu_fallback") : progress
    ? `${t(`desktop_${progress.phase}`)} ${progress.file} · ${bytes(progress.downloaded)} / ${bytes(progress.total)}${progress.bytes_per_second ? ` · ${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(progress.bytes_per_second / 1024 ** 2)} MiB/s` : ""}` : t("desktop_checking");
  const steps = ["setup_step_library", "setup_step_models", "setup_step_test"];
  const pathsPending = state.debouncing || state.estimate.isFetching;
  const invalidPaths = !request.models_dir || !request.songs_dir || state.estimate.isError;
  const cudaChecking = state.cuda.enabled && state.cuda.status.isFetching;
  const cannotStart = busy || cudaChecking || state.unsupported || pathsPending || invalidPaths || !state.estimate.data;
  const spaceText = state.unsupported ? t("expert_no_recommendation") : pathsPending ? t("desktop_checking") : state.estimate.error ? errorText(state.estimate.error) : state.estimate.data ? `${t("desktop_space")}: ~${bytes(state.estimate.data.missing_bytes)} / ${bytes(state.estimate.data.free_bytes)}` : t("desktop_checking");
  return <section id="setupScreen" className="setup-screen" aria-labelledby="setupHeading">
    <header className="setup-header">
      <div><h1 id="setupHeading">{t("desktop_welcome")}</h1><p id="bootStatus" role="status">{result ? t("desktop_ready") : bootstrap.error || t(bootstrap.needs_setup ? "desktop_setup_hint" : "desktop_manage_hint")}</p></div>
      <label className="field setup-language"><span className="lbl">{t("language")}</span><select value={language} disabled={busy} onChange={event => setLanguage(event.target.value as Language)}>{Object.entries(LANGS).map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
    </header>
    <ol className="setup-steps">
      {steps.map((label, index) => <li key={label} aria-current={step === index + 1 ? "step" : undefined} className={step > index + 1 ? "is-complete" : undefined}><span className="setup-step-number" aria-hidden="true">{index + 1}</span><span>{t(label)}</span></li>)}
    </ol>
    <form id="setupForm" onSubmit={event => {
      event.preventDefault();
      if (busy || result) return;
      if (step === 1 && !pathsPending && !invalidPaths) setStep(2);
      else if (step === 2 && !cudaChecking) setStep(3);
      else if (step === 3 && !cannotStart) { setError(null); setup.mutate(request); }
    }} onKeyDown={event => { if (event.key === "Enter" && event.target instanceof HTMLSelectElement) event.preventDefault(); }}>
      <div id="setupContent" ref={stepContent} className="setup-content">
        <div className="setup-page-heading">
          <h2 ref={stepHeading} id="setupStepHeading" tabIndex={-1}>{result ? t("backend_setup_result") : t(steps[step - 1])}</h2>
          {!result && <p className="small">{t(step === 1 ? "setup_library_hint" : step === 2 ? "setup_models_hint" : "setup_test_hint")}</p>}
        </div>
        <PhoneAccessField />
        <fieldset id="setupFields" disabled={busy} aria-labelledby="setupStepHeading">
          {step === 1 && <div className="setup-library">
            <div className="setup-paths">
              {(["songs_dir", "models_dir"] as const).map(field => <div className="field" key={field}>
                <label className="lbl" htmlFor={`setup-${field}`}>{t(field === "models_dir" ? "desktop_models_folder" : "songs_dir")}</label>
                <div className="path-picker"><input id={`setup-${field}`} required value={draft[field]} aria-describedby={field === "songs_dir" ? "setupSongsHint setupPathHint" : "setupPathHint"} onChange={event => setDraft(current => ({ ...current, [field]: event.target.value }))} /><button type="button" className="sek" aria-label={`${t("desktop_browse")} ${t(field === "models_dir" ? "desktop_models_folder" : "songs_dir")}`} onClick={() => void browse(field)}>{t("desktop_browse")}</button></div>
                {field === "songs_dir" && <p className="small" id="setupSongsHint">{t("desktop_songs_tip")}</p>}
              </div>)}
              <p className="small" id="setupPathHint">{t(bootstrap.hardware.platform === "macos" ? "path_hint" : "path_hint_plain")}</p>
            </div>
            <section className="import-card"><button type="button" className="sek" hidden={imported} onClick={() => onImport?.(request.songs_dir, songsDir => { setDraft(current => ({ ...current, songs_dir: songsDir })); setImported(true); })}>{t("desktop_import")}</button><p className="small">{t("desktop_import_hint")}</p>{imported && <p role="status">{t("desktop_import_done")}</p>}</section>
          </div>}
          {step === 2 && <div className="setup-models">
            <div className="setup-hardware"><HardwareCard hardware={bootstrap.hardware} backend={state.policy.data?.backend || "unknown"} /><CudaSetup state={state.cuda} disabled={busy} /></div>
            <div className="setup-model-options">
              <label className="field"><span className="lbl">{t("desktop_language_model")}</span><select value={request.lm} disabled={!bootstrap.settings.expert_mode} onChange={event => setDraft(current => ({ ...current, lm: event.target.value }))}>{(bootstrap.settings.expert_mode ? ["0.6B", "1.7B", "4B"] : [request.lm]).map(size => <option key={size}>{size}</option>)}</select><span className="small">{t("desktop_recommended")}: {bootstrap.hardware.recommended_lm}</span></label>
              {state.canUseXl && <label className="check-row"><input type="checkbox" checked={draft.xl} onChange={event => setDraft(current => ({ ...current, xl: event.target.checked }))} /><span>{t("desktop_xl")}</span></label>}
              <details className="setup-model-files"><summary>{t("setup_model_files")} · {models.length}</summary><div className="model-list">{models.map(model => <div key={model.file}>{model.file} · ~{bytes(model.estimated_bytes)}</div>)}</div></details>
            </div>
          </div>}
          {step === 3 && (result ? <section className="hardware-card setup-result"><div role="status" aria-live="polite"><BackendDetails status={result.backend_status} /></div></section> : <dl className="setup-summary">
            <div><dt>{t("songs_dir")}</dt><dd>{request.songs_dir}<p className="small">{t("desktop_songs_tip")}</p></dd></div>
            <div><dt>{t("desktop_models_folder")}</dt><dd>{request.models_dir}</dd></div>
            <div><dt>{t("desktop_language_model")}</dt><dd>{request.lm}{request.xl ? " · XL" : ""}</dd></div>
          </dl>)}
        </fieldset>
        {!result && <p id="spaceEstimate" className={`small${state.estimate.isError || state.unsupported ? " setup-error" : ""}`} aria-live="polite">{spaceText}</p>}
        {cancelled && !state.cancel.error && <p role="status" aria-live="polite">{t("setup_cancelled")}</p>}
        {(error || (!cancelled && setup.error) || state.cancel.error) && <p role="alert" className="setup-error">{errorText(error || state.cancel.error || setup.error)}</p>}
      </div>
      <footer className="setup-footer">
        {busy && <div id="setupProgressArea"><progress id="setupProgress" max={1} value={!activeStage && activeProgress ? activeProgress.downloaded / Math.max(activeProgress.total, 1) : undefined} aria-label={t("picker_download")} /><p id="setupProgressText" role="status" aria-live="polite">{progressText}</p></div>}
        <div className="setup-actions">
          {!result && <div className="setup-back-actions">
            {step > 1 && <button className="sek" type="button" disabled={busy} onClick={() => setStep(current => current - 1)}>{t("setup_previous")}</button>}
            {!bootstrap.needs_setup && onBack && <button id="setupBack" className="sek" type="button" disabled={busy} onClick={onBack}>{t("desktop_back")}</button>}
          </div>}
          {result ? <button type="button" ref={enter} className="aktion big" onClick={onComplete}>{t("backend_enter_studio")}</button> : busy ? <button className="sek" type="button" disabled={state.cancel.isPending} onClick={() => state.cancel.mutate()}>{t("cancel")}</button> : <button className="aktion big" type="submit" disabled={step === 1 ? pathsPending || invalidPaths : step === 2 ? cudaChecking : cannotStart}>{t(step < 3 ? "setup_next" : "desktop_start")}</button>}
        </div>
      </footer>
    </form>
  </section>;
}
