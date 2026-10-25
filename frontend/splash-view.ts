import type { StartupLabel } from "./startup-text";
import { element } from "./dom";

export interface StartupStatus { sequence: number; phase: StartupLabel; error: string | null }

/** Keep events newer than the initial snapshot and expose actionable errors without animation. */
export function splashView(text: Record<StartupLabel, string>) {
  let sequence = -1;
  element("#splashRetry").textContent = text.retry;
  element("#splashClose").setAttribute("aria-label", text.quit);
  element("#splashFooter").textContent = text.footer;
  element("#splashSlow").textContent = text.slow;
  element("#splashDetailsLabel").textContent = text.details;
  return (status: StartupStatus) => {
    if (status.sequence < sequence) return;
    sequence = status.sequence;
    const failed = status.error !== null;
    document.body.dataset.failed = String(failed);
    element("#splashStatus").textContent = text[status.phase] || text.starting;
    element("#splashProgress").setAttribute("aria-label", text[status.phase] || text.starting);
    element("#splashProgress").hidden = failed;
    element("#splashError").textContent = failed ? text.failure : "";
    element("#splashDiagnostic").textContent = status.error;
    const details = element<HTMLDetailsElement>("#splashDetails");
    details.hidden = !failed;
    details.open = false;
    element("#splashError").hidden = !failed;
    element<HTMLButtonElement>("#splashRetry").disabled = false;
    element("#splashRetry").hidden = !failed;
    if (failed) element("#splashSlow").hidden = true;
  };
}
