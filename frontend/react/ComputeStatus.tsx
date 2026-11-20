import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ModelSelection } from "../types";
import { generationPolicyQuery, healthQuery, settingsQuery } from "./data";
import { useI18n } from "./i18n";

export function ComputeStatus({selection}:{selection:ModelSelection|null}){
  const {t}=useI18n(),client=useQueryClient();
  const health=useQuery({...healthQuery(client),refetchInterval:15000});
  const policy=useQuery(generationPolicyQuery(selection));
  const settings=useQuery(settingsQuery());
  const status=health.isError?undefined:health.data?.backend_status;
  const synthesis=status?.state==="running"&&status.synthesis.state==="confirmed"&&status.synthesis.backend!=="unknown"?status.synthesis:undefined;
  const lm=status?.state==="running"&&status.language_model.state==="confirmed"&&status.language_model.backend!=="unknown"?status.language_model:undefined;
  const detected=synthesis?.backend??policy.data?.detected_backend??"unknown";
  const names={cpu:"CPU",cuda:"CUDA",vulkan:"Vulkan",metal:"Metal",unknown:t("backend_unknown")};
  const name=names[detected];
  const evidence=synthesis?t("backend_observed"):detected!=="unknown"?t("backend_ready"):"";
  const lmMode=policy.data?.lm_device!==undefined&&policy.dataUpdatedAt>=settings.dataUpdatedAt?policy.data.lm_device:settings.data?.lm_device??"auto";
  const hasLanguageModel = policy.data?.capabilities?.advanced ?? (selection === null || Boolean(selection.language));
  const synthesisDescription=`${t("backend_synthesis")}: ${name}${synthesis?.device&&synthesis.device!==name?` · ${synthesis.device}`:""}${evidence?` · ${evidence}`:""}${synthesis?.reason?` · ${t(`backend_${synthesis.reason}`)}`:""}`;
  const languageDescription=`${t("backend_language_model")}: ${t(`lm_dev_${lmMode}`)}${lm?` · ${names[lm.backend]}${lm.device&&lm.device!==names[lm.backend]?` · ${lm.device}`:""} · ${t("backend_observed")}${lm.reason?` · ${t(`backend_${lm.reason}`)}`:""}`:""}`;
  const description=hasLanguageModel ? `${synthesisDescription}\n${languageDescription}` : synthesisDescription;
  return <div id="status" className={`backend-health ${health.isError||health.data?.ok===false?"err":""}`} title={health.data?.error}>
    <span className="sr-only" role="status" aria-live="polite">{health.isError?t("backend_offline"):health.data?.ok===false?t("offline"):""}</span>
    <div id="backendStatus" className="backend-chip" role="group" tabIndex={0} title={description} aria-label={description.replace("\n",". ")} data-backend={detected} data-evidence={synthesis?"observed":detected==="unknown"?"unknown":"available"}><span className="backend-chip-label" aria-hidden="true">{t("backend_chip_label")}</span><span className="backend-chip-value" aria-hidden="true">{name}</span></div>
  </div>;
}
