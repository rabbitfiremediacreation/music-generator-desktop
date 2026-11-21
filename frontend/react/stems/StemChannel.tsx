import { useId } from "react";
import { neutralFx, stemRole, type ChannelFx, type Track } from "../../stems";
import { useI18n } from "../i18n";
import { filterFrequency } from "./dsp-filters";
import { MixerFader, MixerKnob, type Gesture } from "./MixerControls";
import { MixerMeter } from "./MixerMeter";
import type { TransportStore } from "./useStemTransport";

const icons: Record<string, string> = { drums: "◉", bass: "♫", other: "≋", vocals: "♩", guitar: "♪", piano: "▥", instrumental: "≋" };
export const percent = (value: number) => `${Math.round(value)} %`;
const db = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1)} dB`;

export function StemChannel({ track, index, rate, duration, focused, audible, excluded, error, store, gesture, focus, change, reset, replace, remove }: {
  track: Track; index: number; rate: number; duration: number; focused: boolean; audible: boolean; excluded: boolean; error?: string;
  store: TransportStore; gesture: Gesture; focus: () => void; change: (value: Partial<Track>) => void;
  reset: () => void; replace?: () => void; remove?: () => void;
}) {
  const { t, language } = useI18n();
  const name = track.name === track.role ? stemRole(track.role, t) : track.name;
  const id = useId();
  const fx = { ...neutralFx, ...track.fx };
  const formatFrequency = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
  const setFx = (key: keyof ChannelFx, value: number) => change({ fx: { ...fx, [key]: value } });
  function knob(caption: string, key: keyof ChannelFx, min: number, max: number, neutral: number, format: (v: number) => string, title?: string, marks?: string) {
    return <MixerKnob caption={caption} label={`${name} · ${caption}`} value={fx[key]} min={min} max={max} neutral={neutral}
      step={max === 12 ? .1 : 1} gesture={gesture} format={format} title={title} marks={marks} change={value => setFx(key, value)} />;
  }
  return <section className={`mixer-channel stem-role-${track.role} ${audible ? "" : "mixer-inaudible"}`}
    aria-labelledby={id} data-focused={focused} data-excluded={excluded}>
    <header className="mixer-strip-header">
      <button type="button" id={id} aria-pressed={focused} title={name} onClick={focus}>
        <span className="mixer-channel-no">{String(index + 1).padStart(2, "0")}</span>
        <span className="mixer-channel-icon" aria-hidden="true">{icons[track.role] ?? "≋"}</span>
        <span className="mixer-channel-name">{name}</span>
      </button>
      <details className="mixer-track-menu">
        <summary aria-label={`${name} · ${t("stem_advanced")}`}>⋯</summary>
        <div className="mixer-track-popover">
          <label className="field">{t("stem_track_name")}<input maxLength={80} value={track.name === track.role ? name : track.name}
            onFocus={gesture.begin} onChange={event => change({ name: event.target.value })}
            onBlur={() => { if (!track.name.trim()) change({ name: track.role }); gesture.end(); }} /></label>
          <label className="field">{t("stem_fade_in")}<input type="number" min={0} max={duration} step={.1} value={track.fade_in}
            onFocus={gesture.begin} onBlur={gesture.end} onChange={event => change({ fade_in: Math.max(0, Math.min(duration, Number(event.target.value))) })} /></label>
          <label className="field">{t("stem_fade_out")}<input type="number" min={0} max={duration} step={.1} value={track.fade_out}
            onFocus={gesture.begin} onBlur={gesture.end} onChange={event => change({ fade_out: Math.max(0, Math.min(duration, Number(event.target.value))) })} /></label>
          {replace && <button type="button" className="sek mini" onClick={replace}>{t("stem_replace_track")}</button>}
          {track.replacement && <button type="button" className="sek mini" onClick={() => change({ replacement: undefined })}>{t("stem_restore_track")}</button>}
          {remove && <button type="button" className="sek mini" onClick={remove}>{t("del")}</button>}
          <button type="button" className="sek mini" onClick={reset}>{t("stem_reset_track")}</button>
        </div>
      </details>
    </header>
    <div className="mixer-channel-body">
      <div className="mixer-knob-row mixer-eq">
        {knob("LOW", "low_db", -12, 12, 0, db, "LOW · 100 Hz · Low-Shelf")}
        {knob("MID", "mid_db", -12, 12, 0, db, "MID · 1 kHz · Bell · Q 0.7")}
        {knob("HIGH", "high_db", -12, 12, 0, db, "HIGH · 10 kHz · High-Shelf")}
      </div>
      <div className="mixer-knob-row">
        {knob("COMP", "comp", 0, 100, 0, percent, t("stem_comp_hint"))}
        {knob("LIMIT", "limit", 0, 100, 0, percent, t("stem_limit_hint"))}
      </div>
      <div className="mixer-knob-row">
        {knob("STEREO", "width", 0, 200, 100, percent, t("stem_width_hint"))}
        {knob("FILTER", "filter", -100, 100, 0, value => {
          const cutoff = filterFrequency(value, rate);
          if (cutoff === undefined) return "OFF";
          return `${value < 0 ? "LP" : "HP"} ${formatFrequency.format(cutoff >= 1000 ? cutoff / 1000 : cutoff)} ${cutoff >= 1000 ? "kHz" : "Hz"}`;
        }, t("stem_filter_hint"), "LP — OFF — HP")}
      </div>
      <div className="mixer-knob-row mixer-balance">
        <MixerKnob caption="BALANCE" label={`${name} · BALANCE`} value={track.pan * 100} min={-100} max={100} neutral={0} step={1}
          format={value => value === 0 ? "C" : `${value < 0 ? "L" : "R"} ${Math.round(Math.abs(value))}`} title={t("stem_pan")}
          marks="L — C — R" gesture={gesture} change={value => change({ pan: value / 100 })} />
      </div>
      <div className="mixer-toggles" title={excluded ? t("stem_solo_excluded") : undefined}>
        <button type="button" className="mixer-mute" aria-pressed={track.mute} aria-label={`${name} · MUTE`} onClick={() => change({ mute: !track.mute })}>MUTE</button>
        <button type="button" className="mixer-solo" aria-pressed={track.solo} aria-label={`${name} · SOLO`} onClick={() => change({ solo: !track.solo })}>SOLO</button>
      </div>
      <div className="mixer-level">
        <MixerFader label={`${name} · ${t("stem_gain")}`} db={track.gain_db} off={!!track.gain_off}
          change={(gain_db, gain_off) => change({ gain_db, gain_off })} gesture={gesture} />
        <MixerMeter name={name} index={index} store={store} />
      </div>
      <label className="mixer-export-check" title={t("stem_select_export")}>
        <input type="checkbox" checked={track.export !== false} aria-label={`${name} · ${t("stem_select_export")}`}
          onChange={event => change({ export: event.target.checked })} />
        Export
      </label>
      {error && <p className="mixer-channel-error" role="alert">{error}</p>}
    </div>
  </section>;
}
