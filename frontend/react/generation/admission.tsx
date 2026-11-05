import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { backend } from "../../backend";
import { samplingForSong } from "../../song-sampling";
import type { Generation, GenerationPolicy, Health } from "../../types";
import { DEFAULT_PREFERENCES } from "./form-state";
import { CpuConfirmation } from "./CpuConfirmation";

export type CpuChoice = "reduce" | "continue" | null;
interface Admission { start: (values: Generation, retryId?: string, applyReduced?: () => void) => Promise<{ ids: string[] } | null>; busy: boolean }
const Context = createContext<Admission | null>(null);

/** A shared admission lock covers the form, retries and variants through probing and confirmation. */
export function GenerationAdmissionProvider({ children, settingsBlocked = false }: { children: ReactNode; settingsBlocked?: boolean }) {
  const client = useQueryClient();
  const mutation = useMutation({ networkMode: "always", mutationFn: async ({ request, retryId }: { request: Generation; retryId?: string }) => retryId ? { ids: [(await backend.retry(retryId)).id] } : backend.generate(request) });
  const mutate = useRef(mutation.mutateAsync); mutate.current = mutation.mutateAsync;
  const locked = useRef(false), blocked = useRef(settingsBlocked), mounted = useRef(true);
  blocked.current = settingsBlocked;
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<{ device: GenerationPolicy["backend"]; resolve: (choice: CpuChoice) => void } | null>(null);
  const pending = useRef<((choice: CpuChoice) => void) | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current?.(null); }; }, []);
  const start = useCallback(async (values: Generation, retryId?: string, applyReduced?: () => void) => {
    if (locked.current || blocked.current) return null;
    locked.current = true; setBusy(true);
    try {
      const request = structuredClone(values);
      if (request.inference_steps || request.model_selection) request.inference_steps = samplingForSong(request).inference_steps;
      const healthBefore = client.getQueryData<Health>(["health"]);
      const current = await client.fetchQuery({ queryKey: ["generation-policy", request.model_selection ?? null], queryFn: () => backend.generationPolicy(request.model_selection, true), staleTime: 0, retry: false, networkMode: "always" }).catch((): GenerationPolicy => ({ backend: "unknown", cpu_iteration_behavior: "ask", legacy_inference_steps: 50, recommended_steps: 30, defaults: DEFAULT_PREFERENCES }));
      if (!mounted.current || blocked.current) return null;
      const health = client.getQueryState(["health"])?.status === "error" ? undefined : client.getQueryData<Health>(["health"]);
      const observed = health?.backend_status;
      const confirmed = observed?.state === "running" && observed.synthesis.state === "confirmed" ? observed.synthesis.backend === "cpu" ? "cpu" : ["metal", "cuda", "vulkan"].includes(observed.synthesis.backend) ? "gpu" : undefined : undefined;
      const device = health !== healthBefore ? confirmed ?? current.probed_backend ?? current.backend : current.probed_backend === undefined ? confirmed ?? current.backend : current.backend;
      const steps = request.inference_steps || current.legacy_inference_steps || 50;
      let reduced = false;
      if (device !== "gpu" && steps > 30) {
        const choice = current.cpu_iteration_behavior === "limit_30" ? "reduce" : current.cpu_iteration_behavior === "continue" ? "continue" : await new Promise<CpuChoice>(resolve => {
          pending.current = resolve;
          setConfirmation({ device, resolve: choice => { pending.current = null; setConfirmation(null); resolve(choice); } });
        });
        if (!choice || !mounted.current || blocked.current) return null;
        if (choice === "reduce") { request.inference_steps = 30; reduced = true; if (!retryId) applyReduced?.(); }
      }
      if (!mounted.current || blocked.current) return null;
      if (retryId && reduced) { request.variants = 1; delete request.group_id; }
      const result = await mutate.current({ request, retryId: retryId && !reduced ? retryId : undefined });
      await Promise.all([client.invalidateQueries({ queryKey: ["songs"] }), client.invalidateQueries({ queryKey: ["queue"] }), client.invalidateQueries({ queryKey: ["folders"] })]);
      return result;
    } finally { locked.current = false; if (mounted.current) setBusy(false); }
  }, [client]);
  return <Context.Provider value={{ start, busy }}>{children}{confirmation && <CpuConfirmation device={confirmation.device} onChoice={confirmation.resolve} />}</Context.Provider>;
}

export function useGenerationAdmission(): Admission {
  const value = useContext(Context);
  if (!value) throw new Error("GenerationAdmissionProvider is required");
  return value;
}
