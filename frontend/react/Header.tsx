import { useQuery, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { backend } from "../backend";
import { LANGS,type Language } from "../locales";
import type { GenerationPolicy, ModelSelection } from "../types";
import { useI18n } from "./i18n";
import { AudioControls } from "./audio/AudioControls";
import { healthQuery, queryKeys } from "./data";

export function Header({selection,onAnalysis,onSettings}:{selection:ModelSelection|null;onAnalysis:(values:Record<string,unknown>,microphone:boolean)=>void;onSettings:()=>void}){
  const {language,setLanguage,t}=useI18n(),client=useQueryClient();
  const health=useQuery({...healthQuery(client),refetchInterval:15000});
  const policy=useQuery<GenerationPolicy>({queryKey:queryKeys.policy(selection),queryFn:()=>backend.generationPolicy(selection??undefined)});
  const settings=useQuery({queryKey:queryKeys.settings,queryFn:backend.settings});
  const status=health.isError?undefined:health.data?.backend_status;
  const synthesis=status?.state==="running"&&status.synthesis.state==="confirmed"&&status.synthesis.backend!=="unknown"?status.synthesis:undefined;
  const lm=status?.state==="running"&&status.language_model.state==="confirmed"&&status.language_model.backend!=="unknown"?status.language_model:undefined;
  const detected=synthesis?.backend??policy.data?.detected_backend??"unknown";
  const names={cpu:"CPU",cuda:"CUDA",vulkan:"Vulkan",metal:"Metal",unknown:t("backend_unknown")};
  const name=names[detected];
  const evidence=synthesis?t("backend_observed"):detected!=="unknown"?t("backend_ready"):"";
  const lmMode=policy.data?.lm_device!==undefined&&policy.dataUpdatedAt>=settings.dataUpdatedAt?policy.data.lm_device:settings.data?.lm_device??"auto";
  const description=`${t("backend_synthesis")}: ${name}${synthesis?.device&&synthesis.device!==name?` · ${synthesis.device}`:""}${evidence?` · ${evidence}`:""}${synthesis?.reason?` · ${t(`backend_${synthesis.reason}`)}`:""}\n${t("backend_language_model")}: ${t(`lm_dev_${lmMode}`)}${lm?` · ${names[lm.backend]}${lm.device&&lm.device!==names[lm.backend]?` · ${lm.device}`:""} · ${t("backend_observed")}${lm.reason?` · ${t(`backend_${lm.reason}`)}`:""}`:""}`;
  return <header className="top">
    <AudioControls selection={selection} onAnalysis={onAnalysis}/>
    <a className="brand-link" href="https://alphatester.rabbitfire.de/" title={t("brand_title")} onClick={event=>{event.preventDefault();void openUrl(event.currentTarget.href);}}><img className="brand" src="/alphatester.png" alt="Alphatester"/></a>
    <div className="divider"/><h1 className="title"><span>MUSIC</span><span>GENERATOR</span></h1>
    <div className="top-right"><div className="header-context">
      <select id="uiLang" className="langsw" aria-label="Language / Sprache" title="Language / Sprache" value={language} onChange={event=>setLanguage(event.target.value as Language)}>{Object.entries(LANGS).map(([code,label])=><option key={code} value={code}>{label}</option>)}</select>
      <div id="status" className={`backend-health ${health.isError||health.data?.ok===false?"err":""}`} title={health.data?.error}>
        <span className="sr-only" role="status" aria-live="polite">{health.isError?t("backend_offline"):health.data?.ok===false?t("offline"):""}</span>
        <div id="backendStatus" className="backend-chip" role="group" tabIndex={0} title={description} aria-label={description.replace("\n",". ")} data-backend={detected} data-evidence={synthesis?"observed":detected==="unknown"?"unknown":"available"}><span className="backend-chip-label" aria-hidden="true">{t("backend_chip_label")}</span><span className="backend-chip-value" aria-hidden="true">{name}</span></div>
      </div></div>
      <button id="btnSettings" type="button" className="gear" title={t("settings_title")} aria-label={t("settings_title")} onClick={onSettings}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M9 3h6l1 4 4 2v6l-4 2-1 4H9l-1-4-4-2V9l4-2z"/></svg></button>
    </div>
  </header>;
}
