import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { useI18n } from "../i18n";

export interface Gesture { begin: () => void; end: () => void }
interface Control {
  label: string; value: number; min: number; max: number; neutral: number; step: number;
  change: (value: number) => void; format: (value: number) => string; gesture: Gesture; title?: string;
  stepped?: boolean; disabled?: boolean;
}
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** A pointer gesture produces continuous values and one undo transaction. */
function useSlider(control: Control, toPosition: (value: number) => number, fromPosition: (value: number) => number, fader = false) {
  const drag = useRef<{ id: number; y: number; position: number; height: number }>(undefined);
  const change = (value: number) => {
    if (control.disabled) return;
    const { step, min, max, neutral } = control;
    const rounded = Math.round(value / step) * step;
    const snapped = Math.abs(rounded - neutral) < step / 2 ? neutral : rounded;
    control.change(clamp(Number(snapped.toFixed(3)), min, max));
  };
  function stop(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = undefined;
    control.gesture.end();
  }
  function keyboard(event: KeyboardEvent<HTMLButtonElement>) {
    const { min, max, neutral, value, step, stepped } = control;
    const interval = stepped || event.shiftKey ? step : step * 5;
    const page = step * (stepped ? 3 : 20);
    const values: Record<string, number> = {
      ArrowUp: value + interval, ArrowRight: value + interval, ArrowDown: value - interval, ArrowLeft: value - interval,
      PageUp: value + page, PageDown: value - page, Home: min, End: max, "0": neutral,
    };
    if (!(event.key in values)) return;
    event.preventDefault();
    change(values[event.key]);
  }
  return {
    type: "button" as const, role: "slider", "aria-label": control.label, "aria-valuetext": control.format(control.value),
    "aria-valuemin": control.min, "aria-valuemax": Math.max(control.max, control.value), "aria-valuenow": control.value,
    title: control.title ?? control.label, disabled: control.disabled,
    onKeyDown: keyboard,
    onDoubleClick: () => change(control.neutral),
    onPointerDown(event: PointerEvent<HTMLButtonElement>) {
      if (control.disabled || event.button !== 0 || drag.current) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const position = toPosition(control.value);
      const height = fader ? rect.height || 190 : 155;
      drag.current = { id: event.pointerId, y: event.clientY, position, height };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      event.currentTarget.focus();
      control.gesture.begin();
    },
    onPointerMove(event: PointerEvent<HTMLButtonElement>) {
      const current = drag.current;
      if (!current || current.id !== event.pointerId) return;
      const delta = (current.y - event.clientY) / current.height * (event.shiftKey ? .16 : 1);
      current.y = event.clientY;
      current.position = clamp(current.position + delta, 0, 1);
      const center = toPosition(control.neutral);
      change(Math.abs(current.position - center) < (fader ? .012 : .007) ? control.neutral : fromPosition(current.position));
    },
    onPointerUp: stop, onPointerCancel: stop, onLostPointerCapture: stop,
  };
}

function NumericValue({ control, off }: { control: Control; off?: number }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<string>();
  const displayed = control.format(control.value);
  return <input type="text" inputMode="decimal" className="mixer-value" aria-label={`${control.label} · ${t("stem_numeric_value")}`}
    title={control.title ?? displayed} value={editing ?? displayed}
    onFocus={event => {
      setEditing(control.value === off ? "−∞" : String(control.value));
      event.currentTarget.select();
    }}
    onChange={event => setEditing(event.target.value)}
    onBlur={() => {
      if (editing !== undefined) {
        const raw = editing.trim().replace(",", ".").replace("−", "-");
        const value = off !== undefined && /^(?:-?∞|-?inf)$/i.test(raw) ? off : Number(raw);
        if (raw && Number.isFinite(value) && value !== control.value) control.change(clamp(value, control.min, control.max));
      }
      setEditing(undefined);
    }}
    onKeyDown={event => {
      if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
      if (event.key === "Escape") { event.stopPropagation(); setEditing(undefined); }
    }} />;
}

export function MixerKnob({ caption, ...control }: Control & { caption: string }) {
  const position = (value: number) => (value - control.min) / (control.max - control.min);
  const slider = useSlider(control, position, value => control.min + value * (control.max - control.min));
  const angle = position(control.value) * 270;
  const neutral = position(control.neutral) * 270;
  const style = {
    "--knob-angle": `${angle - 135}deg`, "--arc-start": `${Math.min(angle, neutral)}deg`, "--arc-end": `${Math.max(angle, neutral)}deg`,
    "--knob-neutral": `${neutral - 135}deg`,
  } as CSSProperties;
  return <div className="mixer-knob">
    <span className="mixer-control-caption">{caption}</span>
    <button {...slider} className="mixer-dial" style={style}><span className="mixer-dial-face" /></button>
    {control.stepped || control.disabled
      ? <span className="mixer-knob-readout" aria-hidden="true">{control.format(control.value)}</span>
      : <NumericValue control={control} />}
  </div>;
}

const OFF = -61;
const scale = [[0, OFF], [.12, -48], [.31, -24], [.49, -12], [.65, -6], [.82, 0], [1, 6]];

function interpolate(value: number, input: 0 | 1) {
  const output = 1 - input;
  const upper = scale.findIndex(pair => value <= pair[input]);
  if (upper < 0) return scale.at(-1)![output];
  if (upper === 0) return scale[0][output];
  const before = scale[upper - 1], after = scale[upper];
  return before[output] + (after[output] - before[output]) * (value - before[input]) / (after[input] - before[input]);
}

export function MixerFader({ label, db, off, change, gesture }: {
  label: string; db: number; off: boolean; change: (db: number, off: boolean) => void; gesture: Gesture;
}) {
  const control: Control = {
    label, value: off ? OFF : db, min: OFF, max: 6, neutral: 0, step: .1, gesture,
    change: value => change(Math.max(-60, value), value <= OFF + .0001),
    format: value => value <= OFF ? "−∞ dB" : `${value > 0 ? "+" : ""}${value.toFixed(1)} dB`,
  };
  function toDb(value: number) {
    const dbValue = interpolate(value, 0);
    return dbValue < -60.5 ? OFF : Math.max(-60, dbValue);
  }
  const slider = useSlider(control, value => interpolate(value, 1), toDb, true);
  return <div className="mixer-fader">
    <div className="mixer-fader-scale" aria-hidden="true">
      {scale.map(([position, value]) => <span className={value === 0 ? "unity" : ""} key={value}
        style={{ bottom: `${position * 100}%` }}>{value === OFF ? "−∞" : value > 0 ? "+" + value : value}</span>)}
    </div>
    <button {...slider} className="mixer-fader-rail">
      <span className="mixer-fader-cap" style={{ bottom: `${interpolate(control.value, 1) * 100}%` }} />
    </button>
    <NumericValue control={control} off={OFF} />
  </div>;
}
