import type { ChannelFx, Track } from "./stems";

export const fxSlots = [0, 1, 2, 3] as const;
export type FxSlot = typeof fxSlots[number];
export type FxSlots<T> = [T, T, T, T];

export function mapFxSlots<T>(create: (slot: FxSlot) => T): FxSlots<T> {
  return [create(0), create(1), create(2), create(3)];
}

export type ReturnEffect =
  | { kind: "off" }
  | { kind: "reverb"; decay_s: number; size: number; damping_hz: number }
  | { kind: "delay"; time_ms: number; feedback: number; damping_hz: number }
  | { kind: "slap_delay"; time_ms: number; spread_ms: number; damping_hz: number }
  | { kind: "chorus"; rate_hz: number; depth_ms: number; stereo: number };
export type EffectKind = ReturnEffect["kind"];
export interface FxReturn {
  effect: ReturnEffect;
  level: number;
  enabled?: boolean;
  mute?: boolean;
  solo?: boolean;
  gain_db?: number;
  gain_off?: boolean;
  fx?: Partial<ChannelFx>;
}

export function returnEnabled(settings: FxReturn) {
  return settings.enabled !== false && settings.effect.kind !== "off";
}

export function returnSoloActive(returns: readonly FxReturn[]) {
  return returns.some(settings => returnEnabled(settings) && settings.solo);
}

/** Convert the original percentage control when a mix has no return fader setting yet. */
export function returnFader({ level, gain_db, gain_off }: FxReturn) {
  return {
    gain_db: gain_db ?? (level > 0 ? 20 * Math.log10(level / 100) : 0),
    gain_off: gain_off === true || (gain_db === undefined && level === 0),
  };
}

export const effectDefaults = {
  off: { kind: "off" },
  reverb: { kind: "reverb", decay_s: 1.8, size: 100, damping_hz: 6200 },
  delay: { kind: "delay", time_ms: 360, feedback: 35, damping_hz: 7800 },
  slap_delay: { kind: "slap_delay", time_ms: 100, spread_ms: 18, damping_hz: 6800 },
  chorus: { kind: "chorus", rate_hz: 0.8, depth_ms: 5, stereo: 75 },
} as const satisfies { [K in EffectKind]: Extract<ReturnEffect, { kind: K }> };

export const defaultFxReturns: Readonly<FxSlots<FxReturn>> = [
  { effect: effectDefaults.reverb, level: 100 },
  { effect: effectDefaults.delay, level: 100 },
  { effect: effectDefaults.slap_delay, level: 100 },
  { effect: effectDefaults.chorus, level: 100 },
];

/** Keep routed effects audible when opening a mix saved without explicit returns. */
export function initialFxReturns(tracks: readonly Track[] = []) {
  return mapFxSlots(slot => ({
    ...defaultFxReturns[slot],
    enabled: tracks.some(track => (track.sends?.[slot] ?? 0) > 0),
  }));
}
