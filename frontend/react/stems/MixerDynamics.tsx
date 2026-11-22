import {
  brickwallSetting, compressorDefaults, compressorMakeup, compressorMode, compressorRatio, compressorTuning, fetDefaults,
  vcaAttackTimes, vcaDefaults, vcaRatios, vcaReleaseTimes, type CompressorMode, type DynamicsSettings,
} from "../../stems";
import { useI18n } from "../i18n";
import { MixerKnob, type Gesture } from "./MixerControls";

const standardTiming = [
  { key: "attack_ms", caption: "ATTACK", min: .1, max: 200, step: .1, unit: "ms" },
  { key: "release_ms", caption: "RELEASE", min: 10, max: 1000, step: 1, unit: "ms" },
] as const;
const fetTiming = [
  { key: "fet_attack_us", caption: "ATTACK", min: 20, max: 800, step: 10, unit: "µs" },
  { key: "fet_release_ms", caption: "RELEASE", min: 50, max: 1100, step: 1, unit: "ms" },
] as const;
const vcaTiming = [
  { key: "vca_attack_ms", caption: "ATTACK", values: vcaAttackTimes },
  { key: "vca_release_ms", caption: "RELEASE", values: vcaReleaseTimes },
] as const;
const standardRatios: readonly number[] = [1, 1.2, 1.5, 2, 3, 4, 6, 8, 10, 12, 20];
const fetRatios: readonly number[] = [4, 8, 12, 20];
const defaults = { ...compressorDefaults, ...fetDefaults };
const modes = [
  { id: "optical", caption: "Optical" }, { id: "fet", caption: "FET" }, { id: "vca", caption: "VCA" },
] as const;

export function MixerDynamics({ name, amount, legacyLimit, settings, gesture, changeSettings }: {
  name: string; amount: number; legacyLimit: number; settings?: DynamicsSettings; gesture: Gesture;
  changeSettings: (settings: DynamicsSettings) => void;
}) {
  const { t } = useI18n();
  const tuning = compressorTuning(amount, settings);
  const brickwall = brickwallSetting(settings);
  const legacyLimited = brickwall === undefined && (settings?.limiter ?? legacyLimit > 0);
  const limiting = brickwall === true || legacyLimited;
  const mode = compressorMode(settings);
  const fet = mode === "fet";
  const vca = mode === "vca";
  const autoGain = settings?.auto_gain === true;
  const ratios = vca ? vcaRatios : fet ? fetRatios : standardRatios;
  const ratio = compressorRatio(tuning.ratio, settings);
  const defaultRatio = vca ? vcaDefaults.vca_ratio : fet ? fetDefaults.fet_ratio : compressorDefaults.ratio;
  const ratioKey = vca ? "vca_ratio" : fet ? "fet_ratio" : "ratio";
  const ratioIndex = ratios.reduce((closest, value, index) =>
    Math.abs(value - ratio) < Math.abs(ratios[closest] - ratio) ? index : closest, 0);
  const changeTuning = (patch: DynamicsSettings) => changeSettings({ ...settings, ...tuning, ...patch });
  const toggleMode = (next: CompressorMode) => changeSettings({ ...settings, mode: mode === next ? "standard" : next });

  return <div className="mixer-dynamics" role="group" aria-label={`${name} · ${t("stem_dynamics_settings")}`}>
    <MixerKnob caption="THRESH" label={`${name} · Threshold`} value={tuning.threshold_db} min={-60} max={0}
      neutral={compressorDefaults.threshold_db} step={.1} format={value => `${Number(value.toFixed(1))} dB`}
      gesture={gesture} change={threshold_db => changeTuning({ threshold_db })} />
    <MixerKnob caption="RATIO" label={`${name} · Ratio`} value={ratioIndex} min={0} max={ratios.length - 1}
      neutral={ratios.indexOf(defaultRatio)} step={1} stepped
      format={() => `${Number(ratio.toFixed(2))}:1`}
      gesture={gesture} change={index => changeTuning({ [ratioKey]: ratios[index] })} />
    {vca ? vcaTiming.map(({ key, caption, values }) => <MixerKnob key={key} caption={caption} label={`${name} · ${caption}`}
      value={values.indexOf(settings?.[key] ?? vcaDefaults[key])} neutral={values.indexOf(vcaDefaults[key])}
      min={0} max={values.length - 1} step={1} stepped format={index => values[index] === 0 ? "AUTO" : `${values[index]} ms`}
      gesture={gesture} change={index => changeTuning({ [key]: values[index] })} />)
      : (fet ? fetTiming : standardTiming).map(({ key, caption, min, max, step, unit }) => <MixerKnob key={key} caption={caption} label={`${name} · ${caption}`}
      value={settings?.[key] ?? defaults[key]} neutral={defaults[key]} min={min} max={max} step={step}
      format={value => `${Number(value.toFixed(1))} ${unit}`} gesture={gesture}
      change={value => changeTuning({ [key]: value })} />)}
    <MixerKnob caption="MAKEUP" label={`${name} · MAKEUP`} value={compressorMakeup(tuning.threshold_db, ratio, settings)}
      neutral={0} min={-12} max={18} step={.1} disabled={autoGain} title={autoGain ? t("stem_auto_gain_hint") : undefined}
      format={value => `${Number(value.toFixed(1))} dB`} gesture={gesture} change={makeup_db => changeTuning({ makeup_db })} />
    <MixerKnob caption="KNEE" label={`${name} · KNEE`} value={settings?.knee_db ?? defaults.knee_db}
      neutral={defaults.knee_db} min={0} max={24} step={.1} format={value => `${Number(value.toFixed(1))} dB`}
      gesture={gesture} change={knee_db => changeTuning({ knee_db })} />
    <MixerKnob caption="MIX" label={`${name} · COMP MIX`} title={t("stem_comp_hint")}
      value={tuning.mix} neutral={0} min={0} max={100} step={1} format={value => `${Math.round(value)} %`}
      gesture={gesture} change={mix => changeTuning({ mix })} />
    <div className="mixer-dynamics-switches">
      <button type="button" className="sek mixer-dynamics-switch mixer-limiter" aria-pressed={limiting} aria-label={`${name} · Limiter`}
        title={t(legacyLimited ? "stem_legacy_limit_hint" : "stem_limit_hint")}
        onClick={() => changeSettings({ ...settings, brickwall: !limiting })}>{legacyLimited ? "PEAK" : t("stem_limiter_switch")}</button>
      <button type="button" className="sek mixer-dynamics-switch mixer-auto-gain" aria-pressed={autoGain} aria-label={`${name} · Auto Gain`}
        title={t("stem_auto_gain_hint")} onClick={() => changeSettings({ ...settings, auto_gain: !autoGain })}>Auto G</button>
    </div>
    <div className="mixer-dynamics-modes">
      {modes.map(({ id, caption }) => <button type="button" key={id} className={`sek mixer-dynamics-switch mixer-${id}`}
        aria-pressed={mode === id} aria-label={`${name} · ${caption}`} title={t(`stem_${id}_hint`)}
        onClick={() => toggleMode(id)}>{caption}</button>)}
    </div>
  </div>;
}
