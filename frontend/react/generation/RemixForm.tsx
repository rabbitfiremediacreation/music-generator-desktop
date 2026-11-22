import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { backend } from "../../backend";
import { modelErrorText } from "../../expert-mode";
import { randomPrompt, randomStyle } from "../../prompts";
import type { ModelSelection, RemixMode, Song } from "../../types";
import { generationPolicyQuery } from "../data";
import { useI18n } from "../i18n";
import { useGenerationAdmission } from "./admission";
import { DEFAULT_PREFERENCES, isInstrumentalLyrics } from "./form-state";
import { GenerationPromptField, GenerationStyleField, GenerationTitleField } from "./GenerationInputFields";
import { LyricsFields, type LyricValues } from "./LyricsFields";
import { Slider } from "./Slider";

type Source = { name: string; song?: Song; reference?: string };
const sourceTitle = (source?: Source) => source ? `${source.name} (Remix)` : "";

export function RemixForm({ song, selection, folder, blocked }: {
  song?: Song; selection?: ModelSelection; folder: string; blocked: boolean;
}) {
  const { t } = useI18n();
  const admission = useGenerationAdmission();
  const [source, setSource] = useState<Source | undefined>(() => song && ({ name: song.title || song.caption, song }));
  const [title, setTitle] = useState(() => sourceTitle(source));
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("");
  const [generated, setGenerated] = useState(false);
  const [vocal, setVocal] = useState<LyricValues>(() => {
    const lyrics = song?.lyrics ?? "";
    return { lyrics, instrumental: !lyrics.trim() || isInstrumentalLyrics(lyrics), vocal_language: song?.params.vocal_language ?? "" };
  });
  const [lyricsOpen, setLyricsOpen] = useState(() => !!song?.lyrics?.trim());
  const [mode, setMode] = useState<RemixMode>("cover");
  const [steps, setSteps] = useState(DEFAULT_PREFERENCES.inference_steps);
  const [seed, setSeed] = useState("");
  const [picking, setPicking] = useState(false);
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState("");
  const policy = useQuery({ ...generationPolicyQuery(selection ?? null), enabled: !blocked && !!selection, retry: false, networkMode: "always" });
  const busy = blocked || picking || admission.busy;
  const modelReady = policy.isSuccess && policy.data.available !== false;
  const instrumental = vocal.instrumental || !vocal.lyrics.trim() || isInstrumentalLyrics(vocal.lyrics);
  const complete = Boolean(source && selection && modelReady && (prompt.trim() || style.trim()));
  const cpuRisk = Boolean(policy.data && policy.data.backend !== "gpu" && steps >= 30);

  async function pick() {
    setPicking(true);
    setError("");
    try {
      const file = await backend.pickReferenceAudio(t("remix_source"), true);
      if (!file) return;
      const next = { name: file.name, reference: file.id };
      setTitle(current => !current || current === sourceTitle(source) ? sourceTitle(next) : current);
      setSource(next);
      setVocal({ lyrics: "", instrumental: true, vocal_language: "" });
      setLyricsOpen(false);
      setQueued(false);
    } catch (cause) {
      setError(modelErrorText(cause, t));
    } finally {
      setPicking(false);
    }
  }

  async function submit() {
    if (!source || !selection || busy || !complete) return;
    setError("");
    setQueued(false);
    try {
      const result = await admission.start({
        model_selection: selection,
        remix: { mode, source_song_id: source.song?.id },
        reference_audio: source.reference,
        title: title.trim() || sourceTitle(source),
        prompt: prompt.trim(), style: style.trim(), lyrics: instrumental ? "" : vocal.lyrics, instrumental,
        vocal_language: instrumental ? "" : vocal.vocal_language,
        inference_steps: steps, seed: seed === "" ? -1 : Number(seed),
        folder_id: source.song ? source.song.folder_id : folder && folder !== "none" ? folder : null,
      }, undefined, () => setSteps(30));
      if (result) setQueued(true);
    } catch (cause) {
      setError(modelErrorText(cause, t));
    }
  }

  return <form id="remixForm" onSubmit={event => { event.preventDefault(); void submit(); }}
    onKeyDown={event => { if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault(); }}
    aria-busy={picking || admission.busy}>
    <fieldset disabled={busy} className="generation-fields">
      <div className="field">
        <span className="lbl">{t("remix_source_label")}</span>
        <div className="remix-source">
          <button type="button" className="sek" onClick={() => void pick()}>{t("remix_source")}</button>
          {source ? <strong>{source.name}</strong> : <span className="small">{t("remix_pick_hint")}</span>}
        </div>
      </div>
      <GenerationTitleField id="remix-title" diceId="remix-title-dice" value={title} onChange={setTitle} />
      <GenerationPromptField id="remix-prompt" diceId="remix-prompt-dice" label={t("remix_prompt")}
        hint={t("prompt_style_combined_hint")} value={prompt} placeholder={t("prompt_ph")} rows={2}
        required={!style.trim()} generated={generated} onChange={next => { setPrompt(next); setGenerated(false); }}
        onRoll={() => { setPrompt(randomPrompt(instrumental)); setGenerated(true); }} />
      <GenerationStyleField id="remix-style" diceId="remix-style-dice" chipId="remix-tag-chips" label={t("style")}
        hint={t("style_tip")} descriptionId="remix-prompt-hint" value={style} onChange={setStyle}
        onRoll={() => setStyle(randomStyle(instrumental))} />
      <label className="field"><span className="lbl">{t("remix_mode")}</span>
        <select value={mode} onChange={event => setMode(event.target.value === "cover-nofsq" ? "cover-nofsq" : "cover")}>
          <option value="cover">{t("remix_cover")}</option>
          <option value="cover-nofsq">{t("remix_close")}</option>
        </select>
      </label>
      <LyricsFields values={vocal} update={patch => setVocal(current => ({ ...current, ...patch }))}
        open={lyricsOpen} setOpen={setLyricsOpen} idPrefix="remix-" />
      <details>
        <summary>{t("advanced")}</summary>
        <div className="field adv">
          <span className="lbl" title={t("iterations_tip")}>{t("iterations")}</span>
          <Slider name="inference_steps" label={t("iterations")} value={steps} min={1} max={200} risk={cpuRisk} onChange={setSteps} />
        </div>
        <label className="field"><span className="lbl" title={t("seed_tip")}>Seed</span>
          <input name="seed" type="number" min={-1} max={Number.MAX_SAFE_INTEGER} value={seed}
            placeholder={t("seed_ph")} onChange={event => setSeed(event.target.value)} />
        </label>
      </details>
      <div className="genbar">
        {selection && policy.isError && <p className="setup-error" role="alert">{modelErrorText(policy.error, t)}</p>}
        {policy.data?.available === false && <p className="setup-error" role="status">{t(policy.data.unavailable_reason || "provider_unavailable")}</p>}
        <div className="genrow">
          <button type="submit" className="aktion big" disabled={busy || !complete}>{t("remix_submit")}</button>
        </div>
        {error && <p className="setup-error" role="alert">{t("error")} {error}</p>}
        {queued && <p role="status" aria-live="polite">{t("remix_queued")}</p>}
      </div>
    </fieldset>
  </form>;
}
