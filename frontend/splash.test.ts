// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import html from "./splash.html?raw";
import type { StartupStatus } from "./splash-view";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));

beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks(); vi.useFakeTimers();
  localStorage.setItem("ui_lang", "de");
  document.body.innerHTML = html.match(/<body>([\s\S]*)<\/body>/)![1].replace(/<script\b[\s\S]*?<\/script>/g, "");
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { callback(0); return 0; });
  mocks.invoke.mockImplementation(async name => name === "startup_status" ? { attempt: 1, sequence: 1, phase: "installation_required", error: null } : undefined);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("uses the current attempt when an event arrives before an older snapshot", async () => {
  let update = (_event: { payload: StartupStatus }) => {};
  mocks.listen.mockImplementation(async (_name, listener) => {
    update = listener;
    update({ payload: { attempt: 2, sequence: 4, phase: "starting", error: null } });
    return () => {};
  });
  await import("./splash");
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.invoke).toHaveBeenCalledWith("splash_ready", { attempt: 2 });
  update({ payload: { attempt: 2, sequence: 5, phase: "error", error: "database locked" } });
  document.querySelector<HTMLButtonElement>("#splashRetry")!.click();
  expect(mocks.invoke).toHaveBeenCalledWith("retry_startup", { attempt: 2 });
});

it("can recover from local IPC failures without hiding newer backend events", async () => {
  let update = (_event: { payload: StartupStatus }) => {};
  mocks.listen.mockImplementation(async (_name, listener) => { update = listener; return () => {}; });
  mocks.invoke.mockImplementation(async name => {
    if (name === "startup_status") return { attempt: 3, sequence: 1, phase: "starting", error: null };
    if (name === "splash_ready" || name === "retry_startup" || name === "startup_error") throw new Error("IPC unavailable");
  });
  await import("./splash");
  await vi.advanceTimersByTimeAsync(0);
  expect(document.querySelector<HTMLElement>("#splashRetry")!.hidden).toBe(false);
  expect(mocks.invoke).toHaveBeenCalledWith("startup_error", { attempt: 3, error: "IPC unavailable" });
  document.querySelector<HTMLButtonElement>("#splashRetry")!.click();
  await vi.advanceTimersByTimeAsync(0);
  update({ payload: { attempt: 3, sequence: 2, phase: "hardware", error: null } });
  expect(document.querySelector("#splashStatus")!.textContent).toBe("Hardware wird erkannt…");
  expect(document.querySelector<HTMLElement>("#splashRetry")!.hidden).toBe(true);
});

it("reports an event-connection failure after resolving the current attempt", async () => {
  mocks.listen.mockRejectedValue(new Error("event connection unavailable"));
  mocks.invoke.mockImplementation(async name => name === "startup_status" ? { attempt: 5, sequence: 1, phase: "starting", error: null } : undefined);
  await import("./splash");
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.invoke).toHaveBeenCalledWith("startup_error", { attempt: 5, error: "event connection unavailable" });
  expect(mocks.invoke).not.toHaveBeenCalledWith("splash_ready", { attempt: 5 });
  expect(document.querySelector<HTMLElement>("#splashRetry")!.hidden).toBe(false);
});

it("cannot acknowledge a replacement attempt from an older pending frame", async () => {
  const frames: FrameRequestCallback[] = [];
  vi.mocked(window.requestAnimationFrame).mockImplementation(callback => { frames.push(callback); return frames.length; });
  let update = (_event: { payload: StartupStatus }) => {};
  mocks.listen.mockImplementation(async (_name, listener) => { update = listener; return () => {}; });
  mocks.invoke.mockImplementation(async name => name === "startup_status" ? { attempt: 1, sequence: 1, phase: "starting", error: null } : undefined);
  await import("./splash");
  await vi.advanceTimersByTimeAsync(0);
  update({ payload: { attempt: 2, sequence: 2, phase: "starting", error: null } });
  frames.shift()!(0);
  frames.shift()!(16);
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.invoke).toHaveBeenCalledWith("splash_ready", { attempt: 1 });
  expect(mocks.invoke).not.toHaveBeenCalledWith("splash_ready", { attempt: 2 });
});

