import type { BackendStatus, ComponentBackend } from "../../types";
import { useI18n } from "../i18n";

const names = { cuda: "CUDA", vulkan: "Vulkan", metal: "Metal", cpu: "CPU", unknown: "" };

export function BackendDetails({ status }: { status?: BackendStatus }) {
  const { t } = useI18n();
  const label = (component?: ComponentBackend) => !component ? t("backend_unknown") : component.state === "confirmed"
    ? names[component.backend] || t("backend_unknown") : t(`backend_${component.state}`);
  return <details className="backend-details" open>
    <summary>{t("backend_details")}</summary>
    <div className="backend-observations" role="region" aria-label={t("backend_details")}>
      {(["synthesis", "language_model"] as const).map(role => {
        const component = status?.[role], confirmed = component?.state === "confirmed";
        return <div key={role}>
          <p>{t(`backend_${role}`)}: {label(component)}{confirmed && component?.device ? ` · ${component.device}` : ""}</p>
          {confirmed && <p className="small">{t(`backend_${component?.reason || "reason_unknown"}`)}</p>}
        </div>;
      })}
    </div>
  </details>;
}
