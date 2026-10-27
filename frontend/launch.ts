import { invoke } from "@tauri-apps/api/core";
import type { StartupStatus } from "./splash-view";
import { startupErrorMessage, startupErrorText } from "./startup-errors";

let attempt = 1;

// Catch module-loading failures as well as backend and interface initialization errors.
async function launch(): Promise<void> {
  ({ attempt } = await invoke<StartupStatus>("startup_status"));
  if (!await invoke<boolean>("startup_allowed", { attempt })) return;
  const { startApp } = await import("./main");
  await startApp(attempt);
}

void launch().catch(async (error) => {
  const message = startupErrorMessage(error);
  if (message === "startup_attempt_expired") return;
  document.querySelector("#bootStatus")!.textContent = startupErrorText(error);
  try { await invoke("startup_error", { attempt, error: message }); }
  catch { /* Startup diagnostics must not produce an unhandled rejection. */ }
});
