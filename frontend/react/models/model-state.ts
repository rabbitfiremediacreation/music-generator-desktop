import type { QueryClient } from "@tanstack/react-query";

/** Model configuration changes refresh both choices and their observed execution policy. */
export async function invalidateModels(client: QueryClient) {
  await Promise.all(["settings", "models", "generation-policy", "health", "queue"].map(key => client.invalidateQueries({ queryKey: [key] })));
}
