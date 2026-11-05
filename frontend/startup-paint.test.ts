// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { waitForPaint, waitForSplashPaint } from "./startup-paint";

let frames: FrameRequestCallback[];
beforeEach(() => {
  vi.useFakeTimers();
  frames = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => frames.push(callback));
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it.each([0, 1])("bounds splash waiting when %i frames arrive and cancels pending work", async count => {
  const result = vi.fn();
  const paint = waitForSplashPaint().then(result);
  if (count) frames.shift()!(0);
  await vi.advanceTimersByTimeAsync(499);
  expect(result).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await paint;
  expect(result).toHaveBeenCalledExactlyOnceWith("timeout");
  expect(window.cancelAnimationFrame).toHaveBeenCalled();
  const pending = frames.length;
  frames.shift()!(500);
  expect(frames).toHaveLength(pending - 1);
  expect(result).toHaveBeenCalledTimes(1);
});

it("clears the fallback after two timely frames", async () => {
  const paint = waitForSplashPaint();
  frames.shift()!(0);
  frames.shift()!(16);
  await expect(paint).resolves.toBe("frames");
  expect(vi.getTimerCount()).toBe(0);
});

it("does not turn the main-window frame handshake into a timer-based success", async () => {
  const result = vi.fn();
  const paint = waitForPaint().then(result);
  await vi.advanceTimersByTimeAsync(30000);
  expect(result).not.toHaveBeenCalled();
  frames.shift()!(30000);
  frames.shift()!(30016);
  await paint;
  expect(result).toHaveBeenCalledTimes(1);
});
