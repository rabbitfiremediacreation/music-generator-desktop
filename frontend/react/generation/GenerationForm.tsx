import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { randomPrompt, randomStyle, randomTitle, STYLE_TAGS } from "../../prompts";
import { bundledProfile, modelErrorText } from "../../expert-mode";
import { ACE_STEP_ABILITIES, DEFAULT_CLIP_BPM, MAX_CLIP_BPM, MAX_EXTENDED_DURATION, boundedDuration, clipSeconds, supportsExtendedDuration } from "../../generation-limits";
import { profileKey } from "../../creator-models";
import type { Generation, ModelSelection, Song, Yue2Options } from "../../types";
import { Yue2Fields, yue2OptionsError } from "../../yue2/Yue2Fields";
import { yue2ErrorText, yue2Text } from "../../yue2/messages";
import type { ReferenceAudio } from "../audio/useReferenceAudio";
import { healthQuery, queueQuery } from "../data";
import { useI18n } from "../i18n";
import { useGenerationAdmission } from "./admission";
import { analyzedValues, isInstrumentalLyrics, numericValues, songValues, type FormValues } from "./form-state";
import { useFormValues } from "./useFormValues";
import { Slider } from "./Slider";
import { DiceButton } from "./DiceButton";
import { LyricsFields } from "./LyricsFields";
import { AdvancedFields } from "./AdvancedFields";
import { analyzedYue2Style } from "../../style-tags";
import "../../form-preferences-i18n";
import "../../cpu-i18n";

