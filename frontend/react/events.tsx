import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { JobProgress, Queue } from "../types";
import { queryKeys } from "./data";

/** Own subscriptions for the window, including registrations resolving after teardown. */
export function EventBridge({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let stopped = false, connected = false, refreshing = false, pending = false, failed = false;
    let initialized = false;
    let listeners: UnlistenFn[] = [];
    let changed: ReturnType<typeof setTimeout> | undefined;
    let fallback: ReturnType<typeof setTimeout> | undefined;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    const library = (key: readonly unknown[]) => ["songs", "song", "folders", "queue"].includes(String(key[0]));
    const recordProgress = (value: JobProgress) => client.setQueryData<Record<string, JobProgress>>(queryKeys.progress, previous => {
      if ((previous?.[value.job_id]?.sequence ?? -1) >= value.sequence) return previous;
      return { ...previous, [value.job_id]: value };
    });
    const unsubscribe = client.getQueryCache().subscribe(event => {
      if (event.type === "updated" && library(event.query.queryKey)) {
        failed = client.getQueryCache().findAll({ predicate: query => library(query.queryKey) && query.getObserversCount() > 0 && query.state.status === "error" }).length > 0;
        scheduleFallback();
      }
      if (event.type !== "updated" || event.query.queryKey[0] !== "queue" || event.query.state.status !== "success") return;
      const queue = event.query.state.data as Queue;
      if (!queue?.running) return;
      if (queue.progress) recordProgress(queue.progress);
      client.setQueryData<Record<string, JobProgress>>(queryKeys.progress, previous => Object.fromEntries(
        Object.entries(previous ?? {}).filter(([id]) => queue.running.some(song => song.id === id)),
      ));
    });
    function scheduleFallback() {
      clearTimeout(fallback);
      if (!stopped && (!connected || failed)) fallback = setTimeout(refresh, 1500);
    }
    async function refresh() {
      if (stopped) return;
      pending = true;
      if (refreshing) return;
      refreshing = true;
      try {
        while (pending && !stopped) {
          pending = false;
          const fetching = client.getQueryCache().findAll({ predicate: query => library(query.queryKey) && query.state.fetchStatus === "fetching" }).length > 0;
          if (fetching) await client.refetchQueries({ type: "active", predicate: query => library(query.queryKey) }, { cancelRefetch: false });
          if (!stopped) await client.invalidateQueries({ predicate: query => library(query.queryKey) }, { cancelRefetch: false, throwOnError: true });
        }
      } catch { failed = true; }
      finally { refreshing = false; scheduleFallback(); }
    }
    const invalidate = (keys: string[]) => { keys.forEach(key => { void client.invalidateQueries({ queryKey: [key] }); }); };
    const scheduleReconnect = () => {
      clearTimeout(reconnect);
      if (!stopped) reconnect = setTimeout(() => { void connect(); }, 3000);
    };
    async function connect() {
      const attached: UnlistenFn[] = [];
      const handlers: [string, (payload: unknown) => void][] = [
        ["library-changed", () => { if (!changed) changed = setTimeout(() => { changed = undefined; void refresh(); }, 100); }],
        ["generation-progress", payload => recordProgress(payload as JobProgress)],
        ["settings-changed", () => invalidate(["settings", "generation-policy", "health", "models"])],
        ["models-changed", () => invalidate(["settings", "models", "generation-policy", "health"])],
        ["setup-progress", payload => { client.setQueryData(["setup", "progress"], payload); }],
        ["setup-stage", payload => { client.setQueryData(["setup", "stage"], payload); }],
        ["model-download-progress", payload => { client.setQueryData(["models", "progress"], payload); }],
        ["import-progress", payload => { client.setQueryData(["import", "progress"], payload); }],
      ];
      try {
        for (const [name, handler] of handlers) {
          const off = await listen(name, ({ payload }) => { if (!stopped) handler(payload); });
          if (stopped) { off(); attached.forEach(remove => remove()); return; }
          attached.push(off);
        }
        listeners.forEach(off => off()); listeners = attached; connected = true;
        scheduleFallback(); clearTimeout(reconnect);
      } catch {
        attached.forEach(off => off()); connected = false; scheduleReconnect(); scheduleFallback();
      }
      if (!stopped) { setReady(true); if (initialized && connected) void refresh(); initialized = true; }
    }
    const onFocus = () => { void refresh(); invalidate(["health"]); };
    window.addEventListener("focus", onFocus);
    void connect();
    return () => {
      stopped = true; unsubscribe();
      clearTimeout(changed); clearTimeout(fallback); clearTimeout(reconnect);
      listeners.forEach(off => off());
      window.removeEventListener("focus", onFocus);
    };
  }, [client]);
  return ready ? children : null;
}
