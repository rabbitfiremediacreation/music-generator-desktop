// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mountStudio } from "./dom-fixture";
const mocks = vi.hoisted(() => ({ bootstrap: vi.fn(), desktop: vi.fn(), setup: vi.fn(), picker: vi.fn(), preferences: vi.fn(), invoke: vi.fn(), studioReady: Promise.resolve() }));
vi.mock("./backend", () => ({ backend: { bootstrap: mocks.bootstrap } }));
vi.mock("./desktop", () => ({ initializeDesktop: mocks.desktop }));
vi.mock("./setup", () => ({ showSetup: mocks.setup }));
vi.mock("./model-picker", () => ({ initializeModelPicker: mocks.picker }));
vi.mock("./studio.js", () => ({ get studioReady() { return mocks.studioReady; }, initializeStudioFormPreferences: mocks.preferences }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

beforeEach(() => { vi.resetModules(); vi.resetAllMocks(); mountStudio(); mocks.studioReady = Promise.resolve(); });
afterEach(() => { vi.restoreAllMocks(); });

it("keeps the splash until the visible main window has painted twice", async () => {
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.push(callback); return frames.length; });
  mocks.bootstrap.mockResolvedValue({ needs_setup: true });
  const { startApp } = await import("./main");
  const started = startApp(4);
  await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("startup_show_main", { attempt: 4 }));
  expect(mocks.bootstrap).toHaveBeenCalledWith(4);
  expect(mocks.invoke).not.toHaveBeenCalledWith("startup_complete", { attempt: 4 });
  frames.shift()!(0);
  await Promise.resolve();
  expect(mocks.invoke).not.toHaveBeenCalledWith("startup_complete", { attempt: 4 });
  frames.shift()!(16);
  await started;
  expect(mocks.invoke).toHaveBeenLastCalledWith("startup_complete", { attempt: 4 });
});

it("keeps the splash until the first-run wizard has finished initialization", async () => {
  let finish = () => {};
  mocks.bootstrap.mockResolvedValue({ needs_setup: true });
  mocks.setup.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  const { startApp } = await import("./main");
  const started = startApp(1);
  await vi.waitFor(() => expect(mocks.setup).toHaveBeenCalled());
  expect(mocks.invoke).not.toHaveBeenCalled();
  finish(); await started;
  expect(mocks.invoke).toHaveBeenCalledWith("startup_complete", { attempt: 1 });
});

it("waits for the initial library and model picker before revealing the studio", async () => {
  let library = () => {}, picker = () => {};
  mocks.bootstrap.mockResolvedValue({ needs_setup: false });
  mocks.studioReady = new Promise<void>((resolve) => { library = resolve; });
  mocks.picker.mockImplementation(() => new Promise<void>((resolve) => { picker = resolve; }));
  const { startApp } = await import("./main");
  const started = startApp(1);
  await vi.waitFor(() => expect(mocks.bootstrap).toHaveBeenCalled());
  expect(mocks.picker).not.toHaveBeenCalled();
  library();
  await vi.waitFor(() => expect(mocks.picker).toHaveBeenCalled());
  expect(document.querySelector<HTMLElement>("#studio")!.hidden).toBe(true);
  expect(mocks.invoke).not.toHaveBeenCalled();
  picker(); await started;
  expect(document.querySelector<HTMLElement>("#studio")!.hidden).toBe(false);
  expect(mocks.invoke).toHaveBeenCalledWith("startup_complete", { attempt: 1 });
});

it("propagates backend failure without revealing an incomplete main window", async () => {
  mocks.bootstrap.mockRejectedValue(new Error("database unavailable"));
  const { startApp } = await import("./main");
  await expect(startApp(1)).rejects.toThrow("database unavailable");
  expect(mocks.setup).not.toHaveBeenCalled();
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it("waits for saved generation form values before revealing the studio", async () => {
  let restore = () => {};
  mocks.bootstrap.mockResolvedValue({ needs_setup: false });
  mocks.preferences.mockImplementation(() => new Promise<void>((resolve) => { restore = resolve; }));
  const { startApp } = await import("./main");
  const started = startApp(1);
  await vi.waitFor(() => expect(mocks.preferences).toHaveBeenCalled());
  expect(document.querySelector<HTMLElement>("#studio")!.hidden).toBe(true);
  expect(mocks.picker).not.toHaveBeenCalled();
  expect(mocks.invoke).not.toHaveBeenCalled();
  restore(); await started;
  expect(document.querySelector<HTMLElement>("#studio")!.hidden).toBe(false);
  expect(mocks.invoke).toHaveBeenCalledWith("startup_complete", { attempt: 1 });
});
