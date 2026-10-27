import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { element } from "./dom";
import { startupText } from "./startup-text";
import { splashView, type StartupStatus } from "./splash-view";
import { waitForPaint } from "./startup-paint";
import { startupErrorMessage } from "./startup-errors";

const text = startupText();
const render = splashView(text);
let current: StartupStatus = { attempt: 1, sequence: 0, phase: "starting", error: null };
render(current);

function update(status: StartupStatus) {
  if (status.attempt < current.attempt || (status.attempt === current.attempt && status.sequence < current.sequence)) return;
  current = status;
  render(status);
}

async function synchronize() {
  try { update(await invoke<StartupStatus>("startup_status")); }
  catch { /* The next backend event can restore the current status. */ }
}

async function failed(error: unknown, attempt: number) {
  if (attempt !== current.attempt) return;
  const message = startupErrorMessage(error);
  if (message === "startup_attempt_expired") {
    await synchronize();
    return;
  }
  render({ ...current, phase: "error", error: message });
  try { await invoke("startup_error", { attempt, error: message }); }
  catch { /* Keep the local failure actionable when reporting is unavailable. */ }
}

async function connect() {
  let attempt = current.attempt;
  try {
    update(await invoke<StartupStatus>("startup_status"));
    attempt = current.attempt;
    await listen<StartupStatus>("startup-status", ({ payload }) => update(payload));
    attempt = current.attempt;
    // Catch transitions between the first snapshot and event subscription.
    update(await invoke<StartupStatus>("startup_status"));
    attempt = current.attempt;
    // Allow the static icon, status and CSS animation to paint before backend initialization.
    await waitForPaint();
    await invoke("splash_ready", { attempt });
  } catch (error) { await failed(error, attempt); }
}

function quit() {
  const attempt = current.attempt;
  void invoke("exit_app").catch(error => failed(error, attempt));
}

element("#splashClose").onclick = quit;
element("#splashQuit").onclick = quit;
element("#splashRetry").onclick = async () => {
  const attempt = current.attempt;
  element<HTMLButtonElement>("#splashRetry").disabled = true;
  try { await invoke("retry_startup", { attempt }); }
  catch (error) { await synchronize(); await failed(error, attempt); }
};
setTimeout(() => {
  if (document.body.dataset.failed !== "true" && document.body.dataset.installationRequired !== "true") element("#splashSlow").hidden = false;
}, 15000);
void connect();
