import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { QueryClient, QueryClientProvider, useIsMutating, useQuery, useQueryClient } from "@tanstack/react-query";
import { createHashHistory, createRootRouteWithContext, createRoute, createRouter, Outlet, redirect, RouterProvider, useNavigate, useRouterState, type RouterHistory } from "@tanstack/react-router";
import { invoke } from "@tauri-apps/api/core";
import { waitForPaint } from "../startup-paint";
import { startupErrorMessage } from "../startup-errors";
import { selectionFromSettings } from "../creator-models";
import { modelAllowed } from "../expert-mode";
import type { Bootstrap, ModelSelection, Song } from "../types";
import { I18nProvider, useI18n } from "./i18n";
import { bootstrapQuery, startupAttempt, queryKeys, settingsQuery } from "./data";
import { EventBridge } from "./events";
import { useDesktop, WindowBar } from "./desktop";
import { Header } from "./Header";
import { Library } from "./library/Library";
import { Player, PlayerProvider } from "./player";
import { GenerationAdmissionProvider } from "./generation/admission";
import { GenerationForm } from "./generation/GenerationForm";
import { ModelControls } from "./models/ModelControls";
import { SetupScreen } from "./setup/SetupScreen";
import { SettingsDialog } from "./settings/SettingsDialog";
import { ImportDialog } from "./import/ImportDialog";
import { ErrorState, LoadingState } from "./ui";

type Layout="auto"|"stack"|"side";
function stored(key:string,fallback:string){try{return localStorage.getItem(key)||fallback;}catch{return fallback;}}
function remember(key:string,value:string){try{localStorage.setItem(key,value);}catch{/* Session choices remain usable. */}}
function reportStartup(error:unknown,attempt:number){const message=startupErrorMessage(error);if(message!=="startup_attempt_expired")void invoke("startup_error",{attempt,error:message}).catch(()=>{});}
function StartupError({error}:{error:unknown}){const client=useQueryClient();useEffect(()=>reportStartup(error,startupAttempt(client)),[error,client]);return <ErrorState error={error}/>;}
const SceneContext=createContext<{bootstrap:Bootstrap;complete:()=>void;back:()=>void;ready:()=>void;importLibrary:(target:string,done:(songsDir:string)=>void)=>void}|null>(null);
const rootRoute=createRootRouteWithContext<{client:QueryClient}>()({
  beforeLoad:async({context})=>({bootstrap:await context.client.ensureQueryData(bootstrapQuery(startupAttempt(context.client)))}),
  component:DesktopShell,errorComponent:StartupError,pendingComponent:LoadingState,
});
const indexRoute=createRoute({getParentRoute:()=>rootRoute,path:"/",beforeLoad:({context})=>{throw redirect({to:context.bootstrap.needs_setup?"/setup":"/studio",replace:true});}});
const setupRoute=createRoute({getParentRoute:()=>rootRoute,path:"/setup",component:SetupScene});
const studioRoute=createRoute({getParentRoute:()=>rootRoute,path:"/studio",beforeLoad:({context})=>{if(context.bootstrap.needs_setup)throw redirect({to:"/setup",replace:true});},component:()=>null});
const routeTree=rootRoute.addChildren([indexRoute,setupRoute,studioRoute]);
export function createAppRouter(client:QueryClient,history:RouterHistory=createHashHistory()){
  return createRouter({routeTree,history,context:{client},defaultPreload:false,defaultPendingMs:0});
}
type AppRouter=ReturnType<typeof createAppRouter>;
declare module "@tanstack/react-router"{interface Register{router:AppRouter}}
export function DesktopApp({client,router}:{client:QueryClient;router:AppRouter}){
  return <QueryClientProvider client={client}><I18nProvider><EventBridge><RouterProvider router={router}/></EventBridge></I18nProvider></QueryClientProvider>;
}
function SetupScene(){const scene=useContext(SceneContext)!;return <SetupScreen bootstrap={scene.bootstrap} onComplete={scene.complete} onBack={scene.bootstrap.needs_setup?undefined:scene.back} onReady={scene.ready} onImport={scene.importLibrary}/>;}

