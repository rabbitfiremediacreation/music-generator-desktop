import { useState } from "react";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { backend } from "../../backend";
import type { HuggingFacePin, ModelSelection } from "../../types";
import { invalidateModels } from "./model-state";
import "../../hugging-face-i18n";

export function useModelDialog(selection: ModelSelection | null, selectionRevision: number, onUse: (selection: ModelSelection, before: number) => void) {
  const client = useQueryClient();
  const catalog = useQuery({ queryKey: ["models", "catalog"], queryFn: backend.modelCatalog, networkMode: "always", retry: false, staleTime: 0 });
  const discovery = useQuery({
    queryKey: ["hugging-face-models"], queryFn: backend.discoverHuggingFaceModels, enabled: catalog.isSuccess,
    networkMode: "always", retry: false, staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false,
  });
  const settings = useQuery({ queryKey: ["settings"], queryFn: backend.settings, networkMode: "always", retry: false });
  const [draft, setDraft] = useState(selection), [message, setMessage] = useState("");
  const busy = useIsMutating({ mutationKey: ["models"] }) > 0;
  const invalidate = () => invalidateModels(client);
  const install = useMutation({
    mutationKey: ["models", "install"], networkMode: "always",
    mutationFn: async ({ next, verifyOnly }: { next: ModelSelection; before: number; verifyOnly: boolean }) => {
      if (verifyOnly) {
        await backend.verifyImportedModels(next);
        return null;
      }
      return backend.useModels(next);
    },
    onMutate: () => { setMessage(""); client.setQueryData(["models", "progress"], null); },
    onSuccess: async (selected, { before }) => {
      if (selected) onUse(selected, before);
      setMessage(selected ? "picker_selected" : "provider_import_verified");
      await invalidate();
    },
    onError: invalidate,
  });
  const title = useMutation({
    mutationKey: ["models", "title-download"], mutationFn: backend.downloadTitleModel, networkMode: "always",
    onMutate: () => { setMessage(""); client.setQueryData(["models", "progress"], null); },
    onSuccess: async () => { setMessage("picker_selected"); await invalidate(); }, onError: invalidate,
  });
  const cancel = useMutation({ mutationFn: backend.cancelModelDownload, networkMode: "always" });
  const adopt = useMutation({
    mutationKey: ["models", "hugging-face-adopt"], networkMode: "always",
    mutationFn: ({ pin, draft }: { pin: HuggingFacePin; draft: ModelSelection }) => backend.adoptHuggingFaceModel(pin, draft),
    onSuccess: async (selected) => {
      await invalidate();
      setMessage("");
      setDraft(selected);
    },
  });
  function apply(verifyOnly: boolean) {
    const next = draft || catalog.data?.selection;
    if (next && !busy) install.mutate({ next, before: selectionRevision, verifyOnly });
  }
  return { catalog, discovery, settings, draft: draft || catalog.data?.selection, setDraft, busy, install, title, cancel, adopt, apply, message, setMessage };
}
