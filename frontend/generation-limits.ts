import type { ModelAbilities } from "./types";

export const MAX_INFERENCE_STEPS = 200;
export const LEGACY_INFERENCE_STEPS_LIMIT = 100;

export const ACE_STEP_ABILITIES: ModelAbilities = {
  min_duration: 10, max_duration: 600, max_variants: 10,
  prompt: true, lyrics: true, lyrics_required: false, instrumental: true,
  bpm: true, advanced: true, analysis: true,
};

export function boundedDuration(duration: number, { min_duration, max_duration }: ModelAbilities): number {
  return Math.max(min_duration, Math.min(max_duration, duration));
}

/** Match the pinned engine's legacy defaults and effective diffusion-step limits. */
export function effectiveInferenceSteps(steps?: number | null, synthesis = ""): number {
  if (steps == null || steps === 0 || !Number.isFinite(steps)) return synthesis.includes("turbo") ? 8 : 50;
  return Math.max(1, Math.min(MAX_INFERENCE_STEPS, Math.trunc(steps)));
}
