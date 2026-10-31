import { invoke } from "@tauri-apps/api/core";
import { startupErrorMessage } from "./startup-errors";

let attempt = 1;
// Catch module-loading failures as well as backend and interface initialization errors.
async function launch(): Promise<void> {
  ({ attempt } = await invoke<{ attempt: number }>("startup_status"));
  if (!await invoke<boolean>("startup_allowed", { attempt })) return;
  const { startApp } = await import("./main");
  await startApp(attempt);
}

void launch().catch(async (error) => {
  const message = startupErrorMessage(error);
  if (message === "startup_attempt_expired") return;
  try { await invoke("startup_error", { attempt, error: message }); }
  catch { /* Diagnostics must not cause an unhandled rejection. */ }
});
