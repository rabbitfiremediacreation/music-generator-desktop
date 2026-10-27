import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { startupText, type StartupLabel } from "../startup-text";
import { useI18n } from "./i18n";

interface StartupStatus {sequence:number;phase:StartupLabel;error:string|null}
export function Splash(){
  const {language}=useI18n(),text=startupText(language);
  const [status,setStatus]=useState<StartupStatus>({sequence:0,phase:"starting",error:null}),[slow,setSlow]=useState(false),[retrying,setRetrying]=useState(false);
  const sequence=useRef(0);
  const update=useCallback((next:StartupStatus)=>{
    sequence.current=Math.max(sequence.current,next.sequence);
    setStatus(previous=>previous.phase==="installation_required"||next.sequence<previous.sequence?previous:next);
    setRetrying(false);
  },[]);
  const failed=useCallback((error:unknown)=>update({sequence:++sequence.current,phase:"error",error:error instanceof Error?error.message:String(error)}),[update]);
  useEffect(()=>{
    let stopped=false;let off:(()=>void)|undefined;
    const timer=setTimeout(()=>{if(!stopped)setSlow(true);},15000);
    void(async()=>{
      const remove=await listen<StartupStatus>("startup-status",({payload})=>{if(!stopped)update(payload);});
      if(stopped){remove();return;}off=remove;
      const snapshot=await invoke<StartupStatus>("startup_status");if(stopped)return;update(snapshot);
      await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
      if(!stopped)await invoke("splash_ready");
    })().catch(error=>{if(!stopped)failed(error);});
    return()=>{stopped=true;off?.();clearTimeout(timer);};
  },[update,failed]);
  const installation=status.phase==="installation_required",error=status.error!==null;
  return <div className="splash-root" data-failed={error} data-installation-required={installation}>
    <div className="drag-area" data-tauri-drag-region aria-hidden="true"/>
    <button id="splashClose" className="close" type="button" aria-label={text.quit} onClick={()=>{void invoke("exit_app").catch(failed);}}>×</button>
    <main className="splash" aria-labelledby="appName">
      <svg className="app-icon" viewBox="0 0 84 84" width="88" height="88" aria-hidden="true"><defs><linearGradient id="splashGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#434445"/><stop offset="1" stopColor="#2b2c2c"/></linearGradient></defs><rect x="1" y="1" width="82" height="82" rx="14" fill="url(#splashGradient)" stroke="#2a2e38"/><g className="waveform" fill="#ddc8aa">{[12,28,44,24,36,16].map((height,index)=><rect key={index} x={16+index*9} y={(84-height)/2} width="5" height={height} rx="2.5"/>)}</g></svg>
      <h1 id="appName">MUSIC <span>GENERATOR</span></h1>
      <p id="splashStatus" role="status" aria-live="polite">{text[status.phase]||text.starting}</p>
      {installation&&<><p id="splashInstallation" className="installation">{text.installation_steps}</p><button className="retry" type="button" aria-describedby="splashInstallation" onClick={()=>{void invoke("exit_app").catch(failed);}}>{text.quit}</button></>}
      {!error&&!installation&&<div id="splashProgress" className="progress" role="progressbar" aria-label={text[status.phase]||text.starting}><span/></div>}
      {slow&&!error&&!installation&&<p className="hint">{text.slow}</p>}
      {error&&<><p className="error" role="alert">{text.failure}</p><details key={status.sequence}><summary>{text.details}</summary><pre>{status.error}</pre></details>
        <button className="retry" type="button" disabled={retrying} onClick={()=>{setRetrying(true);void invoke("retry_startup").catch(failed);}}>{text.retry}</button></>}
    </main>
    <footer><img className="brand" src="/alphatester.png" width="180" height="30" alt="Alphatester"/><p>{text.footer}</p></footer>
  </div>;
}
