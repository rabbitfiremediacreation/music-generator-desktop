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
import { useModelDialog } from "./useModelDialog";

export interface ModelManagerProps {
  selection: ModelSelection | null; currentSelection: ModelSelection | null;
  selectionRevision: number; onUse: (selection: ModelSelection, before: number) => void;
  onManage?: () => void; onOpenSettings?: () => void; onRecommendedSteps?: (steps: number) => void; disabled?: boolean;
}

export function ModelManager({ selection, currentSelection, selectionRevision, onUse, onManage, onOpenSettings, onRecommendedSteps, disabled = false }: ModelManagerProps) {
  const { t, language } = useI18n();
  const state = useModelDialog(selection, selectionRevision, onUse);
  const { draft, busy } = state;
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
  const planned = catalog && draft && !catalog.providers.some(provider => provider.id === draft.provider && provider.status === "available");
  const existing = catalog && draft && catalog.selection.provider === draft.provider && catalog.selection.synthesis === draft.synthesis && catalog.selection.language === draft.language;
  const spaceLow = !!selected && catalog?.free_bytes !== null && catalog?.free_bytes !== undefined && selected.download > 0 && selected.download + 512 * 1024 ** 2 > catalog.free_bytes;
  const blocked = disabled || !selected || busy || !selected.allowed || !selected.valid || (!selected.compatible && !existing) || spaceLow;
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
  return <section className="model-manager" aria-label={t("picker_title")}>
    {state.catalog.isPending && <p role="status">{t("desktop_checking")}</p>}
    {state.catalog.error && <div><p role="alert" className="setup-error">{modelErrorText(state.catalog.error, t)}</p><button type="button" className="sek" onClick={() => void state.catalog.refetch()}>{t("settings_retry")}</button></div>}
    {catalog && draft && selected && <ModelBrowser catalog={catalog} draft={draft} currentSelection={currentSelection} onChange={state.setDraft} compatibleOnly={compatible} onCompatibleChange={setCompatible} busy={busy || disabled}>
      <section className="model-download-card" aria-label={t("browser_download_options")}>
      <h5>{t("browser_download_options")}</h5>
      <ModelSelectFields catalog={catalog} draft={draft} onChange={state.setDraft} compatibleOnly={compatible} busy={busy || disabled} />
      {!selected.allowed && <div role="status"><p className="small">{t("expert_mode_required")}</p>{catalog.recommended_profiles.length > 0 && <button type="button" className="sek" disabled={busy} onClick={() => state.setDraft(catalog.recommended_profiles.find(item => item.synthesis === draft.synthesis) || catalog.recommended_profiles[0])}>{t("expert_use_recommended")}</button>}{onOpenSettings && <button type="button" className="sek" onClick={onOpenSettings}>{t("expert_settings")}</button>}</div>}
      {!catalog.expert_mode && !catalog.recommended_profiles.length && <p className="setup-error" role="status">{t("expert_no_recommendation")}</p>}
      {!planned && <>
        <dl className="model-requirements"><div><dt>{t("picker_memory")}</dt><dd>{bytes(selected.memory)}</dd></div><div><dt>{t("picker_download")}</dt><dd>{bytes(selected.download)}</dd></div><div><dt>{t("desktop_space")}</dt><dd>{catalog.free_bytes === null ? "—" : bytes(catalog.free_bytes)}</dd></div></dl>
        <p className="small">{t("picker_memory_hint")}</p>
        {selected.allowed && !selected.compatible && <p className="setup-error">{t("picker_low_ram")}</p>}
        {spaceLow && <p className="setup-error">{t("browser_space_low")}</p>}
      </>}
      <div className="model-download-actions">{busy && <button type="button" className="sek" disabled={state.cancel.isPending} onClick={() => state.cancel.mutate()}>{t("picker_cancel_download")}</button>}<button type="button" className="aktion" disabled={blocked} onClick={state.apply}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5" /></svg>{t(selected.verified ? "picker_use" : selected.download ? "picker_download_use" : "picker_verify_use")}{selected.download > 0 && <span className="model-action-size" aria-hidden="true">{bytes(selected.download)}</span>}</button></div>
      <ModelDownloadProgress busy={busy} message={state.message === "picker_selected" ? t(state.message) : state.message} />
      {failure && <p className="setup-error" role="alert">{modelErrorText(failure, t)}</p>}
      </section>
      {!planned && <ModelProfileFiles selected={selected} />}
      {catalog.expert_mode && <>
        <section className="title-model-card" aria-labelledby="titleModelHeading">
          <h3 id="titleModelHeading">{t("title_model")}</h3><p className="small">{t("title_model_hint")}</p>
          <p className="small" role="status">Qwen3 0.6B Q8 · {bytes(catalog.title_model.estimated_bytes)} · {t(catalog.title_model.verified ? "picker_installed" : catalog.title_model.present ? "picker_verify" : "picker_missing")}</p>
          {!catalog.title_model.verified && <button type="button" className="sek" disabled={disabled || busy || catalog.busy || (catalog.free_bytes !== null && !catalog.title_model.present && Math.max(0, catalog.title_model.estimated_bytes - catalog.title_model.partial_bytes) + 64 * 1024 ** 2 > catalog.free_bytes)} onClick={() => state.title.mutate()}>{t(catalog.title_model.present ? "title_model_verify" : "title_model_download")}</button>}
        </section>
        <p id="modelFolder" className="small">{catalog.models_dir}</p>
        <div className="model-step-row"><span className="small">{selected.steps ? `${t("iterations")}: ${selected.steps}` : ""}</span><button type="button" className="sek" disabled={disabled || busy || loadingSteps || !selected.allowed || !selected.valid || !onRecommendedSteps} onClick={() => void recommendedSteps()}>{t("picker_steps")}</button></div>
        <p className="small">{t("picker_sampling_hint")}</p>
      </>}
      <div className="model-hardware-summary"><span>{catalog.hardware.gpu} · RAM {bytes(catalog.hardware.ram_bytes)}{catalog.hardware.vram_bytes ? ` · VRAM ${bytes(catalog.hardware.vram_bytes)}` : ""}</span>{catalog.hardware.cpu_only && <p className="small">{t("desktop_intel_cpu_hint")}</p>}</div>
    </ModelBrowser>}
    {failure && (!catalog || !draft || !selected) && <p className="setup-error" role="alert">{modelErrorText(failure, t)}</p>}
    {onManage && <p className="small" id="modelSetupWizardHint">{t("desktop_manage_hint")}</p>}
    {onManage && <div className="model-picker-actions"><button type="button" className="sek" disabled={busy || disabled} aria-describedby="modelSetupWizardHint" onClick={onManage}>{t("desktop_manage")}</button></div>}
  </section>;
}
