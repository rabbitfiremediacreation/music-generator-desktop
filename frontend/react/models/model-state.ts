import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { backend } from "../../backend";

/** Model configuration changes refresh both choices and their observed execution policy. */
export async function invalidateModels(client: QueryClient) {
  await Promise.all(["settings", "models", "generation-policy", "health", "queue"].map(key => client.invalidateQueries({ queryKey: [key] })));
}

export function useTitleModelDownload(setMessage?: (message: string) => void) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: ["models", "title-download"], mutationFn: backend.downloadTitleModel, networkMode: "always",
    onMutate: () => setMessage?.(""),
    onSuccess: async () => { setMessage?.("picker_selected"); await invalidateModels(client); },
    onError: () => invalidateModels(client),
  });
}
