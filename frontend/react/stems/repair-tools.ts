import type { DynamicEqBand, RepairEffect } from "../../stems";

type EffectKind = RepairEffect["kind"];
export type RestorationTool = "spectral" | EffectKind;
export type RepairTool = RestorationTool | "dynamic_eq";
export type { DynamicEqBand };
export { maxEqBands } from "../../stems";

export const repairTools: RepairTool[] = ["spectral", "de_click", "de_crackle", "dynamic_eq"];
export const repairToolLabel = (tool: RepairTool) => tool === "spectral" ? "stem_spectral_repair" : `stem_repair_${tool}`;

export const defaultEqBand: DynamicEqBand = {
  frequency_hz: 2500, threshold_db: -24, reduction_db: 6, q: 1.5,
};

export const defaultRepairEffects: Record<EffectKind, RepairEffect> = {
  de_click: { kind: "de_click", sensitivity: 50 },
  de_crackle: { kind: "de_crackle", sensitivity: 50 },
};

export const dynamicEqFrequency = [40, 18000, 1] as const;
export const dynamicEqBandwidth = [.3, 12, .1] as const;
export const dynamicEqReduction = [1, 24, .1] as const;
export const clampEq = (value: number, [min, max]: readonly [number, number, number]) => Math.max(min, Math.min(max, value));
