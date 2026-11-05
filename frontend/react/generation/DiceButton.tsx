import { useState } from "react";
import type { MouseEvent } from "react";

export function DiceButton({ id, label, onClick }: { id: string; label: string; onClick: () => void }) {
  const [roll, setRoll] = useState(0);
  function click(event: MouseEvent) { event.preventDefault(); event.stopPropagation(); onClick(); setRoll(current => current + 1); }
  return <button id={id} type="button" className={`dice${roll ? " roll" : ""}`} title={label} aria-label={label} onClick={click}>
    <svg key={roll} viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4" />{[[8.5,8.5],[15.5,8.5],[12,12],[8.5,15.5],[15.5,15.5]].map(([cx,cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1" fill="currentColor" />)}</svg>
  </button>;
}
