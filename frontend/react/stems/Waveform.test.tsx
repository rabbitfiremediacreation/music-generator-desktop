// @vitest-environment happy-dom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setTheme } from "../../desktop-theme";
import { Waveform } from "./Waveform";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setTheme("classic");
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