/** Route changes preserve the workspace; only a completed setup replaces active model defaults. */
function DesktopShell(){
  const {t}=useI18n();
  const client=useQueryClient(),navigate=useNavigate(),path=useRouterState({select:state=>state.location.pathname});
  const report=useCallback((error:unknown)=>reportStartup(error,startupAttempt(client)),[client]);
  const bootstrap=useQuery(bootstrapQuery(startupAttempt(client))).data!;
  const settings=useQuery(settingsQuery());
  const [selection,setSelection]=useState<ModelSelection|null>(null),[layout,setLayout]=useState<Layout>(()=>{const value=stored("desktop_layout","auto");return value==="stack"||value==="side"?value:"auto";});
  const [folder,setFolder]=useState(()=>stored("folder","")),[settingsOpen,setSettingsOpen]=useState(false),[settingsBusy,setSettingsBusy]=useState(false),[pickerOpen,setPickerOpen]=useState(false);
  const [reuse,setReuse]=useState<{song:Song;revision:number}>(),[analysis,setAnalysis]=useState<{values:Record<string,unknown>;microphone:boolean;revision:number}>(),[recommendedSteps,setRecommendedSteps]=useState<{steps:number;revision:number}>();
  const [importState,setImportState]=useState<{mode:"import"|"move";target:string;done?:(songsDir:string)=>void}|null>(null);
  const [setupReady,setSetupReady]=useState(false),[libraryReady,setLibraryReady]=useState(false),[formReady,setFormReady]=useState(false),[modelsReady,setModelsReady]=useState(false);
  const reported=useRef(false),flush=useRef<()=>Promise<void>>(async()=>{});
  const intentRevision=useRef(0);
  const operations=useIsMutating({predicate:mutation=>["setup","models","import"].includes(String(mutation.options.mutationKey?.[0]))}),studio=path==="/studio",blocked=settingsOpen||settingsBusy||!studio||importState!==null||pickerOpen;
  const {requestClose:close,closingAccepted}=useDesktop(operations>0,flush);
  const setFolderChoice=useCallback((value:string)=>{setFolder(value);remember("folder",value);},[]);
  const setLayoutChoice=useCallback((value:Layout)=>{setLayout(value);remember("desktop_layout",value);},[]);
  const registerFlush=useCallback((value:()=>Promise<void>)=>{flush.current=value;},[]);
  const libraryInitialized=useCallback(()=>setLibraryReady(true),[]),formInitialized=useCallback(()=>setFormReady(true),[]),modelsInitialized=useCallback(()=>setModelsReady(true),[]),setupInitialized=useCallback(()=>setSetupReady(true),[]);
  const libraryFailed=useCallback((error:unknown)=>{if(!reported.current)report(error);},[report]);
  const back=useCallback(()=>{void navigate({to:"/studio"});},[navigate]);
  const manage=useCallback(()=>{setSettingsOpen(false);setPickerOpen(false);void navigate({to:"/setup"});},[navigate]);
  const importLibrary=useCallback((target:string,done:(songsDir:string)=>void)=>setImportState({mode:"import",target,done}),[]);
  const complete=useCallback(()=>{void(async()=>{
    const saved=await client.fetchQuery({...settingsQuery(),staleTime:0});
    setReuse(undefined);
    setSelection(selectionFromSettings(saved));
    client.setQueryData<Bootstrap>(queryKeys.bootstrap,old=>old?{...old,needs_setup:false,settings:saved}:old);
    await navigate({to:"/studio"});
  })().catch(report);},[client,navigate,report]);
  useEffect(()=>{
    if(reported.current||!(studio?libraryReady&&formReady&&modelsReady:setupReady))return;
    reported.current=true;void(async()=>{const attempt=startupAttempt(client);await invoke("startup_show_main",{attempt});await waitForPaint();await invoke("startup_complete",{attempt});})().catch(report);
  },[studio,libraryReady,formReady,modelsReady,setupReady,client,report]);
  useEffect(()=>{
    if(!studio||!libraryReady||!formReady||!modelsReady)return;
    const frame=requestAnimationFrame(()=>document.querySelector<HTMLInputElement>('#genForm input[name="title"]')?.focus({preventScroll:true}));
    return()=>cancelAnimationFrame(frame);
  },[studio,libraryReady,formReady,modelsReady]);
  useEffect(()=>{
    if(!studio)return;
    const keyboard=(event:KeyboardEvent)=>{if(!event.altKey||event.ctrlKey||event.metaKey)return;const selector=event.code==="KeyB"?"#libHeading":event.code==="KeyN"?'#genForm [name="prompt"]':null;if(selector){event.preventDefault();document.querySelector<HTMLElement>(selector)?.focus();}};
    document.addEventListener("keydown",keyboard);return()=>document.removeEventListener("keydown",keyboard);
  },[studio]);
  const allowed=modelAllowed(selection??undefined,settings.data?.expert_mode??false,settings.data?.recommended_profiles??bootstrap.recommended_profiles);
  return <PlayerProvider><GenerationAdmissionProvider settingsBlocked={blocked}>
    <WindowBar onClose={close}/><div className="glow" aria-hidden="true"/>
    <SceneContext.Provider value={{bootstrap:{...bootstrap,settings:settings.data??bootstrap.settings},complete,back,ready:setupInitialized,importLibrary}}><Outlet/></SceneContext.Provider>
    {!bootstrap.needs_setup&&<main id="studio" hidden={!studio} inert={closingAccepted}>
      <div className={`wrap ${layout!=="stack"?"side":""}`}>
        {studio&&<Header selection={selection} onAnalysis={(values,microphone)=>setAnalysis({values,microphone,revision:++intentRevision.current})} onSettings={()=>setSettingsOpen(true)}/>}
        <section className="card min-h-0" aria-labelledby="genHeading">
          <h2 id="genHeading" className="sr-only">{t("gen_heading")}</h2>
          <ModelControls selection={selection} selectionRevision={reuse?.revision} onSelectionChange={setSelection} onManage={manage} onOpenSettings={()=>setSettingsOpen(true)} onReady={modelsInitialized} onRecommendedSteps={steps=>setRecommendedSteps({steps,revision:++intentRevision.current})} open={pickerOpen} onOpenChange={setPickerOpen}/>
          <GenerationForm selection={selection} onSelectionChange={setSelection} settingsBlocked={blocked||closingAccepted} modelAllowed={allowed} folderId={folder} reuse={reuse} analysis={analysis} recommendedSteps={recommendedSteps} onReady={formInitialized} onPreferencesFlush={registerFlush}/>
        </section>
        <Library folder={folder} onFolderChange={setFolderChoice} selection={selection} onReuse={song=>setReuse({song,revision:++intentRevision.current})} onReady={libraryInitialized} onError={libraryFailed}/>
      </div><Player/>
    </main>}
    <SettingsDialog open={settingsOpen} onClose={()=>setSettingsOpen(false)} onBusyChange={setSettingsBusy} onManageModels={manage} onOpenModelPicker={()=>setPickerOpen(true)} onMoveLibrary={()=>setImportState({mode:"move",target:settings.data?.songs_dir??bootstrap.settings.songs_dir})} layout={layout} onLayoutChange={setLayoutChoice}/>
    {importState&&<ImportDialog open mode={importState.mode} songsDirectory={importState.target} platform={bootstrap.hardware.platform} onClose={()=>setImportState(null)} onImported={directory=>importState.done?.(directory)}/>}
  </GenerationAdmissionProvider></PlayerProvider>;
}
