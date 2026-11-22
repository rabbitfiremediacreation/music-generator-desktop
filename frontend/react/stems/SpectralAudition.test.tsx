// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setLang, t } from "../../i18n.js";
import { SpectralAudition } from "./SpectralAudition";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, convertFileSrc: vi.fn() }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("switches between sample-aligned stereo loops without restarting or applying the repair", async () => {
  setLang("en");
  const selection = { first: 20, end: 50, low_hz: 2500, high_hz: 2700, reduction_db: 9 };
  const bytes = new ArrayBuffer(16 * 5);
  const data = new DataView(bytes);
  const middleFrame = [.25, -.25, .125, -.125];
  middleFrame.forEach((sample, channel) => data.setFloat32(32 + channel * 4, sample, true));
  invoke.mockReset().mockResolvedValue(Array.from(new Uint8Array(bytes)));

  const source = () => ({ start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn() });
  const gain = () => ({ gain: { value: 0, setTargetAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() });
  const sources: ReturnType<typeof source>[] = [];
  const gains: ReturnType<typeof gain>[] = [];
  const buffers: Float32Array[][] = [];
  const close = vi.fn().mockResolvedValue(undefined);
  class Context {
    currentTime = 1;
    destination = {};
    resume = vi.fn().mockResolvedValue(undefined);
    close = close;
    createBuffer(channels: number, frames: number) {
      const data = Array.from({ length: channels }, () => new Float32Array(frames));
      buffers.push(data);
      return { getChannelData: (channel: number) => data[channel] };
    }
    createBufferSource() {
      const node = source();
      sources.push(node);
      return node;
    }
    createGain() {
      const node = gain();
      gains.push(node);
      return node;
    }
  }
  vi.stubGlobal("AudioContext", Context);

  const view = render(<SpectralAudition id="project" role="vocals" rate={44100} selection={selection} />);
  fireEvent.click(screen.getByRole("button", { name: t("stem_spectral_audition") }));
  const stop = await screen.findByRole("button", { name: t("stem_spectral_audition_stop") });
  expect(invoke).toHaveBeenCalledExactlyOnceWith("stem_spectral_audition", { id: "project", role: "vocals", selection });
  expect(buffers.flatMap(channels => channels.map(channel => channel[2]))).toEqual(middleFrame);
  expect(sources.map(node => node.start.mock.calls)).toEqual([[[1.02]], [[1.02]]]);
  expect(gains.map(node => node.gain.value)).toEqual([1, 0]);

  fireEvent.click(screen.getByRole("button", { name: t("stem_spectral_after") }));
  expect(gains.map(node => node.gain.setTargetAtTime.mock.calls)).toEqual([[[0, 1, .004]], [[1, 1, .004]]]);
  expect(sources.every(node => node.start.mock.calls.length === 1 && node.stop.mock.calls.length === 0)).toBe(true);
  fireEvent.click(stop);
  expect(sources.every(node => node.stop.mock.calls.length === 1)).toBe(true);
  view.unmount();
  expect(close).toHaveBeenCalledTimes(1);
});
