import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { confirm } from "@tauri-apps/plugin-dialog";
import { backend } from "../backend";
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

export function WindowBar({onClose}:{onClose:()=>Promise<void>}){
  const {t}=useI18n();
  return <header className="titlebar"><span data-tauri-drag-region className="titlebar-name">♫ &nbsp; Music Generator</span><nav aria-label="Music Generator">
    <button id="windowMinimize" aria-label={t("desktop_minimize")} onClick={()=>{void getCurrentWindow().minimize();}}>−</button>
    <button id="windowMaximize" aria-label={t("desktop_maximize")} onClick={()=>{void getCurrentWindow().toggleMaximize();}}>□</button>
    <button id="windowClose" aria-label={t("desktop_close")} onClick={()=>{void onClose();}}>×</button>
  </nav></header>;
}
