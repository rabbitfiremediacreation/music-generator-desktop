import { invoke } from "@tauri-apps/api/core";

// Catch module-loading failures as well as backend and interface initialization errors.
async function launch(): Promise<void> {
  if (!await invoke<boolean>("startup_allowed")) return;
  const { startApp } = await import("./main");
  await startApp();
}

void launch().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  await invoke("startup_error", { error: message });
});
