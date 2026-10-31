import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { startupText, type StartupLabel } from "../startup-text";
import { startupErrorDetails, startupErrorMessage, startupErrorText } from "../startup-errors";
import { waitForPaint } from "../startup-paint";
import { useI18n } from "./i18n";

interface StartupStatus {attempt:number;sequence:number;phase:StartupLabel;error:string|null}
export function Splash(){
  const {language}=useI18n(),text=startupText(language);
  const [status,setStatus]=useState<StartupStatus>({attempt:1,sequence:0,phase:"starting",error:null}),[slow,setSlow]=useState(false),[retrying,setRetrying]=useState(false);
  const current=useRef(status);
  const update=useCallback((next:StartupStatus)=>{
    const previous=current.current;
    if(next.attempt<previous.attempt||(next.attempt===previous.attempt&&(next.sequence<previous.sequence||previous.phase==="installation_required")))return;
    current.current=next;setStatus(next);setRetrying(false);
  },[]);
  const synchronize=useCallback(async()=>{
    try{update(await invoke<StartupStatus>("startup_status"));}catch{/* A later event can restore the status. */}
  },[update]);
  const failed=useCallback(async(error:unknown,attempt:number)=>{
    if(attempt!==current.current.attempt)return;
    const message=startupErrorMessage(error);
    if(message==="startup_attempt_expired"){await synchronize();return;}
    setStatus({...current.current,phase:"error",error:message});setRetrying(false);
    try{await invoke("startup_error",{attempt,error:message});}catch{/* Keep the local failure actionable. */}
  },[synchronize]);
  useEffect(()=>{
    let stopped=false;let off:(()=>void)|undefined;let attempt=current.current.attempt;
    const timer=setTimeout(()=>{if(!stopped)setSlow(true);},15000);
    void(async()=>{
      const initial=await invoke<StartupStatus>("startup_status");if(stopped)return;update(initial);attempt=current.current.attempt;
      const remove=await listen<StartupStatus>("startup-status",({payload})=>{if(!stopped)update(payload);});
      if(stopped){remove();return;}off=remove;
      const snapshot=await invoke<StartupStatus>("startup_status");if(stopped)return;update(snapshot);
      attempt=current.current.attempt;
      await waitForPaint();
      if(!stopped)await invoke("splash_ready",{attempt});
    })().catch(error=>{if(!stopped)void failed(error,attempt);});
    return()=>{stopped=true;off?.();clearTimeout(timer);};
  },[update,failed]);
  const quit=()=>{const attempt=current.current.attempt;void invoke("exit_app").catch(error=>failed(error,attempt));};
  const retry=()=>{const attempt=current.current.attempt;setRetrying(true);void invoke("retry_startup",{attempt}).catch(async error=>{await synchronize();await failed(error,attempt);});};
  const installation=status.phase==="installation_required",error=status.error!==null;
  return <div className="splash-root" data-failed={error} data-installation-required={installation}>
    <div className="drag-area" data-tauri-drag-region aria-hidden="true"/>
    <button id="splashClose" className="close" type="button" aria-label={text.quit} onClick={quit}>×</button>
    <main className="splash" aria-labelledby="appName">
      <svg className="app-icon" viewBox="0 0 84 84" width="88" height="88" aria-hidden="true"><defs><linearGradient id="splashGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#434445"/><stop offset="1" stopColor="#2b2c2c"/></linearGradient></defs><rect x="1" y="1" width="82" height="82" rx="14" fill="url(#splashGradient)" stroke="#2a2e38"/><g className="waveform" fill="#ddc8aa">{[12,28,44,24,36,16].map((height,index)=><rect key={index} x={16+index*9} y={(84-height)/2} width="5" height={height} rx="2.5"/>)}</g></svg>
      <h1 id="appName">MUSIC <span>GENERATOR</span></h1>
      <p id="splashStatus" role="status" aria-live="polite">{text[status.phase]||text.starting}</p>
      {installation&&<><p id="splashInstallation" className="installation">{text.installation_steps}</p><button className="retry" type="button" aria-describedby="splashInstallation" onClick={quit}>{text.quit}</button></>}
      {!error&&!installation&&<div id="splashProgress" className="progress" role="progressbar" aria-label={text[status.phase]||text.starting}><span/></div>}
      {slow&&!error&&!installation&&<p className="hint">{text.slow}</p>}
      {error&&<><p className="error" role="alert">{startupErrorText(status.error)}</p><details key={status.sequence}><summary>{text.details}</summary><pre>{startupErrorDetails(status.error)}</pre></details>
        <button className="retry" type="button" disabled={retrying} onClick={retry}>{text.retry}</button></>}
    </main>
    <footer><img className="brand" src="/alphatester.png" width="180" height="30" alt="Alphatester"/><p>{text.footer}</p></footer>
  </div>;
}