it("ignores a late readiness failure from a superseded attempt", async () => {
  let update = (_event: { payload: StartupStatus }) => {};
  let rejectReady = (_error: Error) => {};
  mocks.listen.mockImplementation(async (_name, listener) => { update = listener; return () => {}; });
  mocks.invoke.mockImplementation(async name => {
    if (name === "startup_status") return { attempt: 1, sequence: 1, phase: "starting", error: null };
    if (name === "splash_ready") return new Promise((_resolve, reject) => { rejectReady = reject; });
  });
  await import("./splash");
  await vi.advanceTimersByTimeAsync(0);
  update({ payload: { attempt: 2, sequence: 2, phase: "starting", error: null } });
  rejectReady(new Error("old transport failure"));
  await vi.advanceTimersByTimeAsync(0);
  expect(document.body.dataset.failed).toBe("false");
  expect(mocks.invoke).not.toHaveBeenCalledWith("startup_error", { attempt: 2, error: "old transport failure" });
});

it("ignores an old event-connection failure after a replacement attempt arrives", async () => {
  let update = (_event: { payload: StartupStatus }) => {};
  let rejectListen = (_error: Error) => {};
  mocks.listen.mockImplementation((_name, listener) => {
    update = listener;
    return new Promise((_resolve, reject) => { rejectListen = reject; });
  });
  mocks.invoke.mockImplementation(async name => name === "startup_status" ? { attempt: 1, sequence: 1, phase: "starting", error: null } : undefined);
  await import("./splash");
  await vi.advanceTimersByTimeAsync(0);
  update({ payload: { attempt: 2, sequence: 2, phase: "starting", error: null } });
  rejectListen(new Error("old event-connection failure"));
  await vi.advanceTimersByTimeAsync(0);
  expect(document.body.dataset.failed).toBe("false");
  expect(mocks.invoke).not.toHaveBeenCalledWith("startup_error", { attempt: 2, error: "old event-connection failure" });
});

it("ignores a late quit failure after a new attempt has started", async () => {
  let update = (_event: { payload: StartupStatus }) => {};
  let rejectExit = (_error: Error) => {};
  mocks.listen.mockImplementation(async (_name, listener) => { update = listener; return () => {}; });
  mocks.invoke.mockImplementation(async name => {
    if (name === "startup_status") return { attempt: 1, sequence: 1, phase: "starting", error: null };
    if (name === "exit_app") return new Promise((_resolve, reject) => { rejectExit = reject; });
  });
  await import("./splash");
  await vi.advanceTimersByTimeAsync(0);
  document.querySelector<HTMLButtonElement>("#splashClose")!.click();
  update({ payload: { attempt: 2, sequence: 2, phase: "starting", error: null } });
  rejectExit(new Error("old exit failure"));
  await vi.advanceTimersByTimeAsync(0);
  expect(document.body.dataset.failed).toBe("false");
  expect(mocks.invoke).not.toHaveBeenCalledWith("startup_error", { attempt: 2, error: "old exit failure" });
});

it.each([["starting", null], ["error", "new reload failure"]] as const)("preserves the replacement attempt's %s status when retry transport fails", async (phase, error) => {
  let update = (_event: { payload: StartupStatus }) => {};
  let rejectRetry = (_error: Error) => {};
  let status: StartupStatus = { attempt: 1, sequence: 1, phase: "error", error: "first failure" };
  mocks.listen.mockImplementation(async (_name, listener) => { update = listener; return () => {}; });
  mocks.invoke.mockImplementation(async name => {
    if (name === "startup_status") return status;
    if (name === "retry_startup") return new Promise((_resolve, reject) => { rejectRetry = reject; });
  });
  await import("./splash");
  await vi.advanceTimersByTimeAsync(0);
  document.querySelector<HTMLButtonElement>("#splashRetry")!.click();
  status = { attempt: 2, sequence: 2, phase, error };
  if (phase === "starting") update({ payload: status });
  rejectRetry(new Error("old retry transport failure"));
  await vi.advanceTimersByTimeAsync(0);
  expect(document.body.dataset.failed).toBe(String(error !== null));
  expect(document.querySelector("#splashDiagnostic")!.textContent).toBe(error ?? "");
  expect(mocks.invoke).not.toHaveBeenCalledWith("startup_error", { attempt: 2, error: "old retry transport failure" });
});

it("keeps the slow-start hint hidden and quits through either visible control", async () => {
  await import("./splash");
  await vi.advanceTimersByTimeAsync(16000);
  expect(document.querySelector<HTMLElement>("#splashSlow")!.hidden).toBe(true);
  expect(document.querySelector<HTMLElement>("#splashQuit")!.hidden).toBe(false);
  for (const id of ["#splashQuit", "#splashClose"]) {
    mocks.invoke.mockClear();
    document.querySelector<HTMLButtonElement>(id)!.click();
    expect(mocks.invoke).toHaveBeenCalledWith("exit_app");
  }
});
