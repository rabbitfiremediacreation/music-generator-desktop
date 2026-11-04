import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { backend } from "../../backend";
import type { GenerationFormPreferences, ModelSelection } from "../../types";
import { DEFAULT_PREFERENCES, INITIAL_VALUES, numericValues, type FormValues } from "./form-state";

/** Keep preference writes serial; a failed write retains the latest user edit for explicit retry. */
export function useFormValues(selection: ModelSelection | null) {
  const client = useQueryClient();
  const preferences = useQuery({ queryKey: ["generation-form-preferences"], queryFn: backend.generationFormPreferences, retry: false, networkMode: "always" });
  const policy = useQuery({ queryKey: ["generation-policy", selection], queryFn: () => backend.generationPolicy(selection ?? undefined), retry: false, networkMode: "always" });
  const [values, render] = useState<FormValues>(INITIAL_VALUES), latest = useRef(values);
  const [failed, setFailed] = useState(false), loaded = useRef(false), readFailed = useRef(false), mounted = useRef(true);
  const pending = useRef<GenerationFormPreferences | null>(null), active = useRef<Promise<void> | null>(null), previous = useRef("");
  const readyResolve = useRef<() => void>(() => {}), ready = useRef<Promise<void> | null>(null);
  ready.current ??= new Promise(resolve => { readyResolve.current = resolve; });
  const save = useMutation({ mutationFn: backend.saveGenerationFormPreferences, networkMode: "always", onSuccess: (_, data) => { client.setQueryData(["generation-form-preferences"], data); } });
  const saveRef = useRef(save.mutateAsync); saveRef.current = save.mutateAsync;
  const write = useCallback((): Promise<void> => {
    if (active.current) return active.current;
    active.current = Promise.resolve().then(async () => {
      try {
        while (pending.current) {
          const snapshot = pending.current; pending.current = null;
          try { await saveRef.current(snapshot); if (mounted.current) setFailed(false); }
          catch { pending.current ??= snapshot; if (mounted.current) setFailed(true); return; }
        }
      } finally { active.current = null; }
    });
    return active.current;
  }, []);
  const setValues = useCallback((update: FormValues | ((values: FormValues) => FormValues), force = false) => {
    const next = typeof update === "function" ? update(latest.current) : update;
    latest.current = next; render(next);
    if (!loaded.current) return;
    const numbers = numericValues(next), serialized = JSON.stringify(numbers);
    if (force || serialized !== previous.current) {
      previous.current = serialized; readFailed.current = false; pending.current = numbers; void write();
    }
  }, [write]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; void write(); };
  }, [write]);
  useEffect(() => {
    if (loaded.current || !preferences.isFetched || !policy.isFetched) return;
    const numbers = preferences.data ?? policy.data?.defaults ?? DEFAULT_PREFERENCES;
    latest.current = { ...latest.current, ...numbers }; render(latest.current);
    previous.current = JSON.stringify(numericValues(latest.current)); loaded.current = true;
    readFailed.current = preferences.isError; setFailed(preferences.isError); readyResolve.current();
  }, [preferences.isFetched, preferences.isError, preferences.data, policy.isFetched, policy.data]);
  const flush = useCallback(async () => {
    await ready.current;
    if (readFailed.current) {
      try { await backend.generationFormPreferences(); readFailed.current = false; if (mounted.current) setFailed(false); }
      catch { if (mounted.current) setFailed(true); }
    }
    if (active.current) await active.current;
    if (pending.current) await write();
  }, [write]);
  return { values, setValues, failed, flush, ready: preferences.isFetched && policy.isFetched && loaded.current, policy: policy.data, policyUpdatedAt: policy.dataUpdatedAt, reset: () => setValues(current => ({ ...current, ...(policy.data?.defaults ?? DEFAULT_PREFERENCES) }), true) };
}
