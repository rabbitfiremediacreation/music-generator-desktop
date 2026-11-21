import { useMemo, useSyncExternalStore } from "react";
import type { StemJob, StemMix } from "../../stems";
import { useI18n } from "../i18n";
import { Waveform } from "./Waveform";
import type { MixerTransport } from "./useStemTransport";

function timecode(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function RegionField({ label, frame, rate, update }: { label: string; frame: number; rate: number; update: (frame: number) => void }) {
  const seconds = Number((frame / rate).toFixed(6));
  return <label className="field">{label}
    <input key={frame} type="number" min={0} step="any" defaultValue={seconds} onBlur={event => {
      const raw = event.target.value.trim();
      const value = Number(raw);
      if (raw && Number.isFinite(value)) update(Math.round(value * rate));
      event.target.value = String(seconds);
    }} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />
  </label>;
}

export function MixerTransportPanel({ job, mix, transport, original, compare, change }: {
  job: StemJob; mix: StemMix; transport: MixerTransport; original: boolean; compare: (original: boolean) => void;
  change: (patch: Partial<StemMix>) => void;
}) {
  const { t } = useI18n();
  const position = useSyncExternalStore(transport.subscribe, transport.getPosition);
  const project = job.project!;
  const { rate, frames } = project;
  const duration = frames / rate;
  const peaks = useMemo(() => {
    const source = job.source.audio;
    const scale = source.peaks.length / Math.max(source.frames, 1);
    return source.peaks.slice(Math.floor(project.source_start_frame * scale), Math.ceil((project.source_start_frame + project.source_frames) * scale));
  }, [job.source.audio, project.source_start_frame, project.source_frames]);
  return <section className="mixer-transport" aria-label={t("stem_time")}>
    <div className="mixer-ticks" aria-hidden="true">{Array.from({ length: 10 }, (_, index) =>
      <span key={index}>{timecode(duration * index / 9)}</span>)}</div>
    <div className="mixer-wave">
      <Waveform peaks={peaks} from={mix.first / frames} to={mix.end / frames} label={t("stem_waveform")} />
      <span className="mixer-playhead" aria-hidden="true" style={{ left: `${Math.max(0, Math.min(100, position.frame * 100 / frames))}%` }} />
      <input type="range" className="mixer-seek" aria-label={t("stem_seek")} aria-valuetext={timecode(position.frame / rate)}
        min={0} max={frames} value={position.frame} disabled={!transport.ready}
        onChange={event => transport.seek(Math.max(mix.first, Math.min(mix.end, Number(event.target.value))))} />
    </div>
    <div className="mixer-transport-actions">
      <div className="mixer-playback">
        <button type="button" className="mixer-play" aria-label={t(position.playing ? "stem_stop" : "stem_play")} title={t(position.playing ? "stem_stop" : "stem_play")}
          disabled={!transport.ready} onClick={() => transport.play(!position.playing)}>{position.playing ? "Ⅱ" : "▶"}</button>
        <button type="button" aria-label={t("stem_transport_stop")} title={t("stem_transport_stop")} disabled={!transport.ready}
          onClick={() => { transport.play(false); transport.seek(mix.first); }}>■</button>
        <button type="button" aria-label={t("stem_loop")} title={t("stem_loop")} aria-pressed={mix.looping}
          onClick={() => change({ looping: !mix.looping })}>↻</button>
        <span className="mixer-time">{timecode(position.frame / rate)} / {timecode(duration)}</span>
      </div>
      <details className="mixer-region"><summary>{t("stem_transport_range")}</summary>
        <div className="stem-row">
          <RegionField label={t("stem_range_start")} frame={mix.first} rate={rate} update={first => change({ first: Math.max(0, Math.min(mix.end - 1, first)) })} />
          <RegionField label={t("stem_range_end")} frame={mix.end} rate={rate} update={end => change({ end: Math.max(mix.first + 1, Math.min(frames, end)) })} />
          <button type="button" className="sek mini" onClick={() => change({ first: 0, end: frames })}>{t("stem_full")}</button>
        </div>
      </details>
      <div className="mixer-monitor" role="group" aria-label={t("stem_comparing")}>
        <button type="button" aria-pressed={original} disabled={!transport.ready || !!transport.missing.original}
          onClick={() => compare(true)}>{t("stem_original")}</button>
        <button type="button" aria-pressed={!original} disabled={!transport.ready || mix.tracks.every(track => transport.missing[track.replacement ?? track.role])}
          onClick={() => compare(false)}>{t("stem_mix")}</button>
      </div>
    </div>
  </section>;
}
