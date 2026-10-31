import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { backend } from "../../backend";
import { modelLabel } from "../../expert-mode";
import type { Bootstrap, DownloadProgress, SetupRequest } from "../../types";

/** Setup keeps editable paths separate from debounced estimates and durable settings. */
export function useSetup(bootstrap: Bootstrap, onReady?: () => void) {
  const client = useQueryClient();
  const canUseXl = bootstrap.settings.expert_mode || bootstrap.recommended_profiles.some(profile => profile.synthesis.includes("-xl-"));
  const [draft, setDraft] = useState<SetupRequest>(() => ({
    models_dir: bootstrap.settings.models_dir, songs_dir: bootstrap.settings.songs_dir,
    xl: canUseXl && (bootstrap.settings.dit === "xl" || Boolean(bootstrap.settings.dit_xl_available)),
    lm: bootstrap.settings.lm_model.match(/-(0\.6B|1\.7B|4B)-/)?.[1] || bootstrap.hardware.recommended_lm,
  }));
  const recommended = bootstrap.recommended_profiles.find(profile => profile.synthesis.includes("-xl-") === draft.xl);
  const lm = bootstrap.settings.expert_mode ? draft.lm : recommended ? modelLabel(recommended.language, false) : bootstrap.hardware.recommended_lm;
  const request = { ...draft, lm, models_dir: draft.models_dir.trim(), songs_dir: draft.songs_dir.trim() };
  const [paths, setPaths] = useState(() => ({ models_dir: request.models_dir, songs_dir: request.songs_dir }));
  useEffect(() => {
    const timer = setTimeout(() => setPaths({ models_dir: draft.models_dir.trim(), songs_dir: draft.songs_dir.trim() }), 300);
    return () => clearTimeout(timer);
  }, [draft.models_dir, draft.songs_dir]);
  const debouncing = paths.models_dir !== request.models_dir || paths.songs_dir !== request.songs_dir;
  const unsupported = !bootstrap.settings.expert_mode && !bootstrap.recommended_profiles.length;
  const estimate = useQuery({ queryKey: ["setup-estimate", { ...request, ...paths }], queryFn: () => backend.estimate({ ...request, ...paths }), networkMode: "always", enabled: !unsupported, retry: false });
  const policy = useQuery({ queryKey: ["generation-policy", null], queryFn: () => backend.generationPolicy(), networkMode: "always", retry: false });
  const progress = useQuery<DownloadProgress | null>({ queryKey: ["setup", "progress"], queryFn: async () => null, enabled: false, networkMode: "always" }).data;
  const stage = useQuery<string | null>({ queryKey: ["setup", "stage"], queryFn: async () => null, enabled: false, networkMode: "always" }).data;
  const setup = useMutation({
    mutationKey: ["setup"], networkMode: "always", mutationFn: backend.setup,
    onMutate: () => { cancel.reset(); client.setQueryData(["setup", "progress"], null); client.setQueryData(["setup", "stage"], null); },
    onSuccess: async () => {
      client.setQueryData<Bootstrap>(["bootstrap"], old => old ? { ...old, needs_setup: false, settings: { ...old.settings, setup_complete: true } } : old);
      await Promise.all(["settings", "models", "generation-policy", "songs", "folders", "queue", "health"].map(key => client.invalidateQueries({ queryKey: [key] })));
    },
    onSettled: () => client.invalidateQueries({ queryKey: ["setup-estimate"] }),
  });
  const cancel = useMutation({ mutationFn: backend.cancelSetup, networkMode: "always" });
  const initialized = useRef(false);
  useEffect(() => {
    if (!initialized.current && (!estimate.isPending || unsupported) && !policy.isPending) { initialized.current = true; onReady?.(); }
  }, [estimate.isPending, policy.isPending, unsupported, onReady]);
  return { draft, setDraft, request, canUseXl, unsupported, debouncing, estimate, policy, progress, stage, setup, cancel };
}
