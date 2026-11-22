import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { stemApi, stemError, type RepairEffect, type RepairSelection, type SpectralSelection, type StemSpectrogram } from "../../stems";
import { useI18n } from "../i18n";
import { Dialog } from "../ui";
import { RepairEffectFields, validRepairEffect } from "./RepairEffectFields";
import { defaultRepairEffects, repairToolLabel, type RestorationTool } from "./repair-tools";
import { SpectralAudition } from "./SpectralAudition";
import { SpectralFindings } from "./SpectralFindings";
import "./spectral-repair.css";

type Point = { x: number; y: number };
type Bounds = { from: string; to: string; low: string; high: string };
const emptyBounds: Bounds = { from: "", to: "", low: "", high: "" };
const windows = [2, 8, 20];
const formatSeconds = (frames: number, rate: number) => (frames / rate).toFixed(3);
const selectionSeconds = (frames: number, rate: number) => (frames / rate).toFixed(5);
const timeBounds = (first: number, end: number, rate: number) => ({
  ...emptyBounds, from: selectionSeconds(first, rate), to: selectionSeconds(end, rate),
});

function frequencyAt(image: StemSpectrogram, y: number) {
  return image.max_hz * (image.min_hz / image.max_hz) ** y;
}

function frequencyPosition(image: StemSpectrogram, hz: number) {
  return Math.log(hz / image.max_hz) / Math.log(image.min_hz / image.max_hz);
}

function point(event: PointerEvent<HTMLDivElement>): Point {
  const rect = event.currentTarget.getBoundingClientRect();
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
}

function SpectralCanvas({ image, label }: { image: StemSpectrogram; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    const pixels = context.createImageData(image.width, image.height);
    image.levels.forEach((level, index) => {
      const amount = level / 255;
      const bright = amount ** 2;
      pixels.data.set([12 + 228 * bright, 19 + 204 * amount, 24 + 143 * amount - 96 * bright, 255], index * 4);
    });
    context.putImageData(pixels, 0, 0);
  }, [image]);
  return <canvas ref={canvas} width={image.width} height={image.height} role="img" aria-label={label} />;
}

