import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { confirm } from "@tauri-apps/plugin-dialog";
import { backend } from "../backend";
import { desktopBranding } from "../build-branding";
import { currentTitlebarDesign, subscribeTitlebarDesign } from "../titlebar-design";
import type { ModelSelection } from "../types";
import { ComputeStatus } from "./ComputeStatus";
import { ActivityStatus } from "./ActivityStatus";
import { useI18n } from "./i18n";

export function useDesktop(busy:boolean, flush:RefObject<()=>Promise<void>>) {
  const {t}=useI18n(), closing=useRef(false), currentBusy=useRef(busy);currentBusy.current=busy;
  const [closingAccepted,setClosingAccepted]=useState(false);
  const requestClose=useCallback(async()=>{
    if(closing.current)return;closing.current=true;
    try{
      const queue=await backend.queue().catch(()=>null);
      if((currentBusy.current||queue?.active||queue?.queued||queue?.running.length)&&!await confirm(t("desktop_close_busy"),{title:"Music Generator",kind:"warning"}))return;
      setClosingAccepted(true);
      await flush.current();await backend.exit();
    }finally{closing.current=false;setClosingAccepted(false);}
  },[t,flush]);
  const close=useRef(requestClose);close.current=requestClose;
  useEffect(()=>{
    if(navigator.userAgent.includes("Macintosh"))document.documentElement.dataset.platform="macos";
    let stopped=false;const offs:(()=>void)[]=[];
    const attach=async(registration:Promise<()=>void>)=>{const off=await registration;if(stopped)off();else offs.push(off);};
    const report=(error:unknown)=>{console.error(error);};
    void attach(getCurrentWindow().onCloseRequested(event=>{event.preventDefault();void close.current().catch(report);})).catch(report);
    void attach(listen("request-exit",()=>{void close.current().catch(report);})).catch(report);
    return()=>{stopped=true;offs.forEach(off=>off());};
  },[]);
  return {requestClose,closingAccepted};
}

export function WindowBar({onClose,studioControls}:{onClose:()=>Promise<void>;studioControls?:{selection:ModelSelection|null;inert:boolean}}){
  const {t}=useI18n();
  const choice = useSyncExternalStore(subscribeTitlebarDesign, currentTitlebarDesign);
  const design = choice === "auto" ? desktopBranding?.id : choice === "classic" ? undefined : choice;
  return <header className="titlebar" data-titlebar-design={design}>
    <span data-tauri-drag-region className="titlebar-name">
      {design ? <img src={`/branding/${design}.svg`} width="18" height="18" alt="" /> : <>♫ &nbsp; </>}
      Music Generator{desktopBranding && ` · ${desktopBranding.label}`}
    </span>
    <ActivityStatus className="titlebar-activity-status" showGeneration />
    {studioControls&&<div className="titlebar-tools" inert={studioControls.inert}>
      <ComputeStatus selection={studioControls.selection}/>
    </div>}
    <nav aria-label="Music Generator">
    <button id="windowMinimize" aria-label={t("desktop_minimize")} onClick={()=>{void getCurrentWindow().minimize();}}>−</button>
    <button id="windowMaximize" aria-label={t("desktop_maximize")} onClick={()=>{void getCurrentWindow().toggleMaximize();}}>□</button>
    <button id="windowClose" aria-label={t("desktop_close")} onClick={()=>{void onClose();}}>×</button>
  </nav></header>;
}
