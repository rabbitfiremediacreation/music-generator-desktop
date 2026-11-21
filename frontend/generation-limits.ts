import type { ModelAbilities } from "./types";

export const MAX_INFERENCE_STEPS = 200;
export const LEGACY_INFERENCE_STEPS_LIMIT = 100;
export const MAX_CLIP_BPM = 300;
export const DEFAULT_CLIP_BPM = "120";
export const MAX_EXTENDED_DURATION = 900;

export const ACE_STEP_ABILITIES: ModelAbilities = {
  min_duration: 10, max_duration: 600, max_variants: 10,
  prompt: true, lyrics: true, lyrics_required: false, instrumental: true,
  bpm: true, advanced: true, analysis: true,
};

export function supportsExtendedDuration(abilities: ModelAbilities): boolean {
  return abilities.output_kind !== "midi" && !abilities.bars?.length && !abilities.reference_audio
    && abilities.min_duration < abilities.max_duration && abilities.max_duration >= 30;
}

export function boundedDuration(duration: number, { min_duration, max_duration }: Pick<ModelAbilities, "min_duration" | "max_duration">): number {
  return Math.max(min_duration, Math.min(max_duration, duration));
}

export function clipSeconds(bars: number, tempo: string): number | undefined {
  const bpm = Number(tempo);
  if (!Number.isInteger(bpm) || bpm < 1 || bpm > MAX_CLIP_BPM) return undefined;
  return 240 * bars / bpm;
}

/** Match the pinned engine's legacy defaults and effective diffusion-step limits. */
export function effectiveInferenceSteps(steps?: number | null, synthesis = ""): number {
  if (steps == null || steps === 0 || !Number.isFinite(steps)) return synthesis.includes("turbo") ? 8 : 50;
  return Math.max(1, Math.min(MAX_INFERENCE_STEPS, Math.trunc(steps)));
}
