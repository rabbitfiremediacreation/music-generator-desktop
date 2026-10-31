import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { useI18n } from "../i18n";
import type { useCudaSetup } from "./useCudaSetup";

export function CudaSetup({ state, disabled }: { state: ReturnType<typeof useCudaSetup>; disabled: boolean }) {
  const { t, language } = useI18n();
  const [driverError, setDriverError] = useState<unknown>();
  if (!state.enabled) return null;
  const { status, operation } = state;
  const failure = operation.error;
  const cancelled = failure?.message === "Operation cancelled";
  const working = operation.isPending || status.isFetching;
  const message = working ? operation.isPending && operation.variables ? "downloading" : "checking" : cancelled ? "cancelled" : failure ? operation.variables ? "download_failed" : "check_failed" : status.error ? "check_failed" : status.data?.state ?? "checking";
  const details = String(driverError || failure || status.error || status.data?.details || "");
  return <section id="cudaSetup" className="hardware-card" aria-busy={working}>
    <p role="status" aria-live="polite">{t(`cuda_${message}`)}</p>
    {status.data?.state === "runtime_missing" && <>
      <p className="small">{t("cuda_download_info")} {new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(status.data.download_bytes / 1024 ** 3)} GiB</p>
      <button type="button" className="aktion" disabled={disabled || working} onClick={() => state.run(true)}>{t("cuda_download")}</button>
    </>}
    <button type="button" className="sek" disabled={disabled || working} onClick={() => state.run(false)}>{t("cuda_recheck")}</button>
    {(status.data?.state === "driver_error" || status.data?.state === "cuda_failed") && <p><button type="button" className="sek" onClick={() => { setDriverError(undefined); void openUrl("https://www.nvidia.com/Download/index.aspx").catch(setDriverError); }}>{t("cuda_driver")}</button></p>}
    {details && <details><summary>{t("cuda_details")}</summary><pre className="whitespace-pre-wrap wrap-anywhere text-xs">{details}</pre></details>}
  </section>;
}
