import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { JobProgress } from "./types";

// Subscribe before the initial snapshot and serialize refreshes so events cannot be lost in flight.
export function startLibrarySync(load: () => Promise<void>, progress: (value: JobProgress) => void) {
  let stopped = false, connected = false, loading = false, pending = false, failed = false;
  let fallback: ReturnType<typeof setTimeout> | undefined;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let changed: ReturnType<typeof setTimeout> | undefined;
  let listeners: UnlistenFn[] = [];
  let firstSnapshot = true;
  let resolveReady: () => void;
  let rejectReady: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // Existing callers can use background synchronization without awaiting initial readiness.
  void ready.catch(() => {});

  function scheduleFallback() {
    clearTimeout(fallback);
    if (!stopped && (!connected || failed)) fallback = setTimeout(refresh, 1500);
  }

  async function drain() {
    if (loading || stopped) return;
    loading = true;
    while (pending && !stopped) {
      pending = false;
      try { await load(); failed = false; if (firstSnapshot) resolveReady(); }
      catch (error) { failed = true; if (firstSnapshot) rejectReady(error); }
      firstSnapshot = false;
    }
    loading = false;
    scheduleFallback();
  }

  function refresh() {
    if (stopped) return;
    pending = true;
    void drain();
  }

  async function connect() {
    const attached: UnlistenFn[] = [];
    try {
      attached.push(await listen("library-changed", () => {
        if (!changed) changed = setTimeout(() => { changed = undefined; refresh(); }, 100);
      }));
      attached.push(await listen<JobProgress>("generation-progress", ({ payload }) => progress(payload)));
      if (stopped) { attached.forEach((off) => off()); return; }
      listeners = attached;
      connected = true;
    } catch {
      attached.forEach((off) => off());
      if (!stopped) reconnect = setTimeout(() => { void connect(); }, 3000);
    }
    refresh();
  }

  void connect();
  return {
    ready,
    refresh,
    stop() {
      stopped = true;
      clearTimeout(fallback); clearTimeout(reconnect); clearTimeout(changed);
      listeners.forEach((off) => off()); listeners = [];
    },
  };
}
