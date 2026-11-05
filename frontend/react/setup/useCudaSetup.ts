import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { backend } from "../../backend";
import type { Bootstrap, CudaStatus, DownloadProgress } from "../../types";

export function useCudaSetup(hardware: Bootstrap["hardware"], resetFeedback: () => void) {
  const client = useQueryClient();
  const enabled = hardware.platform === "windows" && hardware.gpu.toLowerCase().includes("nvidia") && hardware.cuda?.architecture_supported !== false;
  const key = ["cuda", "status", hardware] as const;
  const status = useQuery({ queryKey: key, queryFn: backend.cudaStatus, enabled, retry: false, networkMode: "always" });
  const progress = useQuery<DownloadProgress | null>({ queryKey: ["cuda", "progress"], queryFn: async () => null, enabled: false }).data;
  const stage = useQuery<string | null>({ queryKey: ["cuda", "stage"], queryFn: async () => null, enabled: false }).data;
  const locked = useRef(false);
  const operation = useMutation({
    mutationKey: ["setup", "cuda"], networkMode: "always", retry: false,
    mutationFn: async (install: boolean) => {
      await client.cancelQueries({ queryKey: key });
      return install ? backend.installCuda() : backend.cudaStatus();
    },
    onError: (error, install) => { if (!install) client.setQueryData<CudaStatus>(key, { state: "check_failed", download_bytes: 0, details: error.message }); },
    onSuccess: (value: CudaStatus) => { client.setQueryData(key, value); },
    onSettled: async (_data, error, install) => {
      if (error && install) await client.refetchQueries({ queryKey: key });
      await client.fetchQuery({ queryKey: ["generation-policy", null], queryFn: () => backend.generationPolicy(undefined, true), staleTime: 0 }).catch(() => {});
      await Promise.all(["setup-estimate", "generation-policy", "health", "models"].map(domain => client.invalidateQueries({ queryKey: [domain] })));
      locked.current = false;
    },
  });
  const run = (install: boolean) => {
    if (locked.current || !enabled || status.isFetching) return;
    if (install && status.data?.state !== "runtime_missing") return;
    locked.current = true;
    resetFeedback();
    client.setQueryData(["cuda", "progress"], null);
    client.setQueryData(["cuda", "stage"], null);
    operation.mutate(install);
  };
  return { enabled, status, operation, run, progress, stage };
}
