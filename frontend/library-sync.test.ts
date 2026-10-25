import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const listen = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/event", () => ({ listen }));
import { startLibrarySync } from "./library-sync";

const settle = async () => { await vi.advanceTimersByTimeAsync(0); };
const subscriptions = new Map<string, (event: { payload?: unknown }) => void>();
const unlisten = vi.fn();

beforeEach(() => {
  vi.useFakeTimers(); subscriptions.clear(); unlisten.mockReset(); listen.mockReset();
  listen.mockImplementation(async (name, callback) => { subscriptions.set(name, callback); return unlisten; });
});
afterEach(() => { vi.useRealTimers(); });

describe("live library synchronization", () => {
  it("subscribes before loading and stays idle without library polling", async () => {
    const load = vi.fn(async () => { expect(subscriptions.size).toBe(2); });
    const progress = vi.fn();
    const sync = startLibrarySync(load, progress);
    await settle();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(load).toHaveBeenCalledTimes(1);
    subscriptions.get("generation-progress")!({ payload: { job_id: "one", step: 3 } });
    expect(progress).toHaveBeenCalledWith({ job_id: "one", step: 3 });
    expect(load).toHaveBeenCalledTimes(1);
    subscriptions.get("library-changed")!({});
    await vi.advanceTimersByTimeAsync(100);
    expect(load).toHaveBeenCalledTimes(2);
    sync.stop(); expect(unlisten).toHaveBeenCalledTimes(2);
  });

  it("coalesces event bursts and catches changes arriving during a snapshot", async () => {
    let finish: () => void = () => {};
    const load = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; })).mockResolvedValue(undefined);
    const sync = startLibrarySync(load, vi.fn());
    await settle();
    for (let i = 0; i < 20; i++) subscriptions.get("library-changed")!({});
    await vi.advanceTimersByTimeAsync(100);
    expect(load).toHaveBeenCalledTimes(1);
    finish(); await settle();
    expect(load).toHaveBeenCalledTimes(2);
    sync.stop();
  });

  it("polls after listener failure, reconnects, then stops polling", async () => {
    listen.mockRejectedValueOnce(new Error("IPC unavailable"));
    const load = vi.fn().mockResolvedValue(undefined);
    const sync = startLibrarySync(load, vi.fn());
    await settle(); expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1500); expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1500);
    const recovered = load.mock.calls.length;
    expect(listen).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(30_000); expect(load).toHaveBeenCalledTimes(recovered);
    sync.stop();
  });

  it("retries failed snapshots and cancels pending reconnects on teardown", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("database busy")).mockResolvedValue(undefined);
    const sync = startLibrarySync(load, vi.fn());
    await settle(); await vi.advanceTimersByTimeAsync(1500);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000); expect(load).toHaveBeenCalledTimes(2);
    sync.stop();
    listen.mockRejectedValue(new Error("offline"));
    const retry = startLibrarySync(load, vi.fn());
    await settle(); retry.stop();
    const calls = listen.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000); expect(listen).toHaveBeenCalledTimes(calls);
  });
});

it("exposes readiness only after the initial library snapshot", async () => {
  let finish = () => {};
  const sync = startLibrarySync(() => new Promise<void>((resolve) => { finish = resolve; }), vi.fn());
  const ready = vi.fn();
  void sync.ready.then(ready);
  await settle(); expect(ready).not.toHaveBeenCalled();
  finish(); await settle(); expect(ready).toHaveBeenCalledTimes(1);
  sync.stop();
});

it("reports the initial snapshot failure to startup while background retries remain available", async () => {
  const sync = startLibrarySync(vi.fn().mockRejectedValue(new Error("database busy")), vi.fn());
  const result = expect(sync.ready).rejects.toThrow("database busy");
  await settle(); await result; sync.stop();
});