export function SpectralRepair({ id, role, tool, name, frame, frames, rate, onApply, onClose }: {
  id: string; role: string; tool: RestorationTool; name: string; frame: number; frames: number; rate: number;
  onApply: (role: string) => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const initialWidth = Math.min(frames, 8 * rate);
  const initialStart = Math.max(0, Math.min(frames - initialWidth, Math.round(frame) - rate * 2));
  const [duration, setDuration] = useState(8);
  const [start, setStart] = useState(initialStart);
  const [bounds, setBounds] = useState(() => tool === "spectral" ? emptyBounds : timeBounds(initialStart, initialStart + initialWidth, rate));
  const [effect, setEffect] = useState<RepairEffect | undefined>(() => tool === "spectral" ? undefined : defaultRepairEffects[tool]);
  const [wholeTrack, setWholeTrack] = useState(false);
  const [db, setDb] = useState("12");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [scanRequested, setScanRequested] = useState(false);
  const [selectedFinding, setSelectedFinding] = useState<number>();
  const anchor = useRef<Point>(null);
  const width = Math.min(frames, duration * rate);
  const first = Math.max(0, Math.min(start, frames - width));
  const end = first + width;
  const preview = useQuery({
    queryKey: ["stem-spectral-preview", id, role, first, end],
    queryFn: () => stemApi.spectralPreview(id, role, first, end), networkMode: "always", retry: false, staleTime: Infinity,
  });
  const scan = useQuery({
    queryKey: ["stem-spectral-scan", id, role], queryFn: () => stemApi.scanSpectrum(id, role),
    enabled: scanRequested, networkMode: "always", retry: false, staleTime: Infinity,
  });
  const image = preview.data;
  const spectral: SpectralSelection = {
    first: Math.round(parseFloat(bounds.from) * rate), end: Math.round(parseFloat(bounds.to) * rate),
    low_hz: parseFloat(bounds.low), high_hz: parseFloat(bounds.high), reduction_db: parseFloat(db),
  };
  const validTime = spectral.first >= first && spectral.end <= end && spectral.end - spectral.first >= 3;
  const validBand = image && spectral.low_hz >= image.min_hz && spectral.high_hz <= image.max_hz
    && spectral.high_hz - spectral.low_hz >= image.bin_hz;
  const valid = (validTime || wholeTrack) && (effect ? validRepairEffect(effect) : validBand && spectral.reduction_db >= 1 && spectral.reduction_db <= 36);
  const scope = { first: validTime ? spectral.first : first, end: validTime ? spectral.end : end,
    ...(wholeTrack ? { whole_track: true } : {}) };
  const selection: RepairSelection = effect ? { ...scope, effect } : { ...spectral, ...scope };
  const audition = valid && !working ? selection : undefined;

  function setWindow(next: number, length: number) {
    const size = Math.min(frames, length * rate);
    const offset = Math.max(0, Math.min(next, frames - size));
    setStart(offset);
    setDuration(length);
    setSelectedFinding(undefined);
    const nextBounds = timeBounds(offset, offset + size, rate);
    setBounds(current => effect ? nextBounds : wholeTrack
      ? { ...current, from: nextBounds.from, to: nextBounds.to } : emptyBounds);
  }

  function mark(a: Point, b: Point) {
    if (!image) return;
    const secondsAt = (x: number) => selectionSeconds(first + Math.round(x * width), rate);
    setBounds({
      from: secondsAt(Math.min(a.x, b.x)), to: secondsAt(Math.max(a.x, b.x)),
      low: effect ? bounds.low : String(Math.round(frequencyAt(image, Math.max(a.y, b.y)))),
      high: effect ? bounds.high : String(Math.round(frequencyAt(image, Math.min(a.y, b.y)))),
    });
  }

  function selectFinding(index: number) {
    const suggested = scan.data?.[index];
    if (!suggested) return;
    setSelectedFinding(index);
    if (suggested.first < first || suggested.end > end) {
      setStart(Math.round((suggested.first + suggested.end - width) / 2));
    }
    setBounds({
      from: selectionSeconds(suggested.first, rate), to: selectionSeconds(suggested.end, rate),
      low: String(suggested.low_hz), high: String(suggested.high_hz),
    });
    setDb(String(suggested.reduction_db));
  }

  async function apply() {
    if (!valid || working) return;
    setError("");
    setWorking(true);
    try {
      const replacement = await stemApi.repairSpectrum(id, role, selection);
      onApply(replacement.role);
    } catch (cause) {
      setError(stemError(cause, t));
      setWorking(false);
    }
  }

  const title = t(repairToolLabel(tool));
  return <Dialog open title={title} onClose={onClose} busy={working} className="spectral-repair">
    <div className="spectral-heading"><h3>{title}</h3><span>{name}</span></div>
    <p className="small">{t(wholeTrack ? "stem_repair_whole_hint" : effect ? "stem_repair_time_hint" : "stem_spectral_hint")}</p>
    <div className="spectral-view-controls">
      <label className="field">{t("stem_repair_scope")}
        <select value={wholeTrack ? "whole" : "selection"} disabled={working}
          onChange={event => setWholeTrack(event.target.value === "whole")}>
          <option value="selection">{t("stem_repair_scope_selection")}</option>
          <option value="whole">{t("stem_repair_scope_whole")}</option>
        </select>
      </label>
      <label className="field">{t("stem_spectral_view")}
        <input key={first} type="number" min={0} max={(frames - width) / rate} step={.001}
          disabled={working} defaultValue={formatSeconds(first, rate)} onKeyDown={event => {
            if (event.key === "Enter") event.currentTarget.blur();
          }} onBlur={event => {
            const input = event.currentTarget;
            const next = Number.isFinite(input.valueAsNumber)
              ? Math.max(0, Math.min(frames - width, Math.round(input.valueAsNumber * rate))) : first;
            input.value = formatSeconds(next, rate);
            if (next !== first) setWindow(next, duration);
          }} />
      </label>
      <label className="field">{t("stem_spectral_duration")}
        <select value={duration} disabled={working} onChange={event => setWindow(first, Number(event.target.value))}>
          {windows.map(seconds => <option key={seconds} value={seconds}>{seconds} s</option>)}
        </select>
      </label>
      {!effect && <button type="button" className="sek" disabled={working || scan.isFetching || scan.isSuccess} title={t("stem_spectral_auto_hint")}
        onClick={() => { if (scanRequested) void scan.refetch(); else setScanRequested(true); }}>{t("stem_spectral_auto")}</button>}
      {!effect && scan.isFetching && <span className="small" role="status">{t("stem_spectral_auto_running")}</span>}
    </div>
    {!effect && scan.isError && <p className="err" role="alert">{stemError(scan.error, t)}</p>}
    {!effect && scan.data && <SpectralFindings findings={scan.data} active={selectedFinding} frames={frames} rate={rate}
      first={first} end={end} disabled={working} onSelect={selectFinding} />}
    <div className="spectral-plot">
      {image ? <>
        <div className="spectral-graph" onPointerDown={event => {
          if (working || event.button !== 0 || !event.isPrimary) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setSelectedFinding(undefined);
          anchor.current = point(event);
          mark(anchor.current, anchor.current);
        }} onPointerMove={event => {
          if (event.isPrimary && anchor.current) mark(anchor.current, point(event));
        }} onPointerUp={event => {
          if (event.isPrimary && anchor.current) mark(anchor.current, point(event));
        }} onLostPointerCapture={() => { anchor.current = null; }}>
          <SpectralCanvas image={image} label={t("stem_spectral_image")} />
          {[100, 1000, 10000].map(hz => <span className="spectral-frequency" aria-hidden="true" key={hz}
            style={{ top: `${frequencyPosition(image, hz) * 100}%` }}>{hz < 1000 ? `${hz} Hz` : `${hz / 1000} kHz`}</span>)}
          {!effect && scan.data?.map((finding, index) => {
            if (finding.end <= first || finding.first >= end || index === selectedFinding) return null;
            const from = Math.max(first, finding.first);
            const to = Math.min(end, finding.end);
            return <div className="spectral-hit" aria-hidden="true" key={index} style={{
              left: `${(from - first) / width * 100}%`, width: `${(to - from) / width * 100}%`,
              top: `${frequencyPosition(image, finding.high_hz) * 100}%`,
              height: `${(frequencyPosition(image, finding.low_hz) - frequencyPosition(image, finding.high_hz)) * 100}%`,
            }} />;
          })}
          {(validTime || wholeTrack) && (effect || validBand) && <div className="spectral-selection" aria-hidden="true" style={{
            left: `${(scope.first - first) / width * 100}%`,
            width: `${(scope.end - scope.first) / width * 100}%`,
            top: effect ? "0" : `${frequencyPosition(image, spectral.high_hz) * 100}%`,
            height: effect ? "100%" : `${(frequencyPosition(image, spectral.low_hz) - frequencyPosition(image, spectral.high_hz)) * 100}%`,
          }} />}
        </div>
        <div className="spectral-ticks" aria-hidden="true">
          {[0, .25, .5, .75, 1].map(fraction => <span key={fraction}>{formatSeconds(first + width * fraction, rate)} s</span>)}
        </div>
      </> : preview.isError
        ? <p className="err" role="alert">{stemError(preview.error, t)}</p>
        : <p className="small" role="status">{t("stem_preparing")}</p>}
    </div>
    <div className="spectral-selection-controls">
      {([
        ["from", "stem_spectral_from", first / rate, end / rate, .001],
        ["to", "stem_spectral_to", first / rate, end / rate, .001],
        ["low", "stem_spectral_low", image?.min_hz, image?.max_hz, 1],
        ["high", "stem_spectral_high", image?.min_hz, image?.max_hz, 1],
      ] as const).slice(0, effect ? 2 : 4).map(([key, label, min, max, step]) => <label key={key} className="field">{t(label)}
        <input type="number" min={min} max={max} step={step} value={bounds[key]} disabled={!image || working}
          onChange={event => {
            setSelectedFinding(undefined);
            setBounds({ ...bounds, [key]: event.target.value });
          }} />
      </label>)}
      {effect && <RepairEffectFields effect={effect} disabled={working} onChange={setEffect} />}
      {!effect && <label className="field">{t("stem_spectral_reduction")}
        <input type="number" min={1} max={36} step={1} value={db} disabled={working} onChange={event => setDb(event.target.value)} />
      </label>}
    </div>
    {error && <p className="err" role="alert">{error}</p>}
    <div className="spectral-footer">
      <SpectralAudition key={JSON.stringify(audition)} id={id} role={role} rate={rate} selection={audition} />
      <div className="spectral-actions">
        <button type="button" className="sek" disabled={working} onClick={onClose}>{t("cancel")}</button>
        <button type="button" className="aktion" disabled={!valid || working} onClick={() => void apply()}>
          {t(working ? "stem_spectral_working" : wholeTrack ? "stem_repair_whole_apply" : "stem_spectral_apply")}
        </button>
      </div>
    </div>
  </Dialog>;
}