export interface GenerationFormProps {
  selection: ModelSelection | null;
  reference?: ReferenceAudio;
  onSelectionChange?: (selection: ModelSelection) => void;
  settingsBlocked: boolean; modelAllowed?: boolean; folderId?: string | null;
  reuse?: { song: Song; revision: number };
  analysis?: { values: Record<string, unknown>; revision: number; microphone?: boolean };
  recommendedSteps?: { steps: number; revision: number };
  onReady?: () => void;
  onPreferencesFlush?: (flush: () => Promise<void>) => void;
}
export function GenerationForm({ selection, reference, onSelectionChange, settingsBlocked, modelAllowed = true, folderId = null, reuse, analysis, recommendedSteps, onReady, onPreferencesFlush }: GenerationFormProps) {
  const { t, language } = useI18n(), admission = useGenerationAdmission(), client = useQueryClient();
  const { values, setValues, ready, policy, policyUpdatedAt, failed, flush, reset } = useFormValues(selection);
  const [lyricsOpen, setLyricsOpen] = useState(false), [advancedOpen, setAdvancedOpen] = useState(false);
  const [instrumentalChoice, setInstrumentalChoice] = useState(false);
  const [yue2Options, setYue2Options] = useState<Yue2Options>({});
  const [yue2Variants, setYue2Variants] = useState(1);
  const [error, setError] = useState<unknown>(null), [queued, setQueued] = useState<number | null>(null);
  const [profileDurations, setProfileDurations] = useState<Record<string, number>>({});
  const [extendedProfile, setExtendedProfile] = useState<string | null>(null);
  const [profileMeters, setProfileMeters] = useState<Record<string, { bars: number; tempo: string }>>({});
  const queue = useQuery({ ...queueQuery(), enabled: queued !== null, staleTime: 0 });
  const abilities = policy?.capabilities ?? bundledProfile(selection)?.capabilities ?? ACE_STEP_ABILITIES;
  const yue2 = abilities.yue2_options === true;
  const midi = abilities.output_kind === "midi";
  const minimax = selection?.provider === "minimax-music3";
  const fixedProfile = !abilities.advanced || (selection && !selection.language);
  const maxVariants = fixedProfile ? abilities.max_variants : Math.min(10, abilities.max_variants);
  const durationKey = selection ? profileKey(selection) : "";
  const canExtend = supportsExtendedDuration(abilities);
  const extendedDuration = canExtend && extendedProfile === durationKey;
  const durationBounds = { min_duration: abilities.min_duration, max_duration: extendedDuration ? MAX_EXTENDED_DURATION : abilities.max_duration };
  const restoreReference = reference?.restore;
  const barOptions = abilities.bars?.length ? abilities.bars : undefined;
  const promptLabel = t(barOptions ? "clip_description" : minimax ? "minimax_music3_prompt" : "prompt");
  const promptHint = t(midi || barOptions ? "prompt_style_single_hint" : "prompt_style_combined_hint");
  const meter = profileMeters[durationKey];
  const bars = barOptions?.find(count => count === meter?.bars) ?? barOptions?.[0];
  const tempo = meter?.tempo ?? DEFAULT_CLIP_BPM;
  const clipDuration = bars === undefined ? undefined : clipSeconds(bars, tempo);
  const clipTooLong = clipDuration !== undefined && clipDuration > abilities.max_duration;
  const durationLabel = t(abilities.reference_audio ? "mulacover_maximum_duration" : selection?.provider === "magenta-realtime-2" ? "provider_recording_duration" : selection?.provider === "yue2" ? "provider_duration_limit" : "length");
  const instrumental = !abilities.lyrics || (abilities.instrumental && (
    abilities.lyrics_required ? instrumentalChoice : values.instrumental || isInstrumentalLyrics(values.lyrics)
  ));
  const duration = clipDuration ?? boundedDuration(fixedProfile || extendedDuration ? profileDurations[durationKey] ?? values.duration : values.duration, durationBounds);
  const variants = Math.min(yue2 ? yue2Variants : values.variants, maxVariants);
  const updateVariants = (count: number) => yue2 ? setYue2Variants(count) : update({ variants: count });
  const yue2Problem = yue2 ? yue2OptionsError(yue2Options, instrumental) : undefined;
  const available = policy?.available !== false && (!fixedProfile || Boolean(policy?.capabilities));
  const incomplete = ((midi || minimax) && !values.prompt.trim()) || (barOptions && (!values.prompt.trim().replace(/^,+|,+$/g, "").trim() || clipDuration === undefined || clipTooLong)) ||
    (!abilities.prompt && !values.style.split(",").some(tag => tag.trim())) ||
    (abilities.lyrics_required && !instrumental && (!values.lyrics.trim() || isInstrumentalLyrics(values.lyrics))) ||
    (abilities.reference_audio && (!reference?.file || !reference.approved || reference.picking));
  useEffect(() => {
    if (queued !== null && queue.isSuccess && !queue.isFetching && queue.data.queued === 0) setQueued(null);
  }, [queued, queue.isSuccess, queue.isFetching, queue.data]);
  const queuedCount = queued === null ? null : queue.data?.queued ?? queued;
  const form = useRef<HTMLFormElement>(null), submitting = useRef(false), hasReady = useRef(false);
  const readyCallback = useRef(onReady); readyCallback.current = onReady;
  const update = useCallback((patch: Partial<FormValues>) => setValues(current => ({ ...current, ...patch })), [setValues]);
  const health = useQuery({ ...healthQuery(client), enabled: false });
  const observed = health.isError ? undefined : health.data?.backend_status;
  const evidence = observed?.state === "running" && observed.synthesis.state === "confirmed" ? observed.synthesis.backend === "cpu" ? "cpu" : ["cuda", "vulkan", "metal"].includes(observed.synthesis.backend) ? "gpu" : undefined : undefined;
  const device = policy?.probed_backend !== undefined && policyUpdatedAt >= health.dataUpdatedAt ? policy.backend : evidence ?? policy?.probed_backend ?? policy?.backend ?? "unknown";
  const risk = abilities.advanced && device !== "gpu" && values.inference_steps >= 30;
  useEffect(() => { if (ready && !hasReady.current) { hasReady.current = true; readyCallback.current?.(); } }, [ready]);
  useEffect(() => { onPreferencesFlush?.(flush); }, [onPreferencesFlush, flush]);
  const reused = useRef<number | null>(null), analyzed = useRef<number | null>(null), recommended = useRef<number | null>(null);
  useEffect(() => {
    if (!reuse || !ready || reused.current === reuse.revision) return;
    reused.current = reuse.revision;
    const savedProfile = reuse.song.params.model_selection;
    if (savedProfile?.provider === "yue2") {
      setYue2Options(reuse.song.params.yue2 ?? {});
      setYue2Variants(reuse.song.params.variants ?? 1);
    }
    const savedReference = reuse.song.params.reference_audio;
    const savedExtended = Boolean(reuse.song.params.ignore_recommended_duration && savedProfile);
    setExtendedProfile(savedExtended && savedProfile ? profileKey(savedProfile) : null);
    restoreReference?.(savedProfile, savedReference);
    if (savedProfile) onSelectionChange?.(savedProfile);
    const next = songValues(reuse.song, selection);
    if (savedProfile && (savedExtended || !savedProfile.language || reuse.song.params.bars !== undefined || reuse.song.output_kind === "midi")) {
      const { bars, bpm, duration } = reuse.song.params;
      const key = profileKey(savedProfile);
      if (bars !== undefined && bpm !== undefined) {
        setProfileMeters(current => ({ ...current, [key]: { bars, tempo: String(bpm) } }));
      } else if (duration && reuse.song.output_kind !== "midi") {
        setProfileDurations(current => ({ ...current, [key]: duration }));
      }
      setValues(current => ({ ...next, ...numericValues(current) }));
    } else setValues(next);
    setInstrumentalChoice(next.instrumental);
    setLyricsOpen(!next.instrumental && Boolean(next.lyrics.trim())); setAdvancedOpen(true);
    form.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [reuse, ready, selection, onSelectionChange, setValues, restoreReference]);
  useEffect(() => {
    if (!analysis || !ready || analyzed.current === analysis.revision) return;
    analyzed.current = analysis.revision;
    if (selection?.provider === "yue2") {
      setValues(current => ({ ...current, style: analyzedYue2Style(current.style, analysis.values) }));
      return;
    }
    if (!abilities.analysis) return;
    setValues(current => analyzedValues(current, analysis.values, Boolean(analysis.microphone)));
    if (String(analysis.values.lyrics || "").replace(/\[[^\]]*\]/g, "").trim()) setLyricsOpen(true);
  }, [abilities.analysis, analysis, ready, selection?.provider, setValues]);
  useEffect(() => {
    if (!recommendedSteps || !ready || recommended.current === recommendedSteps.revision) return;
    recommended.current = recommendedSteps.revision;
    update({ inference_steps: Math.max(1, Math.min(200, recommendedSteps.steps)) });
  }, [recommendedSteps, ready, update]);
  function changeDuration(duration: number) {
    if (fixedProfile || extendedDuration) setProfileDurations(current => ({ ...current, [durationKey]: duration }));
    else update({ duration });
  }
  function changeMeter(bars: number, tempo: string) {
    setProfileMeters(current => ({ ...current, [durationKey]: { bars, tempo } }));
  }
  async function submit() {
    if (!ready || !available || incomplete || yue2Problem || settingsBlocked || admission.busy || submitting.current) return;
    if (!modelAllowed) { setError(new Error("expert_mode_required")); return; }
    submitting.current = true; setError(null); setQueued(null);
    const request: Generation = {
      model_selection: selection ?? undefined, folder_id: folderId && folderId !== "none" ? folderId : null,
      title: values.title, instrumental: abilities.instrumental && instrumental,
      keep_caption: true, seed: values.seed === "" ? -1 : Number(values.seed), variants,
    };
    if (abilities.reference_audio && reference?.file) request.reference_audio = reference.file.id;
    if (yue2 && Object.values(yue2Options).some(value => value !== undefined)) request.yue2 = yue2Options;
    if (!midi) Object.assign(request, { lyrics: instrumental ? "" : values.lyrics, duration });
    if (extendedDuration) request.ignore_recommended_duration = true;
    if (abilities.prompt) {
      request.prompt = midi ? values.prompt.trim() : values.prompt;
      if (!midi && !barOptions && !minimax && !values.prompt.trim()) {
        request.prompt = randomPrompt(instrumental);
        update({ prompt: request.prompt, generated: true });
      }
    }
    if (bars !== undefined) {
      request.bars = bars;
      request.bpm = Number(tempo);
    } else if (!midi) {
      request.style = values.style;
      if (abilities.bpm) request.bpm = values.bpm;
    }
    if (abilities.advanced) Object.assign(request, {
      inference_steps: values.inference_steps, lm_temperature: values.lm_temperature, keyscale: values.keyscale,
      timesignature: values.timesignature, vocal_language: instrumental ? "" : values.vocal_language,
    });
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
  const errorText = error instanceof Error ? error.message : String(error);
  const displayedError = errorText.startsWith("mulacover_reference_") ? t(errorText) : errorText.startsWith("yue2_") ? yue2ErrorText(errorText, language) : modelErrorText(error, t);
  const styleLabel = abilities.style_description ? "provider_style_description" : abilities.prompt || abilities.reference_audio ? "style" : "provider_style_tags";
  const styleHint = abilities.style_description ? "provider_style_description_hint" : abilities.reference_audio ? "mulacover_style_hint" : abilities.prompt ? "style_tip" : "provider_style_hint";
  return <form id="genForm" ref={form} onSubmit={event => { event.preventDefault(); void submit(); }} onKeyDown={event => { if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault(); }} aria-busy={!ready || admission.busy}>
    <fieldset disabled={!ready} className="generation-fields">
      {midi && <h3 className="col-title">{t("midi_mode")}</h3>}
      {minimax && <strong>MiniMax-Music3</strong>}
      <div className="field"><div className="lblrow"><label className="lbl" htmlFor="generation-title" title={t("title_tip")}>{t("title")}</label><DiceButton id="titleDice" label={t("title_dice")} onClick={() => update({ title: randomTitle() })} /></div><input id="generation-title" name="title" value={values.title} placeholder={t("title_ph")} onChange={event => update({ title: event.target.value })} /></div>
      {abilities.prompt && <div className="field">
        <div className="lblrow">
          <div className="prompt-label">
            <label className="lbl" htmlFor="generation-prompt" title={midi || minimax || barOptions ? undefined : t("prompt_tip")}>{promptLabel}</label>
            {!midi && !minimax && !barOptions && values.generated && <span id="promptGenerated" className="generated-chip" role="status" title={t("prompt_generated")} aria-label={t("prompt_generated")}>GENERATED</span>}
          </div>
          {!midi && !minimax && !barOptions && <DiceButton id="diceBtn" label={t("prompt_dice")} onClick={() => update({ prompt: randomPrompt(instrumental), generated: true })} />}
        </div>
        <textarea id="generation-prompt" name="prompt" rows={midi || minimax ? 3 : 2} required={midi || minimax || Boolean(barOptions)}
          aria-describedby="generation-prompt-hint" value={values.prompt}
          placeholder={t(barOptions ? "clip_description_example" : minimax ? "minimax_music3_prompt_placeholder" : midi ? "midi_prompt_placeholder" : "prompt_ph")}
          onChange={event => update({ prompt: event.target.value, generated: values.generated && event.target.value === values.prompt })} />
        <span className="small" id="generation-prompt-hint">{promptHint}{midi && ` ${t("midi_prompt_hint")}`}</span>
      </div>}
      {!midi && !barOptions && <>
        <div className="field">
          <div className="lblrow"><label className="lbl" htmlFor="generation-style" title={t(styleHint)}>{t(styleLabel)}</label>{!abilities.reference_audio && <DiceButton id="styleDice" label={t("style_dice")} onClick={() => update({ style: randomStyle(instrumental) })} />}</div>
          <textarea id="generation-style" name="style" required={!abilities.prompt} rows={2}
            aria-describedby={abilities.prompt ? "generation-prompt-hint" : "generation-style-hint"}
            value={values.style} onChange={event => update({ style: event.target.value })} />
          {!abilities.prompt && <span className="small" id="generation-style-hint">{t(styleHint)}</span>}
          {!abilities.reference_audio && <details className="style-suggestions">
            <summary>{t("styles")}</summary>
            <div className="chips" id="tagChips">{STYLE_TAGS.map(tag => {
              const active = styles.some(value => value.toLowerCase() === tag.toLowerCase());
              return <button type="button" key={tag} className={`chip${active ? " on" : ""}`} aria-pressed={active} onClick={() => update({ style: (active ? styles.filter(value => value.toLowerCase() !== tag.toLowerCase()) : [...styles, tag]).join(", ") })}>{tag}</button>;
            })}</div>
          </details>}
        </div>
      </>}
      <input name="instrumental" type="checkbox" hidden checked={instrumental} readOnly /><input name="keep_caption" type="checkbox" hidden checked readOnly />
      {barOptions && bars !== undefined ? <>
        <div className="clip-meter">
          <label className="field">
            <span className="lbl">{t("clip_bars")}</span>
            <select name="bars" value={bars} onChange={event => changeMeter(Number(event.target.value), tempo)}>
              {barOptions.map(count => <option key={count}>{count}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="lbl">BPM</span>
            <input name="bpm" type="number" min={1} max={MAX_CLIP_BPM} required value={tempo} onChange={event => changeMeter(bars, event.target.value)} />
          </label>
        </div>
        <output className="small" aria-live="polite">
          {clipDuration !== undefined && t("clip_length", clipDuration.toLocaleString(language, { maximumFractionDigits: 3 }))}
          {clipTooLong && <span className="setup-error"> {t("clip_too_long", abilities.max_duration)}</span>}
        </output>
      </> : !midi && <>
        <div className="field"><span className="lbl">{durationLabel}</span>
          {abilities.min_duration === abilities.max_duration
            ? <span>{t("provider_duration_hint", duration, duration)}</span>
            : <Slider name="duration" label={durationLabel} title={extendedDuration ? t("provider_duration_hint", durationBounds.min_duration, durationBounds.max_duration) : minimax ? t("minimax_music3_duration_hint") : abilities.advanced ? t("length_tip") : t("provider_duration_hint", abilities.min_duration, abilities.max_duration)} value={duration} min={durationBounds.min_duration} max={durationBounds.max_duration} step={abilities.advanced ? 5 : 1} format="duration" onChange={changeDuration} />}
          {canExtend && <label className="duration-override">
            <input className="sr-only" type="checkbox" role="switch" checked={extendedDuration} aria-describedby={extendedDuration ? "extended-duration-hint" : undefined}
              onChange={event => setExtendedProfile(event.target.checked ? durationKey : null)} />
            <span className="duration-switch" aria-hidden="true" />
            {t("ignore_recommended_duration")}
          </label>}
          {extendedDuration && <span className="small" id="extended-duration-hint">{t("extended_duration_hint")}</span>}
          {duration > 300 && <span className="small" id="lenHint" aria-live="polite">{t("len_long")}</span>}
        </div>
        {abilities.bpm && <div className="field"><span className="lbl" title={t("bpm_tip")}>BPM</span><Slider name="bpm" label="BPM" value={values.bpm} min={50} max={200} format="bpm" onChange={bpm => update({ bpm })} /></div>}
      </>}
      {abilities.lyrics_required && abilities.instrumental && <label className="check check-row">
        <input name="instrumental_mode" type="checkbox" checked={instrumental} onChange={event => setInstrumentalChoice(event.target.checked)} />
        {t("instrumental")}
      </label>}
      {abilities.lyrics && !(abilities.lyrics_required && instrumental) && <LyricsFields values={values} update={update} open={lyricsOpen} setOpen={setLyricsOpen} required={abilities.lyrics_required} />}
      {abilities.advanced ? <AdvancedFields values={values} update={update} risk={risk} open={advancedOpen} setOpen={setAdvancedOpen} /> :
        <label className="field"><span className="lbl">{yue2 ? yue2Text(language).acousticSeed : "Seed"}</span><input name="seed" type="number" min={-1} max={abilities.max_seed ?? Number.MAX_SAFE_INTEGER} placeholder={t("seed_ph")} value={values.seed} onChange={event => update({ seed: event.target.value })} /></label>}
      {yue2 && <Yue2Fields options={yue2Options} onChange={setYue2Options} language={language} />}
      <div className="genbar">
        {risk && <p id="cpuGenerationWarning" className="cpu-warning" role="status" aria-live="polite">{t(device === "cpu" ? "cpu_warning" : "cpu_unknown_warning")}</p>}
        {ready && !available && <p className="setup-error" role="status">{t(policy?.unavailable_reason || "provider_unavailable")}</p>}
        {yue2Problem && <p className="setup-error" role="status">{yue2ErrorText(yue2Problem, language)}</p>}
        <div className="field">{maxVariants > 1 && <span className="lbl" title={t("versions_tip")}>{t("versions")}</span>}<div className="genrow">{maxVariants > 1 && <Slider name="variants" label={t("versions")} value={variants} min={1} max={maxVariants} onChange={updateVariants} />}<button type="submit" id="genBtn" className="aktion big" disabled={!ready || !available || incomplete || Boolean(yue2Problem) || admission.busy || settingsBlocked || !modelAllowed}>{midi ? t("midi_generate") : variants > 1 ? t("generate_n", variants) : t("generate")}</button></div></div>
        {!fixedProfile && <div className="form-preferences-actions"><button type="button" id="resetGenPreferences" className="sek" onClick={reset}>{t("form_preferences_reset")}</button>{failed && <span id="genPreferencesError" className="small" role="status">{t("form_preferences_error")}</span>}</div>}
        {error !== null && <p className="setup-error" role="alert">{t("error")}: {displayedError}</p>}{queuedCount !== null && queuedCount > 0 && <p role="status" aria-live="polite">{t("an_queued", queuedCount)}</p>}
      </div>
    </fieldset>
  </form>;
}
