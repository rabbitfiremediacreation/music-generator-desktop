import { useId } from "react";
import { compressorTuning, neutralFx, stemRole, type Track } from "../../stems";
import { fxSlots, mapFxSlots, returnEnabled, type FxReturn, type FxSlots } from "../../stem-returns";
import { useI18n } from "../i18n";
import { MixerFader, MixerKnob, type Gesture } from "./MixerControls";
import { MixerMeter } from "./MixerMeter";
import { MixerDynamics } from "./MixerDynamics";
import { MixerTone } from "./MixerTone";
import { repairToolLabel, repairTools, type RepairTool } from "./repair-tools";
import type { TransportStore } from "./useStemTransport";

const icons: Record<string, string> = { drums: "◉", bass: "♫", other: "≋", vocals: "♩", guitar: "♪", piano: "▥", instrumental: "≋" };
const percent = (value: number) => `${Math.round(value)} %`;

export function StemChannel({ track, index, rate, duration, focused, audible, excluded, error, store, gesture, focus, change, reset, replace, repair, canRestore = false, remove, exportable = true, returns }: {
  track: Track; index: number; rate: number; duration: number; focused: boolean; audible: boolean; excluded: boolean; error?: string;
  store: TransportStore; gesture: Gesture; focus: () => void; change: (value: Partial<Track>) => void;
  reset: () => void; replace?: () => void; repair?: (tool: RepairTool, name: string) => void; canRestore?: boolean;
  remove: () => void; exportable?: boolean;
  returns: Readonly<FxSlots<FxReturn>>;
}) {
  const { t } = useI18n();
  const name = track.name === track.role ? stemRole(track.role, t) : track.name;
  const id = useId();
  const fx = { ...neutralFx, ...track.fx };
  const activeSends = fxSlots.filter(slot => returnEnabled(returns[slot]));
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
          {repair && <div className="mixer-track-repair-tools">
            {repairTools.filter(tool => canRestore || tool === "dynamic_eq").map(tool => <button key={tool} type="button" className="sek mini" onClick={event => {
              event.currentTarget.closest("details")?.removeAttribute("open");
              repair(tool, name);
            }}>{t(repairToolLabel(tool))}</button>)}
          </div>}
          {track.replacement && <button type="button" className="sek mini" onClick={() => change({ replacement: undefined })}>{t("stem_restore_track")}</button>}
          <button type="button" className="sek mini" onClick={reset}>{t("stem_reset_track")}</button>
          <button type="button" className="sek mini danger" onClick={remove}>{t("stem_remove_track")}</button>
        </div>
      </details>
    </header>
    <div className="mixer-channel-body">
      <div className="mixer-channel-knobs">
        <MixerDynamics name={name} amount={fx.comp} legacyLimit={fx.limit} settings={fx.dynamics} gesture={gesture}
          changeSettings={dynamics => change({ fx: { ...fx, dynamics } })} />
        <MixerTone name={name} fx={fx} rate={rate} gesture={gesture} change={fx => change({ fx })} extras />
        {activeSends.length > 0 && <div className="mixer-sends" role="group" aria-label={t("stem_fx_sends")}>
          {activeSends.map(slot => {
            const caption = `FX ${slot + 1}`;
            const effect = returns[slot];
            return <MixerKnob key={slot} caption={caption} label={`${name} · ${t("stem_fx_send")} ${caption}`}
              title={`${caption} · ${t(`stem_fx_kind_${effect.effect.kind}`)} · Post-Fader`}
              value={track.sends?.[slot] ?? 0} min={0} max={100} neutral={0} step={1} format={percent} gesture={gesture}
              change={value => change({ sends: mapFxSlots(index => index === slot ? value : track.sends?.[index] ?? 0) })} />;
          })}
        </div>}
      </div>
      <div className="mixer-level">
        <div className="mixer-toggles" title={excluded ? t("stem_solo_excluded") : undefined}>
          <button type="button" className="mixer-mute" aria-pressed={track.mute} aria-label={`${name} · MUTE`} onClick={() => change({ mute: !track.mute })}>MUTE</button>
          <button type="button" className="mixer-solo" aria-pressed={track.solo} aria-label={`${name} · SOLO`} onClick={() => change({ solo: !track.solo })}>SOLO</button>
        </div>
        <div className="mixer-balance">
          <MixerKnob caption="BALANCE" label={`${name} · BALANCE`} value={track.pan * 100} min={-100} max={100} neutral={0} step={1}
            format={value => value === 0 ? "C" : `${value < 0 ? "L" : "R"} ${Math.round(Math.abs(value))}`} title={t("stem_pan")}
            gesture={gesture} change={value => change({ pan: value / 100 })} />
        </div>
        <MixerFader label={`${name} · ${t("stem_gain")}`} db={track.gain_db} off={!!track.gain_off}
          change={(gain_db, gain_off) => change({ gain_db, gain_off })} gesture={gesture} />
        <MixerMeter name={name} index={index} store={store} threshold={compressorTuning(fx.comp, fx.dynamics).threshold_db} />
      </div>
      {exportable && <label className="mixer-export-check" title={t("stem_select_export")}>
        <input type="checkbox" checked={track.export !== false} aria-label={`${name} · ${t("stem_select_export")}`}
          onChange={event => change({ export: event.target.checked })} />
        Export
      </label>}
      {error && <p className="mixer-channel-error" role="alert">{error}</p>}
    </div>
  </section>;
}
