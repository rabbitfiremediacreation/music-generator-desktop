import { listen } from "@tauri-apps/api/event";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { stemApi } from "../../stems";

export function useStemCatalog(enabled = true) {
  const client = useQueryClient();
  const [subscribed, setSubscribed] = useState(false);
  useEffect(() => {
    if (!enabled) { setSubscribed(false); return; }
    let active = true;
    const filter = { queryKey: ["stem-models"], exact: true };
    const refresh = async () => {
      await client.cancelQueries(filter);
      await client.invalidateQueries(filter);
    };
    const subscription = listen("stem-models-changed", () => void refresh());
    const ready = () => { if (active) setSubscribed(true); };
    void subscription.then(ready, ready);
    return () => { active = false; void subscription.then(stop => stop(), () => {}); };
  }, [client, enabled]);
  return useQuery({ queryKey: ["stem-models"], queryFn: stemApi.models, enabled: enabled && subscribed, staleTime: 0, networkMode: "always", retry: false });
}

export function useStemJobs(song?: string, source?: string, offset = 0, folder?: string, enabled = true) {
  return useQuery({
    queryKey: ["stem-jobs", song, source, offset, folder], queryFn: () => stemApi.jobs(song, source, offset, folder),
    enabled, refetchInterval: 1500, networkMode: "always", retry: false,
  });
}

export function useStemJob(id?: string) {
  return useQuery({
    queryKey: ["stem-job", id], queryFn: () => stemApi.job(id!), enabled: Boolean(id),
    refetchInterval: query => ["queued", "running"].includes(query.state.data?.status ?? "") ? 500 : false,
    networkMode: "always", retry: false,
  });
}
