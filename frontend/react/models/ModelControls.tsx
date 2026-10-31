import { useEffect, useRef, useState } from "react";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { backend } from "../../backend";
import { creatorOptions, profileKey, selectionFromSettings } from "../../creator-models";
import { modelAllowed, modelErrorText, modelLabel } from "../../expert-mode";
import type { ModelSelection } from "../../types";
import { useI18n } from "../i18n";
import { ModelDialog } from "./ModelDialog";
import { invalidateModels } from "./model-state";

export interface ModelControlsProps {
  selection: ModelSelection | null; onSelectionChange: (selection: ModelSelection) => void;
  selectionRevision?: number;
  onManage: () => void; onOpenSettings?: () => void; onRecommendedSteps?: (steps: number) => void; onReady?: () => void;
  open?: boolean; onOpenChange?: (open: boolean) => void;
}

/** A restored song is local intent; delayed settings and activation replies cannot replace it. */
export function ModelControls({ selection, selectionRevision, onSelectionChange, onManage, onOpenSettings, onRecommendedSteps, onReady, open: controlledOpen, onOpenChange }: ModelControlsProps) {
  const { t } = useI18n(), client = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: backend.settings, networkMode: "always", retry: false });
  const [localOpen, setLocalOpen] = useState(false), [error, setError] = useState<unknown>(null), [pending, setPending] = useState<ModelSelection | null>(null);
  const open = controlledOpen ?? localOpen;
  const setOpen = (value: boolean) => { setLocalOpen(value); onOpenChange?.(value); };
  const latest = useRef(selection); latest.current = selection;
  const preserveSongSelection = useRef(false);
  const intent = useRef({ selection, externalRevision: selectionRevision, revision: 0 });
  if (intent.current.selection !== selection || intent.current.externalRevision !== selectionRevision) {
    if (intent.current.externalRevision !== selectionRevision) preserveSongSelection.current = selectionRevision !== undefined;
    intent.current = { selection, externalRevision: selectionRevision, revision: intent.current.revision + 1 };
  }
  const previousDefault = useRef<string | null>(null), initialized = useRef(false);
  const downloadBusy = useIsMutating({ mutationKey: ["models"] }) > 0;
  const activate = useMutation({
    mutationKey: ["models", "activate"], networkMode: "always",
    mutationFn: async ({ next }: { next: ModelSelection; before: number }) => backend.selectModels(next),
    onSuccess: async (selected, { before }) => {
      if (intent.current.revision === before) { preserveSongSelection.current = false; onSelectionChange(selected); setPending(null); setError(null); }
      await invalidateModels(client);
    },
    onError: (failure, { next, before }) => {
      if (intent.current.revision !== before) return;
      setError(failure);
      if (failure instanceof Error && failure.message === "model_setup_required") setPending(next);
    },
  });
  useEffect(() => { setPending(null); setError(null); }, [selection, selectionRevision]);
  useEffect(() => {
    if (!settings.data) return;
    const next = selectionFromSettings(settings.data), key = profileKey(next);
    if (!activate.isPending && (!latest.current || (!preserveSongSelection.current && previousDefault.current && profileKey(latest.current) === previousDefault.current && key !== previousDefault.current))) onSelectionChange(next);
    previousDefault.current = key;
    if (!initialized.current) { initialized.current = true; onReady?.(); }
  }, [settings.data, activate.isPending, onSelectionChange, onReady]);
  useEffect(() => { if (settings.isError && !initialized.current) { initialized.current = true; onReady?.(); } }, [settings.isError, onReady]);
  const recommendations = settings.data?.recommended_profiles || [];
  const chosen = selection || (settings.data ? selectionFromSettings(settings.data) : undefined);
  const allowed = modelAllowed(chosen, settings.data?.expert_mode || false, recommendations);
  const options = creatorOptions(recommendations, chosen, settings.data?.expert_mode || false);
  function choose(value: string) {
    const option = options.find(item => item.value === value && !item.disabled);
    if (!option || downloadBusy) return;
    setError(null);
    activate.mutate({ next: option.selection, before: ++intent.current.revision });
  }
  function openSettings() { setOpen(false); (onOpenSettings || onManage)(); }
  function accept(next: ModelSelection, before: number) {
    if (intent.current.revision === before) { preserveSongSelection.current = false; onSelectionChange(next); setPending(null); setError(null); }
  }
  return <>
    <div className="model-bar">
      <label className="field"><span className="lbl">{t("picker_title")}</span><select id="creatorModel" value={chosen ? profileKey(chosen) : ""} disabled={settings.isPending || downloadBusy || !options.some(option => !option.disabled)} aria-describedby={recommendations.some(profile => profile.synthesis.includes("-xl-")) ? "currentModels" : "currentModels creatorXlRamHint"} onChange={event => choose(event.target.value)}>
        {!options.length && <option value="">{t("expert_no_recommendation")}</option>}{options.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
      </select></label>
      <span id="currentModels" className="small" role="status">{chosen ? `${t("desktop_language_model")}: ${modelLabel(chosen.language, !allowed)}` : ""}</span>
      <button type="button" className="sek" onClick={() => setOpen(true)}>{t("picker_choose")}</button>
    </div>
    {!recommendations.some(profile => profile.synthesis.includes("-xl-")) && <p id="creatorXlRamHint" className="small">{t("creator_xl_ram_hint")}</p>}
    {(error || settings.error) && <div><p className="setup-error" role="alert">{modelErrorText(error || settings.error, t)}</p>{settings.isError && <button type="button" className="sek" onClick={() => void settings.refetch()}>{t("settings_retry")}</button>}<button type="button" className="sek" onClick={openSettings}>{t("expert_settings")}</button></div>}
    {!allowed && <div role="status"><p className="small">{t("expert_mode_required")}</p><button type="button" className="sek" onClick={openSettings}>{t("expert_settings")}</button></div>}
    {open && <ModelDialog selection={pending || chosen || null} currentSelection={chosen || null} selectionRevision={intent.current.revision} onUse={accept} onClose={() => setOpen(false)} onManage={() => { setOpen(false); onManage(); }} onOpenSettings={openSettings} onRecommendedSteps={onRecommendedSteps} />}
  </>;
}
