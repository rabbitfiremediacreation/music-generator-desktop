import { samplingForSong } from "../../song-sampling";
import { extractStyleTags } from "../../style-tags";
import type { GenerationFormPreferences, ModelSelection, Song } from "../../types";

export const DEFAULT_PREFERENCES: GenerationFormPreferences = { duration: 90, bpm: 0, inference_steps: 30, lm_temperature: 1.2, variants: 2 };
export const VOCAL_LANGUAGES = ["en", "de", "fr", "es", "it", "pt", "ja", "ko", "zh", "ru"];
export const KEYS = ["C major", "G major", "D major", "A major", "E major", "F major", "A minor", "E minor", "D minor", "C minor"];
export interface FormValues extends GenerationFormPreferences {
  title: string; prompt: string; style: string; lyrics: string; instrumental: boolean;
  vocal_language: string; keyscale: string; timesignature: string; seed: string; generated: boolean;
}
export const INITIAL_VALUES: FormValues = { ...DEFAULT_PREFERENCES, title: "", prompt: "", style: "", lyrics: "", instrumental: true, vocal_language: "en", keyscale: "", timesignature: "", seed: "", generated: false };
export function numericValues(values: FormValues): GenerationFormPreferences {
  return { duration: values.duration, bpm: values.bpm, inference_steps: values.inference_steps, lm_temperature: values.lm_temperature, variants: values.variants };
}
export function songValues(song: Song, selection: ModelSelection | null): FormValues {
  const p = song.params, instrumental = p.lyrics === "[Instrumental]" || p.instrumental === true;
  const sampling = samplingForSong(p, selection ?? undefined);
  return {
    ...INITIAL_VALUES, ...sampling,
    title: song.title || "", style: p.style ?? p.caption ?? "", prompt: p.prompt ?? "",
    instrumental, lyrics: instrumental ? "" : p.lyrics || "",
    duration: Math.min(600, Math.max(10, p.duration || 90)),
    bpm: !p.bpm || p.bpm <= 50 ? 0 : Math.min(200, p.bpm),
    lm_temperature: Math.min(1.5, Math.max(0.3, sampling.lm_temperature)),
    vocal_language: VOCAL_LANGUAGES.includes(p.vocal_language || "") ? p.vocal_language! : "en",
    keyscale: p.keyscale || "", timesignature: ["4", "3", "6", "2"].includes(p.timesignature || "") ? p.timesignature! : "",
    seed: String(p.seed ?? song.seed ?? ""), variants: 1,
  };
}
export function analyzedValues(previous: FormValues, analysis: Record<string, unknown>, microphone: boolean): FormValues {
  const hasVocals = String(analysis.lyrics || "").replace(/\[[^\]]*\]/g, "").trim().length > 0;
  const have = previous.style.split(",").map(value => value.trim()).filter(Boolean), low = new Set(have.map(value => value.toLowerCase()));
  const add = microphone ? [] : extractStyleTags(String(analysis.caption || ""), hasVocals).filter(value => !low.has(value.toLowerCase()));
  const vocal = String(analysis.vocal_language || "").toLowerCase();
  return { ...previous, prompt: String(analysis.prompt ?? analysis.caption ?? ""), generated: false, instrumental: !hasVocals, lyrics: "", style: [...have, ...add].join(", "), bpm: Number(analysis.bpm) || previous.bpm, duration: !microphone && Number(analysis.duration) ? Math.min(600, Math.max(10, Math.round(Number(analysis.duration) / 5) * 5)) : previous.duration, keyscale: String(analysis.keyscale || ""), timesignature: ["4", "3", "6", "2"].includes(String(analysis.timesignature || "")) ? String(analysis.timesignature) : "", vocal_language: hasVocals && VOCAL_LANGUAGES.includes(vocal) ? vocal : previous.vocal_language };
}
