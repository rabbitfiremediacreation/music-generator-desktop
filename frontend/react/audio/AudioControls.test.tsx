// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { t } from "../../i18n.js";
import { AudioControls } from "./AudioControls";
const mocks = vi.hoisted(() => ({ pickAudioFile: vi.fn(), analyze: vi.fn(), dialogDirectory: vi.fn(), remember: vi.fn() }));
vi.mock("../../backend", () => ({ backend: mocks }));
vi.mock("../../path-dialogs", () => ({ dialogDirectory: mocks.dialogDirectory, rememberDialogFolder: mocks.remember, pathErrorText: (error: unknown) => String(error) }));
function mount(onAnalysis = vi.fn()) {
  const view = render(<QueryClientProvider client={new QueryClient()}><I18nProvider><AudioControls selection={null} onAnalysis={onAnalysis} /></I18nProvider></QueryClientProvider>);
  return { ...view, onAnalysis };
}
beforeEach(() => { vi.clearAllMocks(); mocks.dialogDirectory.mockResolvedValue("/audio"); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("uses the native audio selection and applies its analysis once", async () => {
  mocks.pickAudioFile.mockResolvedValue({ name: "idea.wav", directory: "/chosen", data: [1, 2, 3] });
  mocks.analyze.mockResolvedValue({ caption: "A calm song", bpm: 90 });
  const { onAnalysis } = mount();
  const upload = screen.getByRole("button", { name: t("drop_aria") });
  fireEvent.click(upload); fireEvent.click(upload);
  await waitFor(() => expect(onAnalysis).toHaveBeenCalledWith({ caption: "A calm song", bpm: 90 }, false));
  expect(mocks.pickAudioFile).toHaveBeenCalledTimes(1);
  expect(mocks.analyze).toHaveBeenCalledTimes(1);
  expect(mocks.remember).toHaveBeenCalledWith("audio_import", "/chosen");
});
it("closes a microphone stream arriving after the user has released the button", async () => {
  let permit!: (stream: MediaStream) => void;
  const getUserMedia = vi.fn(() => new Promise<MediaStream>(resolve => { permit = resolve; }));
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  const construct = vi.fn(); vi.stubGlobal("MediaRecorder", construct);
  const stop = vi.fn();
  mount();
  fireEvent.pointerDown(screen.getByRole("button", { name: t("rec_aria") }), { button: 0 });
  await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
  fireEvent.pointerUp(window);
  await act(async () => { permit({ getTracks: () => [{ stop }] } as unknown as MediaStream); });
  expect(stop).toHaveBeenCalledTimes(1);
  expect(construct).not.toHaveBeenCalled();
  expect(mocks.analyze).not.toHaveBeenCalled();
});

it("rejects a short recording and releases recorder resources on unmount", async () => {
  const stopTrack = vi.fn();
  class Recorder extends EventTarget {
    state = "inactive"; mimeType = "audio/webm";
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.dispatchEvent(new Event("stop")); }
  }
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })) } });
  vi.stubGlobal("MediaRecorder", Recorder);
  const view = mount();
  const microphone = screen.getByRole("button", { name: t("rec_aria") });
  fireEvent.pointerDown(microphone, { button: 0 });
  await waitFor(() => expect(microphone.getAttribute("aria-pressed")).toBe("true"));
  fireEvent.pointerUp(window);
  await screen.findByText(t("rec_short"));
  expect(stopTrack).toHaveBeenCalled(); expect(mocks.analyze).not.toHaveBeenCalled();
  fireEvent.pointerDown(microphone, { button: 0 });
  await waitFor(() => expect(microphone.getAttribute("aria-pressed")).toBe("true"));
  view.unmount(); expect(stopTrack).toHaveBeenCalled(); expect(mocks.analyze).not.toHaveBeenCalled();
});

it("stops automatically at thirty seconds and applies a microphone analysis", async () => {
  vi.useFakeTimers();
  const stopTrack = vi.fn();
  class Recorder extends EventTarget {
    state = "inactive"; mimeType = "audio/webm";
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.dispatchEvent(new Event("stop")); }
  }
  class Context {
    close = vi.fn();
    async decodeAudioData() { return { length: 128, numberOfChannels: 1, sampleRate: 48000, getChannelData: () => new Float32Array(128) }; }
  }
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })) } });
  vi.stubGlobal("MediaRecorder", Recorder); vi.stubGlobal("AudioContext", Context);
  mocks.analyze.mockResolvedValue({ caption: "calm", bpm: 80, keyscale: "C major" });
  const { onAnalysis } = mount();
  const microphone = screen.getByRole("button", { name: t("rec_aria") });
  fireEvent.pointerDown(microphone, { button: 0 });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(microphone.getAttribute("aria-pressed")).toBe("true");
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(stopTrack).toHaveBeenCalled();
  expect(microphone.getAttribute("aria-pressed")).toBe("false");
  expect(onAnalysis).toHaveBeenCalledWith(expect.objectContaining({ bpm: 80, caption: expect.stringContaining("melody") }), true);
});
