import { useState } from "react";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { backend } from "../../backend";
import type { ModelSelection } from "../../types";
import { invalidateModels } from "./model-state";

export function useModelDialog(selection: ModelSelection | null, selectionRevision: number, onUse: (selection: ModelSelection, before: number) => void) {
  const client = useQueryClient();
  const catalog = useQuery({ queryKey: ["models", "catalog"], queryFn: backend.modelCatalog, networkMode: "always", retry: false, staleTime: 0 });
  const settings = useQuery({ queryKey: ["settings"], queryFn: backend.settings, networkMode: "always", retry: false });
  const [draft, setDraft] = useState(selection), [message, setMessage] = useState("");
  const busy = useIsMutating({ mutationKey: ["models"] }) > 0;
  const invalidate = () => invalidateModels(client);
  const install = useMutation({
    mutationKey: ["models", "install"], networkMode: "always",
    mutationFn: async ({ next }: { next: ModelSelection; before: number }) => backend.useModels(next),
    onMutate: () => { setMessage(""); client.setQueryData(["models", "progress"], null); },
    onSuccess: async (selected, { before }) => { onUse(selected, before); setMessage("picker_selected"); await invalidate(); },
    onError: invalidate,
  });
  const title = useMutation({
    mutationKey: ["models", "title-download"], mutationFn: backend.downloadTitleModel, networkMode: "always",
    onMutate: () => { setMessage(""); client.setQueryData(["models", "progress"], null); },
    onSuccess: async () => { setMessage("picker_selected"); await invalidate(); }, onError: invalidate,
  });
  const cancel = useMutation({ mutationFn: backend.cancelModelDownload, networkMode: "always" });
  function apply() {
    const next = draft || catalog.data?.selection;
    if (next && !busy) install.mutate({ next, before: selectionRevision });
  }
  return { catalog, settings, draft: draft || catalog.data?.selection, setDraft, busy, install, title, cancel, apply, message, setMessage };
}
