import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { element } from "./dom";
import { startupText } from "./startup-text";
import { splashView, type StartupStatus } from "./splash-view";

const text = startupText();
const render = splashView(text);
render({ sequence: 0, phase: "starting", error: null });
let sequence = 0;
function update(status: StartupStatus) { sequence = Math.max(sequence, status.sequence); render(status); }
function failed(error: unknown) { update({ sequence: ++sequence, phase: "error", error: error instanceof Error ? error.message : String(error) }); }

async function connect() {
  await listen<StartupStatus>("startup-status", ({ payload }) => update(payload));
  update(await invoke<StartupStatus>("startup_status"));
  // Allow the static icon, status and CSS animation to paint before backend initialization.
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  await invoke("splash_ready");
}

element("#splashClose").onclick = () => { void invoke("exit_app").catch(failed); };
element("#splashRetry").onclick = async () => {
  element<HTMLButtonElement>("#splashRetry").disabled = true;
  try { await invoke("retry_startup"); } catch (error) { failed(error); }
};
setTimeout(() => { if (document.body.dataset.failed !== "true") element("#splashSlow").hidden = false; }, 15000);
void connect().catch(failed);
