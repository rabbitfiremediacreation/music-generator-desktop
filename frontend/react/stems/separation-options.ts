import type { StemRequest } from "../../stems";

export const goals = ["multitrack", "vocal_pair", "vocals_only", "instrumental_only", "stem_pair"] as const;
export type SeparationGoal = typeof goals[number];

export interface OutputSelection {
  goal: SeparationGoal;
  target?: string;
  selected?: string[];
}

export type InferenceOptions = Pick<StemRequest, "quality" | "overlap" | "shifts" | "no_split" | "segment" | "num_workers" | "transition_power">;

export const defaults: InferenceOptions = { quality: "standard", overlap: .25, shifts: 0, num_workers: 0, transition_power: 1 };

export function outputSelection(native: string[], selection: OutputSelection) {
  const target = native.find(role => role === selection.target) ?? native[0];
  const complement = target === "vocals" ? "instrumental" : `no_${target}`;
  const roles = {
    multitrack: [...native, "residual"],
    stem_pair: target ? [target, complement, "residual"] : [],
    vocal_pair: ["vocals", "instrumental", "residual"],
    vocals_only: ["vocals"],
    instrumental_only: ["instrumental"],
  }[selection.goal];
  const outputs = roles.filter(role => selection.selected?.includes(role) ?? true);
  return { roles, outputs, target };
}

export function validInference(options: InferenceOptions) {
  const { overlap, shifts = 0, segment, transition_power, num_workers = 0 } = options;
  return overlap >= 0 && overlap <= .99 && Number.isInteger(shifts) && shifts >= 0 && shifts <= 10
    && (segment == null || (segment >= 1 && segment <= 7.8)) && (transition_power == null || (transition_power >= 1 && transition_power <= 4))
    && Number.isInteger(num_workers) && num_workers >= 0 && num_workers <= 4;
}

export function maxSingleWindow(options: InferenceOptions) {
  return options.shifts ? 7.3 : 7.8;
}
