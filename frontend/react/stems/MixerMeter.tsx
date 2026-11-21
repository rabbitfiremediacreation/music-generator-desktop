import { useEffect, useRef } from "react";
import { useI18n } from "../i18n";
import type { TransportStore } from "./useStemTransport";

const dbfs = (peak: number) => peak > 0 ? 20 * Math.log10(peak) : -Infinity;
const proportion = (db: number) => Math.max(0, Math.min(1, (db + 60) / 60));
const text = (db: number) => Number.isFinite(db) ? `${db.toFixed(1)} dBFS` : "−∞ dBFS";

export function MixerMeter({ store, name, index }: { store: TransportStore; name: string; index?: number }) {
  const { t } = useI18n();
  const { subscribe, getPosition } = store;
  const meter = useRef<HTMLDivElement>(null);
  const clear = useRef<() => void>(undefined);
  useEffect(() => {
    const element = meter.current;
    if (!element) return;
    const bars = Array.from(element.querySelectorAll<HTMLElement>(".mixer-meter-bar"));
    const peak = element.querySelector<HTMLElement>(".mixer-peak-value")!;
    const levels = [-60, -60], hold = [-60, -60], until = [0, 0];
    const clip = [false, false];
    let previous = performance.now();
    let accessible = 0;
    clear.current = () => {
      clip.fill(false);
      for (const bar of bars) bar.dataset.clip = "false";
      element.dataset.clip = "false";
    };
    const update = () => {
      const current = getPosition();
      const values = index === undefined ? current.masterStereo : current.stereo[index];
      const now = performance.now();
      const elapsed = Math.min(250, now - previous) / 1000;
      previous = now;
      for (let channel = 0; channel < 2; channel++) {
        const value = dbfs(values?.[channel] ?? 0);
        levels[channel] = Math.max(-60, value, levels[channel] - elapsed * 26);
        if (value >= hold[channel]) {
          hold[channel] = value;
          until[channel] = now + 1000;
        } else if (now > until[channel]) hold[channel] = Math.max(levels[channel], hold[channel] - elapsed * 18);
        clip[channel] ||= value >= 0;
        bars[channel].style.setProperty("--level", String(proportion(levels[channel])));
        bars[channel].style.setProperty("--hold", String(proportion(hold[channel])));
        bars[channel].dataset.clip = String(clip[channel]);
        if (now - accessible >= 250) {
          bars[channel].setAttribute("aria-valuenow", String(Math.max(-60, Math.min(0, levels[channel]))));
          bars[channel].setAttribute("aria-valuetext", text(value));
        }
      }
      if (now - accessible >= 250) accessible = now;
      const held = Math.max(...hold);
      peak.textContent = text(held <= -60 ? -Infinity : held);
      element.dataset.clip = String(clip.some(Boolean));
    };
    update();
    return subscribe(update);
  }, [subscribe, getPosition, index]);

  return <div className="mixer-stereo-meter" ref={meter} aria-label={`${name} · ${t("stem_meter")} dBFS`}>
    <div className="mixer-meter-pair">
      {["L", "R"].map(side => <div className="mixer-meter-side" key={side}>
        <span aria-hidden="true">{side}</span>
        <div className="mixer-meter-bar" role="meter" aria-label={`${name} · ${side} dBFS`} aria-valuemin={-60} aria-valuemax={0} aria-valuenow={-60}>
          <i /><b />
        </div>
      </div>)}
    </div>
    <button type="button" className="mixer-peak" title={t("stem_clear_clip")} aria-label={`${name} · ${t("stem_clear_clip")}`}
      onClick={() => clear.current?.()}><span className="mixer-peak-value">−∞ dBFS</span><span className="mixer-clip">CLIP</span></button>
  </div>;
}
