import { useEffect, useMemo, useRef } from "react";
import type { StemSpectrogram } from "../../stems";
import { useI18n } from "../i18n";
import { DynamicEqPoint } from "./DynamicEqPoint";
import type { Gesture } from "./MixerControls";
import { dynamicEqCut, eqCutAt, eqCutPosition, eqFrequencyAt, eqFrequencyPosition, eqSpectrum } from "./dynamic-eq-curve";
import { clampEq, defaultEqBand, dynamicEqBandwidth, dynamicEqFrequency, dynamicEqReduction, maxEqBands, type DynamicEqBand } from "./repair-tools";
import "./dynamic-eq.css";

const ticksHz = [40, 100, 250, 500, 1000, 2000, 5000, 10000, 18000];
const ticksDb = [0, 6, 12, 18, 24];
const graphWidth = 1000;
const graphHeight = 360;
const accent = "#73e0e5";
const colors = ["#8be4e7", "#edbd84", "#c4a9ef", "#8ddd9d", "#f1a8ba", "#b5cafa", "#e1dd91", "#eaa795"];
const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;
const xHz = (hz: number) => eqFrequencyPosition(hz) * graphWidth;
const yDb = (cut: number) => eqCutPosition(cut) * graphHeight;
type Spectrum = ReturnType<typeof eqSpectrum>;

function displayBand(band: DynamicEqBand): DynamicEqBand {
  return {
    ...band,
    frequency_hz: clampEq(finite(band.frequency_hz, defaultEqBand.frequency_hz), dynamicEqFrequency),
    reduction_db: clampEq(finite(band.reduction_db, defaultEqBand.reduction_db), dynamicEqReduction),
    q: clampEq(finite(band.q, defaultEqBand.q), dynamicEqBandwidth),
  };
}

function drawCurve(context: CanvasRenderingContext2D, bands: DynamicEqBand[], rate: number, color: string, fill: boolean) {
  context.beginPath();
  for (let x = 0; x <= graphWidth; x += 2) {
    const hz = eqFrequencyAt(x / graphWidth);
    const cut = bands.reduce((sum, band) => sum + dynamicEqCut(band, hz, rate), 0);
    if (x === 0) context.moveTo(x, yDb(cut));
    else context.lineTo(x, yDb(cut));
  }
  context.strokeStyle = color;
  context.lineWidth = fill ? 2.5 : 1.25;
  context.stroke();
  if (fill) {
    context.lineTo(graphWidth, yDb(0));
    context.lineTo(0, yDb(0));
    context.closePath();
    context.fillStyle = "#73e0e521";
    context.fill();
  }
}

function drawGraph(context: CanvasRenderingContext2D, bands: DynamicEqBand[], rate: number, spectrum: Spectrum, selected: number) {
  context.clearRect(0, 0, graphWidth, graphHeight);
  if (spectrum.length) {
    context.beginPath();
    context.moveTo(0, graphHeight);
    for (const { x, level } of spectrum) {
      context.lineTo(x * graphWidth, graphHeight * (1 - level * .87));
    }
    context.lineTo(graphWidth, graphHeight);
    context.closePath();
    context.fillStyle = "#5c879f43";
    context.fill();
  }
  context.lineWidth = 1;
  context.strokeStyle = "#9cbbc430";
  context.beginPath();
  for (const hz of ticksHz) {
    context.moveTo(xHz(hz), 0);
    context.lineTo(xHz(hz), graphHeight);
  }
  for (const db of ticksDb) {
    context.moveTo(0, yDb(db));
    context.lineTo(graphWidth, yDb(db));
  }
  context.stroke();

  if (bands.length > 1) bands.forEach((band, index) => {
    drawCurve(context, [band], rate, colors[index] + (index === selected ? "bd" : "55"), false);
  });
  if (bands.length) drawCurve(context, bands, rate, accent, true);
}

