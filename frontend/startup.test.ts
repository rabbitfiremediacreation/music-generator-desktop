// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { mountStudio } from "./dom-fixture";
const mocks = vi.hoisted(() => ({ bootstrap: vi.fn(), desktop: vi.fn(), setup: vi.fn(), picker: vi.fn(), preferences: vi.fn(), invoke: vi.fn(), studioReady: Promise.resolve() }));
vi.mock("./backend", () => ({ backend: { bootstrap: mocks.bootstrap } }));
vi.mock("./desktop", () => ({ initializeDesktop: mocks.desktop }));
vi.mock("./setup", () => ({ showSetup: mocks.setup }));
vi.mock("./model-picker", () => ({ initializeModelPicker: mocks.picker }));
vi.mock("./studio.js", () => ({ get studioReady() { return mocks.studioReady; }, initializeStudioFormPreferences: mocks.preferences }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

beforeEach(() => { vi.resetModules(); vi.resetAllMocks(); mountStudio(); mocks.studioReady = Promise.resolve(); });

it("keeps the splash until the first-run wizard has finished initialization", async () => {
  let finish = () => {};
  mocks.bootstrap.mockResolvedValue({ needs_setup: true });
  mocks.setup.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  const { startApp } = await import("./main");
  const started = startApp();
  await vi.waitFor(() => expect(mocks.setup).toHaveBeenCalled());
  expect(mocks.invoke).not.toHaveBeenCalled();
  finish(); await started;
  expect(mocks.invoke).toHaveBeenCalledWith("startup_complete");
});

it("waits for the initial library and model picker before revealing the studio", async () => {
  let library = () => {}, picker = () => {};
  mocks.bootstrap.mockResolvedValue({ needs_setup: false });
  mocks.studioReady = new Promise<void>((resolve) => { library = resolve; });
  mocks.picker.mockImplementation(() => new Promise<void>((resolve) => { picker = resolve; }));
  const { startApp } = await import("./main");
  const started = startApp();
  await vi.waitFor(() => expect(mocks.bootstrap).toHaveBeenCalled());
  expect(mocks.picker).not.toHaveBeenCalled();
  library();
  await vi.waitFor(() => expect(mocks.picker).toHaveBeenCalled());
  expect(document.querySelector<HTMLElement>("#studio")!.hidden).toBe(true);
  expect(mocks.invoke).not.toHaveBeenCalled();
  picker(); await started;
  expect(document.querySelector<HTMLElement>("#studio")!.hidden).toBe(false);
  expect(mocks.invoke).toHaveBeenCalledWith("startup_complete");
});

it("propagates backend failure without revealing an incomplete main window", async () => {
  mocks.bootstrap.mockRejectedValue(new Error("database unavailable"));
  const { startApp } = await import("./main");
  await expect(startApp()).rejects.toThrow("database unavailable");
  expect(mocks.setup).not.toHaveBeenCalled();
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it("waits for saved generation form values before revealing the studio", async () => {
  let restore = () => {};
  mocks.bootstrap.mockResolvedValue({ needs_setup: false });
  mocks.preferences.mockImplementation(() => new Promise<void>((resolve) => { restore = resolve; }));
  const { startApp } = await import("./main");
  const started = startApp();
  await vi.waitFor(() => expect(mocks.preferences).toHaveBeenCalled());
  expect(document.querySelector<HTMLElement>("#studio")!.hidden).toBe(true);
  expect(mocks.picker).not.toHaveBeenCalled();
  expect(mocks.invoke).not.toHaveBeenCalled();
  restore(); await started;
  expect(document.querySelector<HTMLElement>("#studio")!.hidden).toBe(false);
  expect(mocks.invoke).toHaveBeenCalledWith("startup_complete");
});
