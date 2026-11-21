import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { stemApi, stemError, type HubHit, type ModelRemoval, type Pin } from "../../stems";
import { useI18n } from "../i18n";
import { useStemCatalog } from "./data";

interface Progress { file: string; phase: string; downloaded: number; total: number; bytes_per_second: number }
interface PendingRemoval { pin: Pin; impact: ModelRemoval }

export type StemModelManager = ReturnType<typeof useStemModelManager>;

/** Keep transfer and revision actions shared by the inventory and catalog. */
export function useStemModelManager(active = true) {
  const { t } = useI18n();
  const catalog = useStemCatalog(active);
  const lock = useRef(false);
  const [working, setWorking] = useState(false);
  const transfer = catalog.data?.models.find(model => model.status === "installing")?.id;
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState("");
  const [removal, setRemoval] = useState<PendingRemoval>();
  const [updates, setUpdates] = useState<Record<string, HubHit>>({});

  const listenForProgress = active || working;
  useEffect(() => {
    if (!listenForProgress) return;
    const subscription = listen<Progress | null>("stem-download-progress", event => setProgress(event.payload));
    return () => { void subscription.then(stop => stop(), () => {}); };
  }, [listenForProgress]);

  async function run(action: () => Promise<unknown>) {
    if (lock.current) return;
    lock.current = true;
    setWorking(true);
    setError("");
    setProgress(null);
    try { await action(); }
    catch (cause) {
      const message = stemError(cause, t);
      if (message !== "Operation cancelled") setError(message);
    } finally {
      await catalog.refetch();
      setWorking(false);
      setProgress(null);
      lock.current = false;
    }
  }

  return {
    catalog, working: working || Boolean(transfer), transfer, progress, error, removal, updates, run,
    install: (pin: Pin) => void run(() => stemApi.installModel(pin)),
    activate: (pin: Pin) => void run(() => stemApi.activate(pin)),
    checkUpdate: (id: string) => void run(async () => {
      const revision = await stemApi.checkUpdate(id);
      setUpdates(previous => ({ ...previous, [id]: revision }));
    }),
    inspectRemoval: (pin: Pin) => void run(async () => setRemoval({ pin, impact: await stemApi.removal(pin) })),
    cancelRemoval: () => setRemoval(undefined),
    confirmRemoval: (pin: Pin) => void run(async () => { await stemApi.remove(pin); setRemoval(undefined); }),
  };
}
