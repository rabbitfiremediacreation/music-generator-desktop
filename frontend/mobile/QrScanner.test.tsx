// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QrScanner } from "./QrScanner";
import { messages } from "./messages";

const mocks = vi.hoisted(() => ({ decode: vi.fn() }));
vi.mock("jsqr", () => ({ default: mocks.decode }));
const getUserMedia = vi.fn(), stop = vi.fn(), onToken = vi.fn();
const camera = { getTracks: () => [{ stop }] } as unknown as MediaStream;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
const t = (key: keyof typeof messages.en) => messages.en[key];

beforeEach(() => {
  vi.resetAllMocks(); frames = new Map(); nextFrame = 0;
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("BarcodeDetector", undefined);
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { const id = ++nextFrame; frames.set(id, callback); return id; }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => { frames.delete(id); }));
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const sources = new WeakMap<HTMLMediaElement, MediaStream | null>();
  vi.spyOn(HTMLMediaElement.prototype, "srcObject", "get").mockImplementation(function (this: HTMLMediaElement) { return sources.get(this) || null; });
  vi.spyOn(HTMLMediaElement.prototype, "srcObject", "set").mockImplementation(function (this: HTMLMediaElement, value) { sources.set(this, value as MediaStream | null); });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(2);
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { configurable: true, get: () => 4 });
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { configurable: true, get: () => 4 });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(64), width: 4, height: 4 }) } as unknown as CanvasRenderingContext2D);
  getUserMedia.mockResolvedValue(camera); mocks.decode.mockReturnValue(null);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(HTMLVideoElement.prototype, "videoWidth"); Reflect.deleteProperty(HTMLVideoElement.prototype, "videoHeight"); });
function mount() { return render(<QrScanner t={t} onToken={onToken} />); }
async function openCamera() { fireEvent.click(screen.getByRole("button", { name: "Scan QR code" })); await waitFor(() => expect(frames.size).toBe(1)); }
async function scanFrame() { const [id, callback] = [...frames.entries()][0]; frames.delete(id); await act(async () => { callback(1000); await Promise.resolve(); }); }

it("requests the rear camera only after an explicit click and releases it on cancel", async () => {
  mount(); expect(getUserMedia).not.toHaveBeenCalled();
  await openCamera();
  expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: { ideal: "environment" } }, audio: false });
  const video = screen.getByLabelText(t("scanHint")) as HTMLVideoElement;
  expect(video.srcObject).toBe(camera);
  fireEvent.click(screen.getByRole("button", { name: "Cancel scanning" }));
  expect(stop).toHaveBeenCalledOnce(); expect(video.srcObject).toBeNull(); expect(frames.size).toBe(0);
  expect(screen.queryByRole("dialog")).toBeNull(); expect(document.activeElement).toBe(screen.getByRole("button", { name: "Scan QR code" }));
});

it("stops late camera permission results after the scanner was cancelled", async () => {
  let finish!: (value: MediaStream) => void;
  getUserMedia.mockImplementation(() => new Promise<MediaStream>(resolve => { finish = resolve; }));
  mount(); fireEvent.click(screen.getByRole("button", { name: "Scan QR code" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel scanning" }));
  await act(async () => { finish(camera); });
  expect(stop).toHaveBeenCalledOnce(); expect(frames.size).toBe(0); expect(screen.queryByRole("dialog")).toBeNull();
});

it("stops tracks and frame scanning when the page becomes hidden or unmounts", async () => {
  const mounted = mount(); await openCamera();
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  fireEvent(document, new Event("visibilitychange"));
  expect(stop).toHaveBeenCalledOnce(); expect(frames.size).toBe(0); expect(screen.queryByRole("dialog")).toBeNull();
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  await openCamera(); mounted.unmount();
  expect(stop).toHaveBeenCalledTimes(2); expect(frames.size).toBe(0);
});

it("decodes web QR data with the bundled fallback and returns only a key without navigating", async () => {
  const href = window.location.href;
  mocks.decode.mockReturnValue({ data: "https://another-computer.test/mobile/#token=scanned-key" });
  mount(); await openCamera(); await scanFrame();
  expect(onToken).toHaveBeenCalledWith("scanned-key"); expect(stop).toHaveBeenCalledOnce(); expect(frames.size).toBe(0); expect(window.location.href).toBe(href); expect(screen.queryByRole("dialog")).toBeNull();
});

it("falls back to the bundled decoder when the browser QR detector fails", async () => {
  vi.stubGlobal("BarcodeDetector", class { detect() { return Promise.reject(new Error("not supported")); } });
  mocks.decode.mockReturnValue({ data: "musicgenerator://connect?token=native-key" });
  mount(); await openCamera(); await scanFrame();
  await waitFor(() => expect(onToken).toHaveBeenCalledWith("native-key"));
  expect(stop).toHaveBeenCalledOnce();
});

it("reports denied permission and leaves the camera closed after cancelling", async () => {
  getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
  mount(); fireEvent.click(screen.getByRole("button", { name: "Scan QR code" }));
  expect((await screen.findByRole("alert")).textContent).toBe(t("scanDenied"));
  expect(onToken).not.toHaveBeenCalled(); expect(frames.size).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "Cancel scanning" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("explains the HTTPS requirement without prompting the camera over HTTP", () => {
  vi.stubGlobal("isSecureContext", false);
  mount(); fireEvent.click(screen.getByRole("button", { name: "Scan QR code" }));
  expect(getUserMedia).not.toHaveBeenCalled(); expect(screen.getByRole("alert").textContent).toBe(t("scanHttp"));
});
