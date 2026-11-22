import { effectDefaults, returnFader, type EffectKind, type FxReturn, type FxSlot, type ReturnEffect } from "../../stem-returns";
import { compressorTuning, neutralFx } from "../../stems";
import { useI18n } from "../i18n";
import { MixerFader, MixerKnob, type Gesture } from "./MixerControls";
import { MixerDynamics } from "./MixerDynamics";
import { MixerMeter } from "./MixerMeter";
import { MixerTone } from "./MixerTone";
import type { TransportStore } from "./useStemTransport";

const kinds = ["reverb", "delay", "slap_delay", "chorus"] as const;
type Parameter = {
  key: string; label: string; value: number; min: number; max: number; neutral: number; step: number; unit: string;
};

function parameter(key: string, value: number, min: number, max: number, neutral: number, step: number, unit: string): Parameter {
  return { key, label: `stem_fx_${key}`, value, min, max, neutral, step, unit };
}

function parameters(effect: ReturnEffect): Parameter[] {
  switch (effect.kind) {
    case "reverb": return [
      parameter("decay_s", effect.decay_s, 0.2, 8, effectDefaults.reverb.decay_s, 0.1, "s"),
      parameter("size", effect.size, 40, 150, effectDefaults.reverb.size, 1, "%"),
      parameter("damping_hz", effect.damping_hz, 800, 16000, effectDefaults.reverb.damping_hz, 100, "Hz"),
    ];
    case "delay": return [
      parameter("time_ms", effect.time_ms, 10, 1200, effectDefaults.delay.time_ms, 1, "ms"),
      parameter("feedback", effect.feedback, 0, 90, effectDefaults.delay.feedback, 1, "%"),
      parameter("damping_hz", effect.damping_hz, 800, 16000, effectDefaults.delay.damping_hz, 100, "Hz"),
    ];
    case "slap_delay": return [
      parameter("time_ms", effect.time_ms, 45, 220, effectDefaults.slap_delay.time_ms, 1, "ms"),
      parameter("spread_ms", effect.spread_ms, 0, 60, effectDefaults.slap_delay.spread_ms, 1, "ms"),
      parameter("damping_hz", effect.damping_hz, 800, 16000, effectDefaults.slap_delay.damping_hz, 100, "Hz"),
    ];
    case "chorus": return [
      parameter("rate_hz", effect.rate_hz, 0.1, 5, effectDefaults.chorus.rate_hz, 0.1, "Hz"),
      parameter("depth_ms", effect.depth_ms, 0.5, 12, effectDefaults.chorus.depth_ms, 0.1, "ms"),
      parameter("stereo", effect.stereo, 0, 100, effectDefaults.chorus.stereo, 1, "%"),
    ];
    default: return [];
  }
}

export function MixerEffectReturn({ slot, settings, excluded, rate, store, gesture, change }: {
  slot: FxSlot; settings: FxReturn; rate: number; store: TransportStore; gesture: Gesture;
  change: (settings: FxReturn) => void; excluded: boolean;
}) {
  const { t, language } = useI18n();
  const name = `FX ${slot + 1}`;
  const format = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
  const controls = parameters(settings.effect);
  const fx = { ...neutralFx, ...settings.fx };
  const fader = returnFader(settings);
  const inaudible = settings.mute || excluded;

  return <section className={`mixer-channel mixer-effect-return${inaudible ? " mixer-inaudible" : ""}`}
    data-fx-slot={slot} data-excluded={excluded} aria-label={`${name} · ${t("stem_fx_return")}`}>
    <header className="mixer-strip-header">
      <strong><span className="mixer-channel-name">{name}</span></strong>
    </header>
    <div className="mixer-channel-body">
      <div className="mixer-channel-knobs">
        <select aria-label={`${name} · ${t("stem_fx_type")}`} value={settings.effect.kind}
          onChange={event => change({ ...settings, effect: effectDefaults[event.target.value as EffectKind] })}>
          {kinds.map(kind => <option key={kind} value={kind}>{t(`stem_fx_kind_${kind}`)}</option>)}
        </select>
        <MixerDynamics name={name} amount={fx.comp} legacyLimit={fx.limit} settings={fx.dynamics} gesture={gesture}
          changeSettings={dynamics => change({ ...settings, fx: { ...fx, dynamics } })} />
        <MixerTone name={name} fx={fx} rate={rate} gesture={gesture} change={fx => change({ ...settings, fx })} />
      </div>
      <div className="mixer-master-output">
        <div className="mixer-toggles" title={excluded ? t("stem_solo_excluded") : undefined}>
          <button type="button" className="mixer-mute" aria-pressed={!!settings.mute} aria-label={`${name} · MUTE`}
            onClick={() => change({ ...settings, mute: !settings.mute })}>MUTE</button>
          <button type="button" className="mixer-solo" aria-pressed={!!settings.solo} aria-label={`${name} · SOLO`}
            onClick={() => change({ ...settings, solo: !settings.solo })}>SOLO</button>
        </div>
        {!!controls.length && <div className="mixer-effect-controls">
          {controls.map(({ key, label, unit, ...range }) => <MixerKnob key={key} caption={t(label)} label={`${name} · ${t(label)}`}
            {...range} format={value => `${format.format(value)} ${unit}`} gesture={gesture}
            change={value => change({ ...settings, effect: { ...settings.effect, [key]: value } })} />)}
        </div>}
        <div className="mixer-master-level">
          <MixerFader label={`${name} · ${t("stem_gain")}`} db={Math.max(-60, fader.gain_db)} off={fader.gain_off} gesture={gesture}
            change={(gain_db, gain_off) => change({ ...settings, gain_db, gain_off })} />
          <MixerMeter name={name} store={store} returnSlot={slot} threshold={compressorTuning(fx.comp, fx.dynamics).threshold_db} />
        </div>
      </div>
    </div>
  </section>;
}
