import { useEffect, useState } from "react";
import { sourceDuration, stemApi, stemError, type StemSource } from "../../stems";
import { useI18n } from "../i18n";
import { Waveform } from "./Waveform";

export interface SourceRange { start: number; end: number | null }

function SourcePreview({ source, range, onChange, onRemove, disabled }: {
  source: StemSource; range: SourceRange; onChange: (range: SourceRange) => void; onRemove: () => void; disabled: boolean;
}) {
  const { t } = useI18n();
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const duration = sourceDuration(source);
  useEffect(() => {
    let live = true;
    void stemApi.sourceAudio(source.id).then(value => { if (live) setUrl(value); }, cause => { if (live) setError(stemError(cause, t)); });
    return () => { live = false; };
  }, [source.id, t]);
  return <article className="stem-block">
    <div className="stem-row stem-spread">
      <div><strong>{source.name}</strong><p className="small">{duration.toFixed(2)} s · {source.audio.rate.toLocaleString()} Hz · {source.audio.channels} ch</p></div>
      <button type="button" className="sek mini" disabled={disabled} onClick={onRemove}>{t("del")} · {source.name}</button>
    </div>
    <Waveform peaks={source.audio.peaks} from={range.start / duration} to={(range.end ?? duration) / duration} label={t("stem_waveform")} />
    {url && <audio className="stem-source-player" controls preload="metadata" src={url} aria-label={source.name} />}
    {error && <p role="alert" className="err">{error}</p>}
    <div className="stem-row">
      <label className="field">{t("stem_range_start")}<input type="number" min={0} max={duration} step="any" value={range.start} disabled={disabled}
        onChange={event => onChange({ ...range, start: Number(event.target.value) })} /></label>
      <label className="field">{t("stem_range_end")}<input type="number" min={0} max={duration} step="any" value={range.end ?? duration} disabled={disabled}
        onChange={event => onChange({ ...range, end: Number(event.target.value) })} /></label>
      <button type="button" className="sek" disabled={disabled} onClick={() => onChange({ start: 0, end: null })}>{t("stem_full")}</button>
    </div>
  </article>;
}

export function StemSourcePicker({ sources, ranges, songName, busy, onImport, onDrop, onRemove, onRangeChange }: {
  sources: StemSource[]; ranges: Record<string, SourceRange>; songName?: string; busy: boolean;
  onImport: () => void; onDrop: (files: File[]) => void; onRemove: (id: string) => void; onRangeChange: (id: string, range: SourceRange) => void;
}) {
  const { t } = useI18n();
  const [dragging, setDragging] = useState(false);
  return <>
    {!sources.length && <p>{songName || t("stem_choose_source")}</p>}
    <div className={`stem-drop ${dragging ? "on" : ""}`}
      onDragOver={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } }}
      onDragLeave={() => setDragging(false)}
      onDrop={event => { event.preventDefault(); setDragging(false); if (!busy) onDrop(Array.from(event.dataTransfer.files)); }}>
      <button className="sek" type="button" disabled={busy} onClick={onImport}>{t("stem_import")}</button>
      <span className="small">{t("stem_drop")}</span>
    </div>
    {sources.map(source => <SourcePreview key={source.id} source={source} range={ranges[source.id] ?? { start: 0, end: null }} disabled={busy}
      onChange={range => onRangeChange(source.id, range)} onRemove={() => onRemove(source.id)} />)}
  </>;
}
