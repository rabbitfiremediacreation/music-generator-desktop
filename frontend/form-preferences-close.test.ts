// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mountStudio } from "./dom-fixture";
const mocks = vi.hoisted(() => ({ generationFormPreferences: vi.fn(), saveGenerationFormPreferences: vi.fn(), queue: vi.fn(), exit: vi.fn(), confirm: vi.fn() }));
vi.mock("./backend", () => ({ backend: mocks }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: mocks.confirm, open: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
const defaults = { duration: 90, bpm: 0, inference_steps: 80, lm_temperature: 1.2, variants: 2 };
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks(); mountStudio();
  mocks.generationFormPreferences.mockResolvedValue({ ...defaults });
  mocks.saveGenerationFormPreferences.mockResolvedValue(undefined);
  mocks.queue.mockResolvedValue({ running: [], queued: 0, active: false });
  mocks.exit.mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllGlobals(); });

it("waits for pending edits before exiting and does not reload when the studio is reopened", async () => {
  let finish!: () => void;
  mocks.saveGenerationFormPreferences.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const preferences = await import("./form-preferences");
  const { requestClose } = await import("./desktop");
  const form = document.querySelector<HTMLFormElement>("#genForm")!;
  const refresh = vi.fn(); await preferences.initializeGenerationFormPreferences(form, refresh);
  const duration = form.elements.namedItem("duration") as HTMLInputElement;
  duration.value = "600"; duration.dispatchEvent(new Event("input", { bubbles: true })); await settle();
  await preferences.initializeGenerationFormPreferences(form, refresh);
  expect(duration.value).toBe("600"); expect(mocks.generationFormPreferences).toHaveBeenCalledOnce();
  const steps = form.elements.namedItem("inference_steps") as HTMLInputElement;
  steps.value = "8"; steps.dispatchEvent(new Event("input", { bubbles: true }));
  const closing = requestClose(); await settle();
  expect(form.inert).toBe(true); expect(mocks.exit).not.toHaveBeenCalled();
  finish(); await closing;
  expect(mocks.saveGenerationFormPreferences).toHaveBeenLastCalledWith({ ...defaults, duration: 600, inference_steps: 8 });
  expect(mocks.exit).toHaveBeenCalledOnce(); expect(form.inert).toBe(false);
});

it("retries a failed save when closing and still permits exit if storage remains unavailable", async () => {
  const preferences = await import("./form-preferences");
  const { requestClose } = await import("./desktop");
  const form = document.querySelector<HTMLFormElement>("#genForm")!;
  await preferences.initializeGenerationFormPreferences(form, vi.fn());
  mocks.saveGenerationFormPreferences.mockRejectedValue(new Error("Disk full"));
  const variants = form.elements.namedItem("variants") as HTMLInputElement;
  variants.value = "9"; variants.dispatchEvent(new Event("input", { bubbles: true })); await settle();
  expect(mocks.saveGenerationFormPreferences).toHaveBeenCalledOnce();
  await requestClose();
  expect(mocks.saveGenerationFormPreferences).toHaveBeenCalledTimes(2);
  expect(mocks.exit).toHaveBeenCalledOnce();
});

it("keeps the form editable if the user cancels closing during generation", async () => {
  const { requestClose } = await import("./desktop");
  mocks.queue.mockResolvedValue({ running: [{ id: "song" }], queued: 0, active: true });
  mocks.confirm.mockResolvedValue(false);
  await requestClose();
  expect(mocks.exit).not.toHaveBeenCalled();
  expect(document.querySelector<HTMLFormElement>("#genForm")!.inert).toBe(false);
});
