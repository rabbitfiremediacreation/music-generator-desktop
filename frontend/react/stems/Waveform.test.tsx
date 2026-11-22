// @vitest-environment happy-dom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setTheme } from "../../desktop-theme";
import { StereoWaveform } from "./StereoWaveform";
import { Waveform } from "./Waveform";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setTheme("classic");
});

it("draws stereo sides around separate baselines with one shared amplitude scale", () => {
  const fillRect = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 4, 40));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    return { canvas: this, clearRect: vi.fn(), fillRect } as unknown as CanvasRenderingContext2D;
  });
  render(<StereoWaveform envelope={{ left: new Float32Array([-.5, .5]), right: new Float32Array([.25, .25]), peak: .5 }}
    from={0} to={1} label="Stereo" />);
  const dpi = window.devicePixelRatio || 1;
  expect(fillRect).toHaveBeenCalledWith(0, Math.round(10 * dpi), Math.round(4 * dpi), 1);
  expect(fillRect).toHaveBeenCalledWith(0, dpi, 1, 18 * dpi);
  expect(fillRect).toHaveBeenCalledWith(0, Math.round(30 * dpi), Math.round(4 * dpi), 1);
  expect(fillRect).toHaveBeenCalledWith(0, 25.5 * dpi, 1, 1);
});

it("redraws the existing canvas with the current theme color", () => {
  const palette = document.createElement("style");
  palette.textContent = ".stem-waveform { color: rgb(209, 167, 92); }";
  document.head.append(palette);
  try {
    const context = { clearRect: vi.fn(), fillRect: vi.fn(), fillStyle: "", globalAlpha: 1 };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
    setTheme("classic");
    const waveform = render(<Waveform peaks={[.5]} label="Waveform" />);
    expect(context.fillStyle).toBe("rgb(209, 167, 92)");

    waveform.getByRole("img").style.color = "rgb(129, 222, 169)";
    act(() => setTheme("green"));
    expect(context.fillStyle).toBe("rgb(129, 222, 169)");
    expect(context.fillRect).toHaveBeenCalledTimes(2);

    waveform.unmount();
    act(() => setTheme("classic"));
    expect(context.fillRect).toHaveBeenCalledTimes(2);
  } finally {
    palette.remove();
  }
});
