import { memo, useEffect, useRef } from "react";
import { subscribeTheme } from "../../desktop-theme";
import type { StereoEnvelope } from "./stereo-envelope";

function drawChannel(ctx: CanvasRenderingContext2D, bounds: Float32Array, center: number, scale: number, from: number, to: number) {
  const { width } = ctx.canvas;
  const bins = bounds.length / 2;
  ctx.globalAlpha = .25;
  ctx.fillRect(0, Math.round(center), width, 1);
  for (let x = 0; x < width; x++) {
    const first = Math.floor(x * bins / width) * 2;
    const end = Math.ceil((x + 1) * bins / width) * 2;
    if (first === end) continue;
    let low = bounds[first], high = bounds[first + 1];
    for (let index = first + 2; index < end; index += 2) {
      low = Math.min(low, bounds[index]);
      high = Math.max(high, bounds[index + 1]);
    }
    if (low === 0 && high === 0) continue;
    const time = (x + .5) / width;
    ctx.globalAlpha = time >= from && time < to ? 1 : .35;
    ctx.fillRect(x, center - high * scale, 1, Math.max(1, (high - low) * scale));
  }
}

export const StereoWaveform = memo(function StereoWaveform({ envelope, from, to, label }: {
  envelope: StereoEnvelope; from: number; to: number; label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const draw = () => {
      const size = canvas.getBoundingClientRect();
      if (!size.width || !size.height) return;
      const resolution = window.devicePixelRatio || 1;
      const width = Math.round(size.width * resolution), height = Math.round(size.height * resolution);
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = getComputedStyle(canvas).color;
      const scale = Math.max(1, height / 4 - resolution) / Math.max(.125, envelope.peak);
      drawChannel(ctx, envelope.left, height / 4, scale, from, to);
      drawChannel(ctx, envelope.right, height * .75, scale, from, to);
      ctx.globalAlpha = 1;
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    const unsubscribe = subscribeTheme(draw);
    return () => { observer.disconnect(); unsubscribe(); };
  }, [envelope, from, to]);
  return <canvas className="mixer-stereo-waveform" ref={ref} role="img" aria-label={label} />;
});
