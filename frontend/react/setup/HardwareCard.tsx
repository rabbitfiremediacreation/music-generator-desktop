import type { Bootstrap } from "../../types";
import { useI18n } from "../i18n";

export function HardwareCard({ hardware, backend }: { hardware: Bootstrap["hardware"]; backend: "cpu" | "gpu" | "unknown" }) {
  const { t, language } = useI18n();
  const bytes = (value: number) => `${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value / 1024 ** 3)} GiB`;
  return <section className="hardware-card">
    <h2>{t("desktop_hardware")}</h2>
    <p>{bytes(hardware.ram_bytes)} RAM · {hardware.gpu}{hardware.vram_bytes ? ` · ${bytes(hardware.vram_bytes)} VRAM` : ""}</p>
    {hardware.cuda && <div className="small">
      <p>{t("backend_compatibility")}: {t("backend_compute_capability")} ≥ {hardware.cuda.minimum_compute_capability}</p>
      <p>{t(hardware.cuda.architecture_supported === false ? "backend_cuda_incompatible" : hardware.cuda.architecture_supported ? "backend_cuda_compatible" : "backend_cuda_unknown")}</p>
      {hardware.nvidia?.compute_capability && <p>{t("backend_compute_capability")}: {hardware.nvidia.compute_capability}</p>}
      {hardware.nvidia?.driver_version && <p>{t("backend_driver")}: {hardware.nvidia.driver_version}</p>}
    </div>}
    {backend !== "gpu" && <p className="cpu-warning">{t(backend === "cpu" ? "cpu_setup" : "cpu_unknown_setup")}</p>}
    {hardware.cpu_only && <p className="small">{t("desktop_intel_cpu_hint")}</p>}
  </section>;
}
