import { QueryClient, queryOptions } from "@tanstack/react-query";
import { backend } from "../backend";
import type { Filter, GenerationPolicy, Health, ModelSelection } from "../types";

export const queryKeys = {
  bootstrap: ["bootstrap"] as const,
  settings: ["settings"] as const,
  songs: (filter?: Filter) => filter === undefined ? ["songs"] as const : ["songs", filter] as const,
  song: (id: string) => ["song", id] as const,
  folders: ["folders"] as const,
  queue: ["queue"] as const,
  models: ["models", "catalog"] as const,
  policy: (selection?: ModelSelection | null) => ["generation-policy", selection ?? null] as const,
  preferences: ["generation-form-preferences"] as const,
  health: ["health"] as const,
  progress: ["generation-progress"] as const,
};

export function createAppQueryClient() {
  const client = new QueryClient({ defaultOptions: {
    queries: { networkMode: "always", retry: false, staleTime: Infinity, refetchOnWindowFocus: false },
    mutations: { networkMode: "always", retry: false },
  } });
  backendEvidence(client);
  return client;
}

export const bootstrapQuery = () => queryOptions({ queryKey: queryKeys.bootstrap, queryFn: backend.bootstrap, gcTime: Infinity });
export const settingsQuery = () => queryOptions({ queryKey: queryKeys.settings, queryFn: backend.settings });
export const songsQuery = (filter: Filter) => queryOptions({ queryKey: queryKeys.songs(filter), queryFn: () => backend.songs(filter) });
export const foldersQuery = () => queryOptions({ queryKey: queryKeys.folders, queryFn: backend.folders });
export const queueQuery = () => queryOptions({ queryKey: queryKeys.queue, queryFn: backend.queue });

export async function invalidateLibrary(client: QueryClient) {
  await Promise.all([queryKeys.songs(), ["song"], queryKeys.folders, queryKeys.queue].map(queryKey => client.invalidateQueries({ queryKey })));
}

interface BackendEvidence {
  policyVersion: number;
  healthRevision: number;
  latestPolicyRequest: number;
  policyStarts: Map<string, { healthRevision: number; request: number }>;
}
const evidenceByClient = new WeakMap<QueryClient, BackendEvidence>();
const emptyHealth = (): Health => ({ ok: true, backend_status: {
  state: "not_started",
  synthesis: { state: "not_started", backend: "unknown", device: null, reason: null },
  language_model: { state: "not_started", backend: "unknown", device: null, reason: null },
} });

/** Authoritative policy snapshots supersede earlier health requests, but retain newer execution evidence. */
function backendEvidence(client: QueryClient): BackendEvidence {
  const existing = evidenceByClient.get(client);
  if (existing) return existing;
  const evidence: BackendEvidence = { policyVersion: 0, healthRevision: 0, latestPolicyRequest: 0, policyStarts: new Map() };
  evidenceByClient.set(client, evidence);
  client.getQueryCache().subscribe(event => {
    if (event.type !== "updated") return;
    const domain = event.query.queryKey[0];
    if (domain === "health" && (event.action.type === "success" || event.action.type === "error")) evidence.healthRevision++;
    if (domain !== "generation-policy") return;
    if (event.action.type === "fetch") {
      evidence.policyStarts.set(event.query.queryHash, { healthRevision: evidence.healthRevision, request: ++evidence.latestPolicyRequest });
      return;
    }
    if (event.action.type !== "success" || event.action.manual) return;
    const policy = event.query.state.data as GenerationPolicy | undefined;
    if (policy?.probed_backend === undefined) return;
    const start = evidence.policyStarts.get(event.query.queryHash);
    if (start && start.request !== evidence.latestPolicyRequest) return;
    evidence.policyVersion++;
    if (start && start.healthRevision !== evidence.healthRevision) {
      const health = client.getQueryState(queryKeys.health);
      const status = health?.status === "success" ? (health.data as Health | undefined)?.backend_status : undefined;
      const component = status?.state === "running" && status.synthesis.state === "confirmed" ? status.synthesis : undefined;
      const observed = component?.backend === "cpu" ? "cpu" : component && ["metal", "cuda", "vulkan"].includes(component.backend) ? "gpu" : undefined;
      const backend = observed ?? policy.probed_backend;
      if (backend !== policy.backend) client.setQueryData(event.query.queryKey, { ...policy, backend });
      return;
    }
    client.setQueryData<Health>(queryKeys.health, policy.backend_status ? { ok: true, backend_status: policy.backend_status } : emptyHealth());
  });
  return evidence;
}

export function healthQuery(client: QueryClient) {
  const evidence = backendEvidence(client);
  return queryOptions({ queryKey: queryKeys.health, queryFn: async () => {
    const version = evidence.policyVersion;
    try {
      const result = await backend.health();
      return version === evidence.policyVersion ? result : client.getQueryData<Health>(queryKeys.health) ?? emptyHealth();
    } catch (error) {
      if (version !== evidence.policyVersion) return client.getQueryData<Health>(queryKeys.health) ?? emptyHealth();
      throw error;
    }
  } });
}
