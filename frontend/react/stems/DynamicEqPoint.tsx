import { useEffect, useRef, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { useI18n } from "../i18n";
import type { Gesture } from "./MixerControls";
import { eqCutAt, eqCutPosition, eqFrequencyAt, eqFrequencyPosition } from "./dynamic-eq-curve";
import { clampEq, dynamicEqBandwidth, dynamicEqFrequency, dynamicEqReduction, type DynamicEqBand } from "./repair-tools";

interface Drag {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  band: DynamicEqBand;
}

export function DynamicEqPoint({ band, display, index, color, selected, disabled, plot, gesture, onSelect, onChange }: {
  band: DynamicEqBand; display: DynamicEqBand; index: number; color: string; selected: boolean; disabled: boolean;
  plot: RefObject<HTMLDivElement | null>; onSelect: () => void; onChange: (band: DynamicEqBand) => void;
  gesture: Gesture;
}) {
  const { t } = useI18n();
  const node = useRef<HTMLButtonElement>(null);
  const drag = useRef<Drag>(null);
  const { frequency_hz: frequency, reduction_db: cut, q } = display;

  useEffect(() => {
    const point = node.current;
    if (!point || disabled) return;
    function adjustQ(event: WheelEvent) {
      if (!event.deltaY) return;
      event.preventDefault();
      const next = q - Math.sign(event.deltaY) * Math.max(.1, q * .12);
      onSelect();
      onChange({ ...band, q: clampEq(Math.round(next * 10) / 10, dynamicEqBandwidth) });
    }
    point.addEventListener("wheel", adjustQ, { passive: false });
    return () => point.removeEventListener("wheel", adjustQ);
  }, [band, disabled, onChange, onSelect, q]);

  function move(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current;
    if (!active || active.id !== event.pointerId) return;
    const x = eqFrequencyPosition(active.band.frequency_hz) + (event.clientX - active.x) / active.width;
    const y = eqCutPosition(active.band.reduction_db) + (event.clientY - active.y) / active.height;
    onChange({
      ...band,
      frequency_hz: clampEq(Math.round(eqFrequencyAt(x)), dynamicEqFrequency),
      reduction_db: clampEq(Math.round(eqCutAt(y) * 10) / 10, dynamicEqReduction),
    });
  }

  function keys(event: KeyboardEvent<HTMLButtonElement>) {
    const semitones = event.shiftKey ? 6 : 1;
    const decibels = event.shiftKey ? 2 : .5;
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowRight": {
        const direction = event.key === "ArrowRight" ? 1 : -1;
        onChange({ ...band, frequency_hz: clampEq(Math.round(frequency * 2 ** (direction * semitones / 12)), dynamicEqFrequency) });
        break;
      }
      case "ArrowUp":
      case "ArrowDown": {
        const direction = event.key === "ArrowDown" ? 1 : -1;
        onChange({ ...band, reduction_db: clampEq(Math.round((cut + direction * decibels) * 10) / 10, dynamicEqReduction) });
        break;
      }
      default: return;
    }
    event.preventDefault();
  }

  return <button ref={node} type="button" className="dynamic-eq-point" disabled={disabled}
    aria-label={t("stem_repair_eq_point", index + 1)} aria-pressed={selected} title={t("stem_repair_eq_drag")}
    style={{ left: `${eqFrequencyPosition(frequency) * 100}%`, top: `${eqCutPosition(cut) * 100}%`, color }}
    onFocus={onSelect} onClick={onSelect} onDoubleClick={event => event.stopPropagation()}
    onKeyDown={keys} onPointerDown={event => {
      if (event.button !== 0 || drag.current) return;
      event.currentTarget.focus({ preventScroll: true });
      const bounds = plot.current?.getBoundingClientRect();
      if (!bounds?.width || !bounds.height) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      gesture.begin();
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, width: bounds.width, height: bounds.height, band: display };
    }} onPointerMove={move} onLostPointerCapture={() => {
      if (drag.current) gesture.end();
      drag.current = null;
    }}>{index + 1}</button>;
}
