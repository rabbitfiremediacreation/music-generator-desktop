import { useQuery } from "@tanstack/react-query";
import { backend } from "../../backend";
import { creatorOptions, profileKey } from "../../creator-models";
import type { ModelSelection, Settings } from "../../types";

/** Remix submits an eligible model with each job, independently of the Create default. */
export function useRemixModels(active: boolean, choice: ModelSelection | undefined, creation: ModelSelection | null, settings: Settings) {
  const catalog = useQuery({
    queryKey: ["models", "catalog"], queryFn: backend.modelCatalog, networkMode: "always", retry: false, enabled: active,
  });
  const recommended = settings.recommended_profiles ?? [];
  const preferred = [choice, creation, settings.model_profiles?.["ace-step"], ...recommended]
    .find(selection => selection?.provider === "ace-step") ?? undefined;
  const options = catalog.data
    ? creatorOptions({
      ...catalog.data, recommended_profiles: settings.recommended_profiles ?? catalog.data.recommended_profiles,
      expert_mode: settings.expert_mode,
    }, preferred).filter(option => option.selection.provider === "ace-step")
    : [];
  const selection = (preferred && options.find(option => option.value === profileKey(preferred))?.selection) ?? options[0]?.selection;
  return { options, selection, loading: catalog.isPending, error: catalog.error, retry: catalog.refetch };
}