export function DynamicEqGraph({ bands, selected, rate, image, from, to, disabled, gesture, onSelect, onAdd, onChange, onRemove }: {
  bands: DynamicEqBand[]; selected: number; rate: number; image?: StemSpectrogram; from: number; to: number; disabled: boolean;
  gesture: Gesture;
  onSelect: (index: number) => void; onAdd: (band: DynamicEqBand) => void;
  onChange: (index: number, band: DynamicEqBand) => void; onRemove: (index: number) => void;
}) {
  const { t } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const plot = useRef<HTMLDivElement>(null);
  const spectrum = useMemo(() => image ? eqSpectrum(image, from, to) : [], [image, from, to]);
  const display = useMemo(() => bands.map(displayBand), [bands]);
  const canAdd = !disabled && bands.length < maxEqBands;

  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (context) drawGraph(context, display, rate, spectrum, selected);
  }, [display, rate, spectrum, selected]);

  function addDefault() {
    const positions = [2500, 500, 6400, 1100, 180, 11000, 75, 3400];
    const frequency_hz = positions.find(hz => !bands.some(band => Math.abs(Math.log(band.frequency_hz / hz)) < .12)) ?? 2500;
    onAdd({ ...defaultEqBand, frequency_hz });
    plot.current?.focus({ preventScroll: true });
  }

  function removeSelected() {
    onRemove(selected);
    plot.current?.focus({ preventScroll: true });
  }

  return <section className="dynamic-eq-editor" aria-label={t("stem_repair_eq_graph")} onKeyDown={event => {
    if (disabled || !bands[selected] || (event.key !== "Delete" && event.key !== "Backspace")) return;
    event.preventDefault();
    removeSelected();
  }}>
    <div className="dynamic-eq-panel">
      <div className="dynamic-eq-plot" ref={plot} tabIndex={-1} title={canAdd ? t("stem_repair_eq_add_hint") : undefined}
        onDoubleClick={event => {
          if (!canAdd) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (!bounds.width || !bounds.height) return;
          const x = (event.clientX - bounds.left) / bounds.width;
          const y = (event.clientY - bounds.top) / bounds.height;
          const cut = Math.round(eqCutAt(y) * 10) / 10;
          onAdd({
            ...defaultEqBand,
            frequency_hz: clampEq(Math.round(eqFrequencyAt(x)), dynamicEqFrequency),
            reduction_db: cut < 1 ? defaultEqBand.reduction_db : clampEq(cut, dynamicEqReduction),
          });
          event.currentTarget.focus({ preventScroll: true });
        }}>
        <canvas ref={canvas} width={graphWidth} height={graphHeight} aria-hidden="true" />
        {bands.map((band, index) => <DynamicEqPoint key={index} band={band} display={display[index]} index={index}
          color={colors[index]} selected={index === selected} disabled={disabled} plot={plot} gesture={gesture}
          onSelect={() => onSelect(index)} onChange={value => onChange(index, value)} />)}
      </div>
      <div className="dynamic-eq-depth" aria-hidden="true">
        {ticksDb.map(db => <span key={db} style={{ top: `${eqCutPosition(db) * 100}%` }}>
          {db === 0 ? "0 dB" : `−${db}`}
        </span>)}
      </div>
      <div className="dynamic-eq-frequencies" aria-hidden="true">
        {ticksHz.map(hz => <span key={hz} style={{ left: `${eqFrequencyPosition(hz) * 100}%` }}>
          {hz < 1000 ? hz : `${hz / 1000}k`}
        </span>)}
      </div>
    </div>
    <div className="dynamic-eq-toolbar">
      <div className="dynamic-eq-legend">
        {bands.length > 0 && <span className="dynamic-eq-curve-key">{t("stem_repair_eq_curve")}</span>}
        {image && <span className="dynamic-eq-spectrum-key">{t("stem_repair_eq_spectrum")}</span>}
      </div>
      <div className="dynamic-eq-actions">
        <button type="button" className="sek mini" disabled={!canAdd} onClick={addDefault}>{t("stem_repair_eq_add")}</button>
        <button type="button" className="sek mini" disabled={disabled || !bands[selected]}
          onClick={removeSelected}>{t("stem_repair_eq_remove")}</button>
      </div>
    </div>
  </section>;
}
