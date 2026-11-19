import { LEGACY_INFERENCE_STEPS_LIMIT, MAX_INFERENCE_STEPS } from "./generation-limits";
import { samplingForSong } from "./song-sampling";
import type { Song } from "./types";

type ResultSong = Pick<Song, "params" | "result_meta"> & Partial<Pick<Song, "status">>;
export interface DurationWarning {
  code: "short_audio" | "long_audio";
  requested_seconds: number;
  actual_seconds: number;
}
const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

/** Locally verified execution wins; an uninitialised old request without a model does not establish its actual steps. */
export function songIterations(song: ResultSong): number | null {
  if (song.params.model_selection && !song.params.model_selection.language) return null;
  const unfinished = song.status !== undefined && song.status !== "done";
  const limit = unfinished || song.result_meta?.inference_steps_limit === MAX_INFERENCE_STEPS ? MAX_INFERENCE_STEPS : LEGACY_INFERENCE_STEPS_LIMIT;
  const verified = song.result_meta?.effective_inference_steps;
  if (positive(verified) && Number.isInteger(verified) && verified <= MAX_INFERENCE_STEPS) return Math.min(verified, limit);
  const requested = song.params.inference_steps;
  if (requested == null || requested === 0) return typeof song.params.model_selection?.synthesis === "string" && song.params.model_selection.synthesis ? samplingForSong(song.params).inference_steps : null;
  return positive(requested) && Number.isInteger(requested) ? Math.min(requested, limit) : null;
}

/** Duration describes the audio only when the backend measured the WAV, never from an LM prediction or request. */
export function songDuration(song: ResultSong): number | null {
  const meta = song.result_meta;
  return meta?.duration_source === "wav" && positive(meta.duration) ? meta.duration : null;
}

export function audioTime(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** The backend owns the material-deviation threshold; validate its warning without creating another policy in the UI. */
export function songDurationWarning(song: ResultSong): DurationWarning | null {
  const value = song.result_meta?.duration_warning;
  if (songDuration(song) === null || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const warning = value as Record<string, unknown>;
  if (!positive(warning.requested_seconds) || !positive(warning.actual_seconds)) return null;
  if (warning.actual_seconds !== songDuration(song)) return null;
  if (warning.code !== "short_audio" && warning.code !== "long_audio") return null;
  if (warning.code === "short_audio" && warning.actual_seconds < warning.requested_seconds || warning.code === "long_audio" && warning.actual_seconds > warning.requested_seconds) return { code: warning.code, actual_seconds: warning.actual_seconds, requested_seconds: warning.requested_seconds };
  return null;
}
