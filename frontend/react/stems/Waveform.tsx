import { useEffect, useRef } from "react";
import { subscribeTheme } from "../../desktop-theme";

export function Waveform({ peaks, from = 0, to = 1, label }: { peaks: number[]; from?: number; to?: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const { width, height } = canvas;
    if (!peaks.length) {
      context.clearRect(0, 0, width, height);
      return;
    }
    const step = width / peaks.length;
    const max = Math.max(1, ...peaks);
    const draw = () => {
      context.clearRect(0, 0, width, height);
      context.fillStyle = getComputedStyle(canvas).color;
      for (const [index, peak] of peaks.entries()) {
        const level = Math.max(1, peak / max * (height - 8));
        const selected = index / peaks.length >= from && index / peaks.length < to;
        context.globalAlpha = selected ? 1 : .3;
        context.fillRect(index * step, (height - level) / 2, Math.max(1, step - 2), level);
      }
    };
    draw();
    return subscribeTheme(draw);
  }, [peaks, from, to]);
  return <canvas className="stem-waveform" ref={ref} width={640} height={68} role="img" aria-label={label} />;
}
