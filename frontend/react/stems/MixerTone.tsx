import type { ChannelFx } from "../../stems";
import { useI18n } from "../i18n";
import { filterFrequency } from "./dsp-filters";
import { MixerKnob, type Gesture } from "./MixerControls";

const percent = (value: number) => `${Math.round(value)} %`;
const db = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1)} dB`;

export function MixerTone({ name, fx, rate, gesture, change, extras = false }: {
  name: string; fx: ChannelFx; rate: number; gesture: Gesture; change: (fx: ChannelFx) => void; extras?: boolean;
}) {
  const { t, language } = useI18n();
  const formatFrequency = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
  function knob(caption: string, key: Exclude<keyof ChannelFx, "dynamics">, min: number, max: number, neutral: number, format: (v: number) => string, title: string) {
    return <MixerKnob caption={caption} label={`${name} · ${caption}`} value={fx[key]} min={min} max={max} neutral={neutral}
      step={max === 12 ? .1 : 1} gesture={gesture} format={format} title={title} change={value => change({ ...fx, [key]: value })} />;
  }
  return <div className="mixer-tone">
    <div className="mixer-tone-stack">
      {knob("HIGH", "high_db", -12, 12, 0, db, "HIGH · 10 kHz · High-Shelf")}
      {knob("MID", "mid_db", -12, 12, 0, db, "MID · 1 kHz · Bell · Q 0.7")}
      {knob("LOW", "low_db", -12, 12, 0, db, "LOW · 100 Hz · Low-Shelf")}
    </div>
    <div className="mixer-tone-stack">
      {knob("FILTER", "filter", -100, 100, 0, value => {
        const cutoff = filterFrequency(value, rate);
        if (cutoff === undefined) return "OFF";
        return `${value < 0 ? "LP" : "HP"} ${formatFrequency.format(cutoff >= 1000 ? cutoff / 1000 : cutoff)} ${cutoff >= 1000 ? "kHz" : "Hz"}`;
      }, t("stem_filter_hint"))}
      {extras && <>
        {knob("STEREO", "width", 0, 200, 100, percent, t("stem_width_hint"))}
        {knob("DE-ESS", "de_ess", 0, 100, 0, percent, t("stem_de_ess_hint"))}
      </>}
    </div>
  </div>;
}
