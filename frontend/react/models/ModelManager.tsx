import { useEffect, useRef, useState } from "react";
import { backend } from "../../backend";
import { modelErrorText } from "../../expert-mode";
import { profile } from "../../model-options";
import type { ModelSelection } from "../../types";
import { useI18n } from "../i18n";
import { ModelSelectFields } from "./ModelSelectFields";
import { ModelDownloadProgress } from "./ModelDownloadProgress";
import { ModelBrowser } from "./ModelBrowser";
import { ModelProfileFiles } from "./ModelProfileFiles";
import { ModelProfileDetails } from "./ModelProfileDetails";
import { useModelDialog } from "./useModelDialog";

export interface ModelManagerProps {
  selection: ModelSelection | null; currentSelection: ModelSelection | null;
  selectionRevision: number; onUse: (selection: ModelSelection, before: number) => void;
  onOpenSettings?: () => void; onRecommendedSteps?: (steps: number) => void; disabled?: boolean;
}

export function ModelManager({ selection, currentSelection, selectionRevision, onUse, onOpenSettings, onRecommendedSteps, disabled = false }: ModelManagerProps) {
  const { t, language } = useI18n();
  const state = useModelDialog(selection, selectionRevision, onUse);
  const { draft, busy } = state;
  const downloadBusy = busy && !state.adopt.isPending;
  const snapshot = state.catalog.data;
  const catalog = snapshot && state.settings.data ? { ...snapshot, expert_mode: state.settings.data.expert_mode, recommended_profiles: state.settings.data.recommended_profiles ?? snapshot.recommended_profiles } : snapshot;
  const [compatible, setCompatible] = useState(true), [error, setError] = useState<unknown>(null), [loadingSteps, setLoadingSteps] = useState(false);
  const mounted = useRef(false), recommendation = useRef(0);
  const intent = useRef({ draft, currentSelection, selectionRevision });
  if (intent.current.draft !== draft || intent.current.currentSelection !== currentSelection || intent.current.selectionRevision !== selectionRevision) {
    recommendation.current++;
    intent.current = { draft, currentSelection, selectionRevision };
  }
  useEffect(() => {
    const requests = recommendation;
    mounted.current = true;
    return () => { mounted.current = false; requests.current++; };
  }, []);
  const bytes = (value: number) => `${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value / 1024 ** 3)} GiB`;
  const selected = catalog && draft ? profile(catalog, draft) : null;
  const metadata = selected?.metadata;
  const manual = metadata?.acquisition === "manual";
  const yue2 = metadata?.selection.provider === "yue2";
  const evaluation = metadata?.usage.noncommercial_evaluation;
  const canInstall = metadata?.available ?? (catalog?.providers.some(provider => provider.id === draft?.provider && provider.status === "available") || false);
  const verifyOnly = manual && !canInstall;
  const existing = catalog && draft && catalog.selection.provider === draft.provider && catalog.selection.synthesis === draft.synthesis && catalog.selection.language === draft.language;
  const spaceLow = !manual && !!selected && catalog?.free_bytes !== null && catalog?.free_bytes !== undefined && selected.download > 0 && selected.download + 512 * 1024 ** 2 > catalog.free_bytes;
  const missingFiles = selected?.models.some(model => !model.present);
  const missingImport = manual && missingFiles;
  const blocked = disabled || !selected || busy || missingImport ||
    (verifyOnly ? !selected.complete || selected.filesVerified :
      !selected.valid || !selected.allowed || (!selected.compatible && !existing) || spaceLow);
  async function recommendedSteps() {
    if (!draft || !currentSelection || currentSelection.synthesis !== draft.synthesis || currentSelection.provider !== draft.provider) { setError(new Error(t("picker_select_first"))); return; }
    const request = ++recommendation.current;
    setLoadingSteps(true); setError(null);
    try {
      const policy = await backend.generationPolicy(draft);
      if (!mounted.current || request !== recommendation.current) return;
      if (policy.recommended_steps) { onRecommendedSteps?.(policy.recommended_steps); state.setMessage(`${t("iterations")}: ${policy.recommended_steps}`); }
    } catch (failure) { if (mounted.current && request === recommendation.current) setError(failure); }
    finally { if (mounted.current) setLoadingSteps(false); }
  }
  const failure = error || state.install.error || state.title.error || state.cancel.error;
  const verifyLabel = evaluation ? "provider_evaluation_verify" : manual ? "provider_verify_import" : "picker_verify_use";
  let actionLabel = verifyLabel;
  if (verifyOnly) actionLabel = selected?.filesVerified ? "provider_import_verified" : "provider_verify_only";
  else if (selected?.verified) actionLabel = evaluation ? "provider_evaluation_use" : "picker_use";
  else if (!manual && selected?.download) actionLabel = evaluation ? "provider_evaluation_download" : "picker_download_use";
  return <section className="model-manager" aria-label={t("picker_title")}>
    {state.catalog.isPending && <p role="status">{t("desktop_checking")}</p>}
    {state.catalog.error && <div><p role="alert" className="setup-error">{modelErrorText(state.catalog.error, t)}</p><button type="button" className="sek" onClick={() => void state.catalog.refetch()}>{t("settings_retry")}</button></div>}
    {catalog && draft && selected && <ModelBrowser catalog={catalog} draft={draft} currentSelection={currentSelection} onChange={state.setDraft} compatibleOnly={compatible} onCompatibleChange={setCompatible} busy={busy || disabled}>
      {metadata && <>
        <p className="small">{metadata.capabilities.output_kind === "midi" ? t("midi_format") : metadata.capabilities.bars?.length
          ? t("clip_duration_hint", metadata.capabilities.bars.join(" / "), metadata.capabilities.max_duration)
          : `${t(yue2 ? "provider_duration_limit" : metadata.capabilities.reference_audio ? "mulacover_maximum_duration" : "length")} · ${t("provider_duration_hint", metadata.capabilities.min_duration, metadata.capabilities.max_duration)}`}</p>
        {metadata.runtime_note && <p className="small" role="note">{t(metadata.runtime_note)}</p>}
        {!metadata.available && <p className="setup-error" role="status">{t(metadata.unavailable_reason || "provider_unavailable")}</p>}
      </>}
      <section className="model-download-card" aria-label={t("browser_download_options")}>
        <h5>{t("browser_download_options")}</h5>
        <ModelSelectFields catalog={catalog} draft={draft} metadata={metadata} onChange={state.setDraft} compatibleOnly={compatible} busy={busy || disabled}
          discovered={state.discovery.data?.candidates ?? []} onAdopt={pin => state.adopt.mutate({ pin, draft })} />
        {state.discovery.isFetching && <p className="small" role="status">{t("hf_loading")}</p>}
        {state.adopt.isPending && <p className="small" role="status">{t("hf_checking_file")}</p>}
        {(state.discovery.isError || !!state.discovery.data?.unavailable_repositories.length) &&
          <div className="model-online-status"><span className="small" role="status">{t("hf_metadata_unavailable")}</span>
            <button type="button" className="sek" disabled={busy || disabled || state.discovery.isFetching} onClick={() => void state.discovery.refetch()}>{t("settings_retry")}</button>
          </div>}
        {state.adopt.error && <div className="model-online-status">
          <span className="setup-error" role="alert">{t(state.adopt.error.message)}</span>
          {state.adopt.error.message === "hf_model_changed" && <button type="button" className="sek" disabled={busy || disabled || state.discovery.isFetching} onClick={() => {
            state.adopt.reset();
            void state.discovery.refetch();
          }}>{t("settings_retry")}</button>}
        </div>}
        <dl className="model-requirements">
          {selected.complete && <div><dt>{t("picker_memory")}</dt><dd>{bytes(selected.memory)}</dd></div>}
          {(canInstall || verifyOnly) && <>
            {!manual && <div><dt>{t("picker_download")}</dt><dd>{bytes(selected.download)}</dd></div>}
            <div><dt>{t("desktop_space")}</dt><dd>{catalog.free_bytes === null ? "—" : bytes(catalog.free_bytes)}</dd></div>
          </>}
        </dl>
        {(canInstall || verifyOnly) && <>
          {!verifyOnly && !selected.allowed && <div role="status"><p className="small">{t("expert_mode_required")}</p>{catalog.recommended_profiles.length > 0 && <button type="button" className="sek" disabled={busy} onClick={() => state.setDraft(catalog.recommended_profiles.find(item => item.synthesis === draft.synthesis) || catalog.recommended_profiles[0])}>{t("expert_use_recommended")}</button>}{onOpenSettings && <button type="button" className="sek" onClick={onOpenSettings}>{t("expert_settings")}</button>}</div>}
          {!metadata && !catalog.expert_mode && !catalog.recommended_profiles.length && <p className="setup-error" role="status">{t("expert_no_recommendation")}</p>}
          {metadata && <p className="small">{t("provider_model_folder")} <code>{catalog.models_dir}</code></p>}
          {yue2 && !selected.verified && <p className="small">{t("yue2_local_import")}</p>}
          {metadata && !yue2 && !manual && missingFiles && <p className="small">{t("provider_download_import_hint", t("provider_refresh_files"), t(verifyLabel))}</p>}
          {metadata && missingFiles && <button type="button" className="sek" disabled={busy || disabled || state.catalog.isFetching} onClick={() => void state.catalog.refetch()}>{t("provider_refresh_files")}</button>}
          {!verifyOnly && selected.allowed && !selected.compatible && <p className="setup-error">{t("picker_low_ram")}</p>}
          {spaceLow && <p className="setup-error">{t("browser_space_low")}</p>}
          <div className="model-download-actions">{downloadBusy && <button type="button" className="sek" disabled={state.cancel.isPending} onClick={() => state.cancel.mutate()}>{t(manual ? "provider_cancel_verification" : "picker_cancel_download")}</button>}<button type="button" className="aktion" disabled={blocked} onClick={() => state.apply(verifyOnly)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5" /></svg>{t(actionLabel)}{!manual && selected.download > 0 && <span className="model-action-size" aria-hidden="true">{bytes(selected.download)}</span>}</button></div>
          <ModelDownloadProgress busy={downloadBusy} message={state.message === "picker_selected" || state.message === "provider_import_verified" ? t(state.message) : state.message} />
          {failure && <p className="setup-error" role="alert">{modelErrorText(failure, t)}</p>}
        </>}
      </section>
      {catalog.expert_mode && !metadata && <section className="title-model-card" aria-labelledby="titleModelHeading">
          <h3 id="titleModelHeading">{t("title_model")}</h3><p className="small">{t("title_model_hint")}</p>
          <p className="small" role="status">Qwen3 0.6B Q8 · {bytes(catalog.title_model.estimated_bytes)} · {t(catalog.title_model.verified ? "picker_installed" : catalog.title_model.present ? "picker_verify" : "picker_missing")}</p>
          {!catalog.title_model.verified && <button type="button" className="sek" disabled={disabled || busy || catalog.busy || (catalog.free_bytes !== null && !catalog.title_model.present && Math.max(0, catalog.title_model.estimated_bytes - catalog.title_model.partial_bytes) + 64 * 1024 ** 2 > catalog.free_bytes)} onClick={() => state.title.mutate()}>{t(catalog.title_model.present ? "title_model_verify" : "title_model_download")}</button>}
      </section>}
      {metadata && <ModelProfileDetails profile={metadata} bytes={bytes} total={selected.models.reduce((total, file) => total + file.estimated_bytes, 0)} folder={evaluation && !canInstall && !verifyOnly ? catalog.models_dir : undefined} />}
      {selected.models.length > 0 && <ModelProfileFiles selected={selected} />}
      <details className="model-picker-disclosure">
        <summary>{t("desktop_hardware")}</summary>
        <div className="model-hardware-summary">
          <span>{catalog.hardware.gpu} · RAM {bytes(catalog.hardware.ram_bytes)}{catalog.hardware.vram_bytes ? ` · VRAM ${bytes(catalog.hardware.vram_bytes)}` : ""}</span>
          {catalog.hardware.cpu_only && <p className="small">{t("desktop_intel_cpu_hint")}</p>}
          <p className="small">{t("picker_memory_hint")}</p>
          {catalog.expert_mode && !metadata && <>
            <p id="modelFolder" className="small">{catalog.models_dir}</p>
            <div className="model-step-row">
              <span className="small">{selected.steps ? `${t("iterations")}: ${selected.steps}` : ""}</span>
              <button type="button" className="sek" disabled={disabled || busy || loadingSteps || !selected.allowed || !selected.valid || !onRecommendedSteps} onClick={() => void recommendedSteps()}>{t("picker_steps")}</button>
            </div>
            <p className="small">{t("picker_sampling_hint")}</p>
          </>}
        </div>
      </details>
    </ModelBrowser>}
    {failure && (!catalog || !draft || !selected) && <p className="setup-error" role="alert">{modelErrorText(failure, t)}</p>}
  </section>;
}
