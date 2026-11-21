import { useRef, useState } from "react";
import type { StemMix } from "../../stems";

interface History { past: StemMix[]; mix: StemMix; future: StemMix[] }
const same = (left: StemMix, right: StemMix) => left === right || JSON.stringify(left) === JSON.stringify(right);

export function useMixerHistory(initial: () => StemMix) {
  const [history, setHistory] = useState<History>(() => ({ past: [], mix: initial(), future: [] }));
  const current = useRef(history);
  const baseline = useRef<StemMix>(undefined);
  function write(value: History) { current.current = value; setHistory(value); }
  function commit(base: StemMix, next: StemMix) {
    const state = current.current;
    if (!same(base, next)) write({ past: [...state.past.slice(-79), base], mix: next, future: [] });
  }
  function end() {
    const base = baseline.current;
    baseline.current = undefined;
    if (base) commit(base, current.current.mix);
  }
  function edit(change: (mix: StemMix) => StemMix) {
    const state = current.current;
    const next = change(state.mix);
    if (baseline.current) write({ ...state, mix: next });
    else commit(state.mix, next);
  }
  function undo() {
    end();
    const state = current.current;
    const previous = state.past.at(-1);
    if (previous) write({ past: state.past.slice(0, -1), mix: previous, future: [state.mix, ...state.future] });
  }
  function redo() {
    end();
    const state = current.current;
    const next = state.future[0];
    if (next) write({ past: [...state.past, state.mix], mix: next, future: state.future.slice(1) });
  }
  function load(mix: StemMix) {
    baseline.current = undefined;
    write({ past: [], mix, future: [] });
  }
  return { ...history, edit, undo, redo, load, gesture: { begin: () => { baseline.current ??= current.current.mix; }, end } };
}
