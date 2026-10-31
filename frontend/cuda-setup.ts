import "./cuda-setup-i18n";
import { backend } from "./backend";
import { bytes } from "./dom";
import { t } from "./i18n.js";
import type { Bootstrap, CudaStatus } from "./types";

let translate: (() => void) | undefined;
let sequence = 0;
document.addEventListener("langchange", () => translate?.());

export async function setupCuda(container: HTMLElement, hardware: Bootstrap["hardware"], busy: () => void, idle: () => Promise<void>): Promise<void> {
  const revision = ++sequence;
  translate = undefined;
  container.replaceChildren();
  container.hidden = hardware.platform !== "windows" || !hardware.gpu.toLowerCase().includes("nvidia") || hardware.cuda?.architecture_supported === false;
  if (container.hidden) return;
  container.innerHTML = `<p role="status" aria-live="polite" data-cuda-status></p><p class="small" data-cuda-size></p><button type="button" class="aktion" data-cuda-download></button> <button type="button" class="sek" data-cuda-check></button><p><a href="https://www.nvidia.com/Download/index.aspx" target="_blank" rel="noopener" data-cuda-driver></a></p><details data-cuda-details hidden><summary></summary><pre></pre></details>`;
  let status: CudaStatus | undefined;
  let working: "checking" | "downloading" | undefined = "checking";
  let failure = "";
  let cancelled = false;
  const download = container.querySelector<HTMLButtonElement>("[data-cuda-download]")!;
  const check = container.querySelector<HTMLButtonElement>("[data-cuda-check]")!;
  const driver = container.querySelector<HTMLAnchorElement>("[data-cuda-driver]")!;
  const render = () => {
    if (revision !== sequence || !container.isConnected) return;
    container.querySelector("[data-cuda-status]")!.textContent = t(`cuda_${working || (cancelled ? "cancelled" : failure ? "download_failed" : status?.state || "check_failed")}`);
    download.textContent = t("cuda_download"); check.textContent = t("cuda_recheck"); driver.textContent = t("cuda_driver");
    download.hidden = status?.state !== "runtime_missing";
    download.disabled = check.disabled = Boolean(working);
    driver.parentElement!.hidden = status?.state !== "driver_error" && status?.state !== "cuda_failed";
    const size = container.querySelector<HTMLElement>("[data-cuda-size]")!;
    size.hidden = download.hidden;
    size.textContent = `${t("cuda_download_info")} ${bytes(status?.download_bytes || 0)}`;
    const details = container.querySelector<HTMLDetailsElement>("[data-cuda-details]")!;
    details.hidden = !failure && !status?.details;
    details.querySelector("summary")!.textContent = t("cuda_details");
    details.querySelector("pre")!.textContent = failure || status?.details || "";
  };
  translate = render;
  const inspect = async () => {
    try { status = await backend.cudaStatus(); }
    catch (error) { status = { state: "check_failed", download_bytes: 0, details: String(error) }; }
  };
  const run = async (install: boolean) => {
    if (working) return;
    working = install ? "downloading" : "checking"; failure = ""; cancelled = false; busy(); render();
    try {
      if (install) { status = await backend.installCuda(); }
      else { await inspect(); }
    } catch (error) {
      if (error instanceof Error && error.message === "Operation cancelled") {
        failure = "";
        cancelled = true;
        await inspect();
        return;
      }
      failure = String(error);
    } finally {
      working = undefined;
      render();
      if (revision === sequence) await idle();
    }
  };
  download.onclick = () => { void run(true); };
  check.onclick = () => { void run(false); };
  render();
  await inspect(); working = undefined; render();
}
