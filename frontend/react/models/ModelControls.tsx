import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { backend } from "../../backend";
import { creatorOptions, profileKey, selectionFromSettings } from "../../creator-models";
import { modelAllowed, modelErrorText } from "../../expert-mode";
import { hasModelEngine } from "../../model-options";
import type { ModelSelection } from "../../types";
import { useI18n } from "../i18n";
import { ModelDialog } from "./ModelDialog";
import { ModelPickerBar } from "./ModelPickerBar";
import { invalidateModels } from "./model-state";

export interface ModelControlsProps {
  selection: ModelSelection | null; onSelectionChange: (selection: ModelSelection) => void;
  selectionRevision?: number;
  onManage: () => void; onOpenSettings?: (selection?: ModelSelection | null) => void; onOpenManager?: (selection: ModelSelection | null) => void; onRecommendedSteps?: (steps: number) => void; onReady?: () => void;
  onOpenEngines?: () => void;
  onOpenExpertSettings?: () => void;
  open?: boolean; onOpenChange?: (open: boolean) => void;
}

/** A restored song is local intent; delayed settings and activation replies cannot replace it. */
export function ModelControls({ selection, selectionRevision, onSelectionChange, onManage, onOpenSettings, onOpenManager, onOpenEngines, onOpenExpertSettings, onRecommendedSteps, onReady, open: controlledOpen, onOpenChange }: ModelControlsProps) {
  const { t } = useI18n(), client = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: backend.settings, networkMode: "always", retry: false });
  const catalog = useQuery({ queryKey: ["models", "catalog"], queryFn: backend.modelCatalog, networkMode: "always", retry: false });
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
  const options = catalog.data && settings.data
    ? creatorOptions({ ...catalog.data, recommended_profiles: recommendations, expert_mode: settings.data.expert_mode }, chosen)
    : [];
  const missingEngine = Boolean(catalog.data && chosen && !hasModelEngine(catalog.data, chosen));
  const showXlHint = !missingEngine && chosen?.provider === "ace-step" && !recommendations.some(profile => profile.synthesis.includes("-xl-"));
  const loading = settings.isPending || catalog.isPending;
  const loadError = settings.error || catalog.error;
  function choose(value: string) {
    const option = options.find(item => item.value === value);
    if (!option || loadError || activate.isPending) return;
    setError(null);
    activate.mutate({ next: option.selection, before: ++intent.current.revision });
  }
  function openSettings() { setOpen(false); if (onOpenSettings) onOpenSettings(pending || chosen || null); else onManage(); }
  function openExpertSettings() {
    if (onOpenExpertSettings) { setOpen(false); onOpenExpertSettings(); }
    else openSettings();
  }
  function accept(next: ModelSelection, before: number) {
    if (intent.current.revision === before) { preserveSongSelection.current = false; onSelectionChange(next); setPending(null); setError(null); }
  }
  return <>
    <ModelPickerBar scope="creator" selection={chosen} options={options} loading={loading}
      disabled={!!loadError || activate.isPending} allowed={allowed} hintId={showXlHint ? "creatorXlRamHint" : undefined}
      onChange={choose} onManage={() => onOpenManager ? onOpenManager(pending || chosen || null) : setOpen(true)} />
    {showXlHint && <p id="creatorXlRamHint" className="small">{t("creator_xl_ram_hint")}</p>}
    {(error || loadError) && <div><p className="setup-error" role="alert">{modelErrorText(error || loadError, t)}</p>{loadError && <button type="button" className="sek" onClick={() => { if (settings.isError) void settings.refetch(); if (catalog.isError) void catalog.refetch(); }}>{t("settings_retry")}</button>}<button type="button" className="sek" onClick={error instanceof Error && error.message === "expert_mode_required" ? openExpertSettings : openSettings}>{t("expert_settings")}</button></div>}
    {missingEngine && <div role="status"><p className="small">{t("engine_install_required")}</p>{onOpenEngines && <button type="button" className="sek" onClick={onOpenEngines}>{t("settings_page_engines")}</button>}</div>}
    {!missingEngine && !allowed && <div role="status"><p className="small">{t("expert_mode_required")}</p><button type="button" className="sek" onClick={openExpertSettings}>{t("expert_settings")}</button></div>}
    {open && <ModelDialog selection={pending || chosen || null} currentSelection={chosen || null} selectionRevision={intent.current.revision} onUse={accept} onClose={() => setOpen(false)} onOpenSettings={openExpertSettings} onRecommendedSteps={onRecommendedSteps} />}
  </>;
}
