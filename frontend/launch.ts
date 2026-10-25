import { invoke } from "@tauri-apps/api/core";

// Catch module-loading failures as well as backend and interface initialization errors.
void import("./main").then(({ startApp }) => startApp()).catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  document.querySelector("#bootStatus")!.textContent = message;
  await invoke("startup_error", { error: message });
});
