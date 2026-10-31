import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { randomPrompt, randomStyle, randomTitle, STYLE_TAGS } from "../../prompts";
import { modelErrorText } from "../../expert-mode";
import type { Generation, ModelSelection, Song } from "../../types";
import { healthQuery } from "../data";
import { useI18n } from "../i18n";
import { useGenerationAdmission } from "./admission";
import { analyzedValues, songValues, type FormValues } from "./form-state";
import { useFormValues } from "./useFormValues";
import { Slider } from "./Slider";
import { DiceButton } from "./DiceButton";
import { LyricsFields } from "./LyricsFields";
import { AdvancedFields } from "./AdvancedFields";
import "../../form-preferences-i18n";
import "../../cpu-i18n";

export interface GenerationFormProps {
  selection: ModelSelection | null;
  onSelectionChange?: (selection: ModelSelection) => void;
  settingsBlocked: boolean; modelAllowed?: boolean; folderId?: string | null;
  reuse?: { song: Song; revision: number };
  analysis?: { values: Record<string, unknown>; revision: number; microphone?: boolean };
  recommendedSteps?: { steps: number; revision: number };
  onReady?: () => void;
  onPreferencesFlush?: (flush: () => Promise<void>) => void;
}
export function GenerationForm({ selection, onSelectionChange, settingsBlocked, modelAllowed = true, folderId = null, reuse, analysis, recommendedSteps, onReady, onPreferencesFlush }: GenerationFormProps) {
  const { t } = useI18n(), admission = useGenerationAdmission(), client = useQueryClient();
  const { values, setValues, ready, policy, policyUpdatedAt, failed, flush, reset } = useFormValues(selection);
  const [lyricsOpen, setLyricsOpen] = useState(false), [advancedOpen, setAdvancedOpen] = useState(false);
  const [error, setError] = useState<unknown>(null), [queued, setQueued] = useState<number | null>(null);
  const form = useRef<HTMLFormElement>(null), submitting = useRef(false), hasReady = useRef(false);
  const readyCallback = useRef(onReady); readyCallback.current = onReady;
  const update = useCallback((patch: Partial<FormValues>) => setValues(current => ({ ...current, ...patch })), [setValues]);
  const health = useQuery({ ...healthQuery(client), enabled: false });
  const observed = health.isError ? undefined : health.data?.backend_status;
  const evidence = observed?.state === "running" && observed.synthesis.state === "confirmed" ? observed.synthesis.backend === "cpu" ? "cpu" : ["cuda", "vulkan", "metal"].includes(observed.synthesis.backend) ? "gpu" : undefined : undefined;
  const device = policy?.probed_backend !== undefined && policyUpdatedAt >= health.dataUpdatedAt ? policy.backend : evidence ?? policy?.probed_backend ?? policy?.backend ?? "unknown";
  const risk = device !== "gpu" && values.inference_steps >= 30;
  useEffect(() => { if (ready && !hasReady.current) { hasReady.current = true; readyCallback.current?.(); } }, [ready]);
  useEffect(() => { onPreferencesFlush?.(flush); }, [onPreferencesFlush, flush]);
  const reused = useRef<number | null>(null), analyzed = useRef<number | null>(null), recommended = useRef<number | null>(null);
  useEffect(() => {
    if (!reuse || !ready || reused.current === reuse.revision) return;
    reused.current = reuse.revision;
    if (reuse.song.params.model_selection) onSelectionChange?.(reuse.song.params.model_selection);
    const next = songValues(reuse.song, selection);
    setValues(next); setLyricsOpen(!next.instrumental && Boolean(next.lyrics.trim())); setAdvancedOpen(true);
    form.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [reuse, ready, selection, onSelectionChange, setValues]);
  useEffect(() => {
    if (!analysis || !ready || analyzed.current === analysis.revision) return;
    analyzed.current = analysis.revision;
    setValues(current => analyzedValues(current, analysis.values, Boolean(analysis.microphone)));
    if (String(analysis.values.lyrics || "").replace(/\[[^\]]*\]/g, "").trim()) setLyricsOpen(true);
  }, [analysis, ready, setValues]);
  useEffect(() => {
    if (!recommendedSteps || !ready || recommended.current === recommendedSteps.revision) return;
    recommended.current = recommendedSteps.revision;
    update({ inference_steps: Math.max(1, Math.min(200, recommendedSteps.steps)) });
  }, [recommendedSteps, ready, update]);
  async function submit() {
    if (!ready || settingsBlocked || admission.busy || submitting.current) return;
    if (!modelAllowed) { setError(new Error("expert_mode_required")); return; }
    submitting.current = true; setError(null); setQueued(null);
    const prompt = values.prompt.trim() ? values.prompt : randomPrompt(values.instrumental);
    if (!values.prompt.trim()) update({ prompt, generated: true });
    const request: Generation = { model_selection: selection ?? undefined, folder_id: folderId && folderId !== "none" ? folderId : null, title: values.title, prompt, style: values.style, lyrics: values.instrumental ? "" : values.lyrics, instrumental: values.instrumental, keep_caption: true, duration: values.duration, bpm: values.bpm, inference_steps: values.inference_steps, lm_temperature: values.lm_temperature, keyscale: values.keyscale, timesignature: values.timesignature, vocal_language: values.instrumental ? "" : values.vocal_language, seed: values.seed === "" ? -1 : Number(values.seed), variants: values.variants };
    try { const result = await admission.start(request, undefined, () => update({ inference_steps: 30 })); if (result) setQueued(result.ids.length); }
    catch (cause) { setError(cause); }
    finally { submitting.current = false; }
  }
  useEffect(() => {
    const hotkey = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.code === "KeyG") { event.preventDefault(); if (!settingsBlocked) form.current?.requestSubmit(); }
    };
    document.addEventListener("keydown", hotkey); return () => document.removeEventListener("keydown", hotkey);
  }, [settingsBlocked]);
  const styles = values.style.split(",").map(value => value.trim()).filter(Boolean);
  const displayedError = error === null ? "" : modelErrorText(error, t);
  return <form id="genForm" ref={form} onSubmit={event => { event.preventDefault(); void submit(); }} onKeyDown={event => { if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault(); }} aria-busy={!ready || admission.busy}>
    <fieldset disabled={!ready} className="generation-fields">
      <div className="field"><div className="lblrow"><label className="lbl" htmlFor="generation-title" title={t("title_tip")}>{t("title")}</label><DiceButton id="titleDice" label={t("title_dice")} onClick={() => update({ title: randomTitle() })} /></div><input id="generation-title" name="title" value={values.title} placeholder={t("title_ph")} onChange={event => update({ title: event.target.value })} /></div>
      <div className="field"><div className="lblrow"><div className="prompt-label"><label className="lbl" htmlFor="generation-prompt" title={t("prompt_tip")}>{t("prompt")}</label>{values.generated && <span id="promptGenerated" className="generated-chip" role="status" title={t("prompt_generated")} aria-label={t("prompt_generated")}>GENERATED</span>}</div><DiceButton id="diceBtn" label={t("prompt_dice")} onClick={() => update({ prompt: randomPrompt(values.instrumental), generated: true })} /></div><textarea id="generation-prompt" name="prompt" rows={2} value={values.prompt} placeholder={t("prompt_ph")} onChange={event => update({ prompt: event.target.value, generated: values.generated && event.target.value === values.prompt })} /></div>
      <div className="field"><div className="lblrow"><label className="lbl" htmlFor="generation-style" title={t("style_tip")}>{t("style")}</label><DiceButton id="styleDice" label={t("style_dice")} onClick={() => update({ style: randomStyle(values.instrumental) })} /></div><textarea id="generation-style" name="style" rows={2} value={values.style} onChange={event => update({ style: event.target.value })} /></div>
      <details><summary>{t("styles")}</summary><div className="chips" id="tagChips">{STYLE_TAGS.map(tag => { const active = styles.some(value => value.toLowerCase() === tag.toLowerCase()); return <button type="button" key={tag} className={`chip${active ? " on" : ""}`} aria-pressed={active} onClick={() => update({ style: (active ? styles.filter(value => value.toLowerCase() !== tag.toLowerCase()) : [...styles, tag]).join(", ") })}>{tag}</button>; })}</div></details>
      <input name="instrumental" type="checkbox" hidden checked={values.instrumental} readOnly /><input name="keep_caption" type="checkbox" hidden checked readOnly />
      <div className="field"><span className="lbl">{t("length")}</span><Slider name="duration" label={t("length")} title={t("length_tip")} value={values.duration} min={10} max={600} step={5} format="duration" onChange={duration => update({ duration })} />{values.duration > 300 && <span className="small" id="lenHint" aria-live="polite">{t("len_long")}</span>}</div>
      <div className="field"><span className="lbl" title={t("bpm_tip")}>BPM</span><Slider name="bpm" label="BPM" value={values.bpm} min={50} max={200} format="bpm" onChange={bpm => update({ bpm })} /></div>
      <LyricsFields values={values} update={update} open={lyricsOpen} setOpen={setLyricsOpen} /><AdvancedFields values={values} update={update} risk={risk} open={advancedOpen} setOpen={setAdvancedOpen} />
      <div className="genbar">
        {risk && <p id="cpuGenerationWarning" className="cpu-warning" role="status" aria-live="polite">{t(device === "cpu" ? "cpu_warning" : "cpu_unknown_warning")}</p>}
        <div className="field"><span className="lbl" title={t("versions_tip")}>{t("versions")}</span><div className="genrow"><Slider name="variants" label={t("versions")} value={values.variants} min={1} max={10} onChange={variants => update({ variants })} /><button type="submit" id="genBtn" className="aktion big" disabled={!ready || admission.busy || settingsBlocked || !modelAllowed}>{values.variants > 1 ? t("generate_n", values.variants) : t("generate")}</button></div></div>
        <div className="form-preferences-actions"><button type="button" id="resetGenPreferences" className="sek" onClick={reset}>{t("form_preferences_reset")}</button>{failed && <span id="genPreferencesError" className="small" role="status">{t("form_preferences_error")}</span>}</div>
        {error !== null && <p className="setup-error" role="alert">{t("error")}: {displayedError}</p>}{queued !== null && <p role="status" aria-live="polite">{t("an_queued", queued)}</p>}
      </div>
    </fieldset>
  </form>;
}
