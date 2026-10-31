// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { notifyManager, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { createAppQueryClient, songsQuery } from "./data";
import { EventBridge } from "./events";

const ipc = vi.hoisted(() => ({ listen: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: ipc.listen }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: ipc.invoke, convertFileSrc: (path: string) => path }));
const handlers = new Map<string, (event: { payload: unknown }) => void>();
const stops: ReturnType<typeof vi.fn>[] = [];
const song = (title: string) => [{ id: "one", title, path: null }];

beforeEach(() => {
  vi.useFakeTimers(); handlers.clear(); stops.length = 0;
  notifyManager.setScheduler(callback => { void Promise.resolve().then(callback); });
  ipc.invoke.mockReset().mockResolvedValue(song("First snapshot"));
  ipc.listen.mockReset().mockImplementation(async (name, callback) => {
    handlers.set(name, callback); const off = vi.fn(); stops.push(off); return off;
  });
});
afterEach(() => { cleanup(); notifyManager.setScheduler(callback => { setTimeout(callback, 0); }); vi.useRealTimers(); });

function Probe() {
  const songs = useQuery(songsQuery({}));
  return <><output aria-label="songs">{songs.data?.map(song => song.title).join(",")}</output>{songs.error && <p role="alert">{songs.error.message}</p>}</>;
}
function mount() {
  return render(<QueryClientProvider client={createAppQueryClient()}><EventBridge><Probe /></EventBridge></QueryClientProvider>);
}
async function advance(milliseconds = 0) { await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); }); }
function changed() { act(() => { handlers.get("library-changed")!({ payload: null }); }); }

it("stays idle after the first snapshot while event subscriptions work", async () => {
  mount(); await advance();
  expect(screen.getByLabelText("songs").textContent).toBe("First snapshot");
  expect(handlers.has("generation-progress")).toBe(true);
  await advance(60_000);
  expect(ipc.invoke).toHaveBeenCalledOnce();
});

it("coalesces a burst of library changes into one snapshot after 100 milliseconds", async () => {
  mount(); await advance();
  ipc.invoke.mockResolvedValue(song("After burst"));
  for (let index = 0; index < 20; index++) changed();
  await advance(99); expect(ipc.invoke).toHaveBeenCalledOnce();
  await advance(1);
  expect(ipc.invoke).toHaveBeenCalledTimes(2);
  expect(screen.getByLabelText("songs").textContent).toBe("After burst");
});

it("polls every 1.5 seconds after listener failure and stops polling after reconnecting", async () => {
  ipc.listen.mockRejectedValueOnce(new Error("IPC unavailable"));
  mount(); await advance();
  expect(screen.getByLabelText("songs").textContent).toBe("First snapshot");
  ipc.invoke.mockResolvedValue(song("Recovered snapshot"));
  await advance(1499); expect(ipc.invoke).toHaveBeenCalledOnce();
  await advance(1); expect(ipc.invoke).toHaveBeenCalledTimes(2);
  expect(screen.getByLabelText("songs").textContent).toBe("Recovered snapshot");
  await advance(1500);
  expect(handlers.has("import-progress")).toBe(true);
  const recovered = ipc.invoke.mock.calls.length;
  await advance(30_000); expect(ipc.invoke).toHaveBeenCalledTimes(recovered);
});

it("retries a failed initial snapshot while preserving the visible error until recovery", async () => {
  ipc.invoke.mockRejectedValueOnce(new Error("database busy")).mockResolvedValue(song("Database recovered"));
  mount(); await advance();
  expect(screen.getByRole("alert").textContent).toBe("database busy");
  await advance(1500);
  expect(screen.getByLabelText("songs").textContent).toBe("Database recovered");
  expect(screen.queryByRole("alert")).toBeNull();
  const recovered = ipc.invoke.mock.calls.length;
  await advance(10_000); expect(ipc.invoke).toHaveBeenCalledTimes(recovered);
});

it("refreshes after reconnecting so changes missed between fallback snapshots appear", async () => {
  ipc.listen.mockRejectedValueOnce(new Error("IPC unavailable"));
  mount(); await advance(); await advance(1500);
  ipc.invoke.mockResolvedValue(song("Changed before reconnect"));
  await advance(1500);
  expect(handlers.has("import-progress")).toBe(true);
  expect(screen.getByLabelText("songs").textContent).toBe("Changed before reconnect");
});

it("cancels pending fallback, reconnect and burst timers when unmounted", async () => {
  ipc.listen.mockRejectedValue(new Error("offline"));
  const failed = mount(); await advance(); failed.unmount();
  const reads = ipc.invoke.mock.calls.length, registrations = ipc.listen.mock.calls.length;
  await advance(10_000);
  expect(ipc.invoke).toHaveBeenCalledTimes(reads); expect(ipc.listen).toHaveBeenCalledTimes(registrations);
  ipc.listen.mockImplementation(async (name, callback) => { handlers.set(name, callback); const off = vi.fn(); stops.push(off); return off; });
  const connected = mount(); await advance(); changed(); connected.unmount();
  const snapshots = ipc.invoke.mock.calls.length;
  await advance(1000); expect(ipc.invoke).toHaveBeenCalledTimes(snapshots);
  expect(stops.every(off => off.mock.calls.length === 1)).toBe(true);
});

it("cleans a listener registration that resolves after unmount without starting a snapshot", async () => {
  let finish!: (off: () => void) => void;
  ipc.listen.mockImplementationOnce(async (name, callback) => { handlers.set(name, callback); const off = vi.fn(); stops.push(off); return off; })
    .mockImplementationOnce(() => new Promise<() => void>(resolve => { finish = resolve; }));
  const view = mount(); await advance(); view.unmount();
  const off = vi.fn();
  await act(async () => { finish(off); });
  await advance(10_000);
  expect(off).toHaveBeenCalledOnce(); expect(stops.every(remove => remove.mock.calls.length === 1)).toBe(true);
  expect(ipc.invoke).not.toHaveBeenCalled(); expect(ipc.listen).toHaveBeenCalledTimes(2);
});
