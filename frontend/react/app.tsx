import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { QueryClient, QueryClientProvider, useIsMutating, useQuery, useQueryClient } from "@tanstack/react-query";
import { createHashHistory, createRootRouteWithContext, createRoute, createRouter, Outlet, redirect, RouterProvider, useNavigate, useRouterState, type RouterHistory } from "@tanstack/react-router";
import { invoke } from "@tauri-apps/api/core";
import { waitForPaint } from "../startup-paint";
import { startupErrorMessage } from "../startup-errors";
import { selectionFromSettings } from "../creator-models";
import { modelAllowed } from "../expert-mode";
import type { StemJob } from "../stems";
import type { Bootstrap, ModelSelection, Song } from "../types";
import { I18nProvider, useI18n } from "./i18n";
import { bootstrapQuery, startupAttempt, queryKeys, settingsQuery } from "./data";
import { EventBridge } from "./events";
import { useDesktop, WindowBar } from "./desktop";
import { Header } from "./Header";
import { useReferenceAudio } from "./audio/useReferenceAudio";
import { Library } from "./library/Library";
import { Player, PlayerProvider, usePlayer } from "./player";
import { GenerationAdmissionProvider } from "./generation/admission";
import { GenerationForm } from "./generation/GenerationForm";
import { RemixForm } from "./generation/RemixForm";
import { useRemixModels } from "./generation/remix-models";
import { WorkspaceNavigation, type WorkspaceMode } from "./WorkspaceNavigation";
import { QueueView } from "./QueueView";
import { ModelControls } from "./models/ModelControls";
import { ModelPickerBar } from "./models/ModelPickerBar";
import { SetupScreen } from "./setup/SetupScreen";
import { SettingsDialog } from "./settings/SettingsDialog";
import type { SettingsPage } from "./settings/SettingsNavigation";
import { focusStudioArea, useAppMenu } from "./useAppMenu";
import { StemStudio, type StemStudioRequest } from "./stems/StemStudio";
import { StemMixer } from "./stems/StemMixer";
import { SongMixer } from "./stems/SongMixer";
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
  return <QueryClientProvider client={client}><I18nProvider><EventBridge><PlayerProvider><RouterProvider router={router}/></PlayerProvider></EventBridge></I18nProvider></QueryClientProvider>;
}
function SetupScene(){const scene=useContext(SceneContext)!;return <SetupScreen bootstrap={scene.bootstrap} onComplete={scene.complete} onBack={scene.bootstrap.needs_setup?undefined:scene.back} onReady={scene.ready} onImport={scene.importLibrary}/>;}

/** Route changes preserve the workspace; only a completed setup replaces active model defaults. */
function DesktopShell(){
  const {t}=useI18n();
  const { song: currentSong } = usePlayer();
  const client=useQueryClient(),navigate=useNavigate(),path=useRouterState({select:state=>state.location.pathname});
  const report=useCallback((error:unknown)=>reportStartup(error,startupAttempt(client)),[client]);
  const bootstrap=useQuery(bootstrapQuery(startupAttempt(client))).data!;
  const settings=useQuery(settingsQuery());
  const [selection,setSelection]=useState<ModelSelection|null>(null),[layout,setLayout]=useState<Layout>(()=>{const value=stored("desktop_layout","auto");return value==="stack"||value==="side"?value:"auto";});
  const reference=useReferenceAudio(selection);
  const [folder,setFolder]=useState(()=>stored("folder","")),[settingsOpen,setSettingsOpen]=useState(false),[settingsBusy,setSettingsBusy]=useState(false);
  const [settingsPage,setSettingsPage]=useState<{page:SettingsPage}>({page:"generation"}),[requestedModel,setRequestedModel]=useState<ModelSelection|null>(null);
  const [reuse,setReuse]=useState<{song:Song;revision:number}>(),[analysis,setAnalysis]=useState<{values:Record<string,unknown>;microphone:boolean;revision:number}>(),[recommendedSteps,setRecommendedSteps]=useState<{steps:number;revision:number}>();
  const [mode, setMode] = useState<WorkspaceMode>("create");
  const [remixSource, setRemixSource] = useState<{ song: Song; revision: number }>();
  const [remixChoice, setRemixChoice] = useState<ModelSelection>();
  const [stemStudio,setStemStudio] = useState<StemStudioRequest | null>(null);
  const [mixerJob,setMixerJob] = useState<StemJob | null>(null);
  const [mixSong, setMixSong] = useState<Song | null>(null);
  const [mixerPreview,setMixerPreview] = useState<StemJob | null>(null);
  const [mixerSeparation,setMixerSeparation] = useState<StemStudioRequest | null>(null);
  const [importState,setImportState]=useState<{mode:"import"|"move";target:string;done?:(songsDir:string)=>void}|null>(null);
  const [setupReady,setSetupReady]=useState(false),[libraryReady,setLibraryReady]=useState(false),[formReady,setFormReady]=useState(false),[modelsReady,setModelsReady]=useState(false);
  const [startupComplete,setStartupComplete]=useState(false);
  const reported=useRef(false),flush=useRef<()=>Promise<void>>(async()=>{});
  const intentRevision=useRef(0);
  const pendingArea = useRef<"creator" | "library" | undefined>(undefined);
  const operations=useIsMutating({predicate:mutation=>["setup","models","import"].includes(String(mutation.options.mutationKey?.[0]))}),studio=path==="/studio";
  const activeMode = stemStudio && mixerJob ? "mix" : mode;
  const mixVisible = studio && activeMode === "mix";
  const queueVisible = studio && activeMode === "queue";
  const originalMixVisible = mixVisible && !mixerJob && !mixerPreview;
  const blockingOperations=useIsMutating({predicate:mutation=>["setup","import"].includes(String(mutation.options.mutationKey?.[0]))});
  const studioVisible = studio && !mixVisible && !queueVisible;
  const blocked = settingsOpen || settingsBusy || !studioVisible || importState !== null || blockingOperations > 0;
  const {requestClose:close,closingAccepted}=useDesktop(operations>0,flush);
  const openSettings=useCallback((page:SettingsPage="generation",requested:ModelSelection|null=null)=>{if(settingsOpen)return;setSettingsPage({page});setRequestedModel(requested);setSettingsOpen(true);},[settingsOpen]);
  const openModelSettings=useCallback((next?:ModelSelection|null)=>openSettings("models",next??null),[openSettings]);
  const changeMode = useCallback((next: WorkspaceMode) => {
    setMode(next);
    setStemStudio(null);
    setMixerSeparation(null);
    setMixerPreview(null);
  }, []);
  function navigateWorkspace(next: WorkspaceMode) {
    if (next === "mix") {
      setMixSong(currentSong);
      if (currentSong && mixerJob?.source.song_id !== currentSong.id) setMixerJob(null);
    }
    changeMode(next);
  }
  function showMixProjects() {
    setMixSong(null);
    setMixerJob(null);
  }
  function closeMixer() {
    setMixerJob(null);
    changeMode("create");
  }
  const focusArea = useCallback((area: "creator" | "library") => {
    if (activeMode === "mix" || activeMode === "queue" || (activeMode === "remix" && area === "creator")) {
      pendingArea.current = area;
      changeMode("create");
    } else {
      focusStudioArea(area);
    }
  }, [activeMode, changeMode]);
  useAppMenu({
    macos: bootstrap.hardware.platform === "macos",
    ready: startupComplete && !closingAccepted && importState === null,
    studio: studio && blockingOperations === 0,
    settingsOpen,
    onFocusArea: focusArea,
    onSettings: page => {
      if (settingsOpen && page) setSettingsPage({page});
      else openSettings(page);
    },
  });
  const setFolderChoice=useCallback((value:string)=>{setFolder(value);remember("folder",value);},[]);
  const setLayoutChoice=useCallback((value:Layout)=>{setLayout(value);remember("desktop_layout",value);},[]);
  const registerFlush=useCallback((value:()=>Promise<void>)=>{flush.current=value;},[]);
  const selectModel=useCallback((next:ModelSelection)=>{intentRevision.current++;setSelection(next);},[]);
  const acceptSettingsModel=useCallback((next:ModelSelection,before:number)=>{
    if(intentRevision.current!==before)return;
    intentRevision.current++;
    if(activeMode==="remix"&&next.provider==="ace-step")setRemixChoice(next);
    else setSelection(next);
    setRequestedModel(null);
  },[activeMode]);
  const libraryInitialized=useCallback(()=>setLibraryReady(true),[]),formInitialized=useCallback(()=>setFormReady(true),[]),modelsInitialized=useCallback(()=>setModelsReady(true),[]),setupInitialized=useCallback(()=>setSetupReady(true),[]);
  const libraryFailed=useCallback((error:unknown)=>{if(!reported.current)report(error);},[report]);
  function remixSong(song: Song) {
    setRemixSource({ song, revision: ++intentRevision.current });
    changeMode("remix");
  }
  const back=useCallback(()=>{void navigate({to:"/studio"});},[navigate]);
  const manage=useCallback(()=>{setSettingsOpen(false);void navigate({to:"/setup"});},[navigate]);
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
    reported.current=true;void(async()=>{const attempt=startupAttempt(client);await invoke("startup_show_main",{attempt});await waitForPaint();await invoke("startup_complete",{attempt});setStartupComplete(true);})().catch(report);
  },[studio,libraryReady,formReady,modelsReady,setupReady,client,report]);
  useEffect(()=>{
    if(!studio||!libraryReady||!formReady||!modelsReady)return;
    const frame=requestAnimationFrame(()=>document.querySelector<HTMLInputElement>('#genForm input[name="title"]')?.focus({preventScroll:true}));
    return()=>cancelAnimationFrame(frame);
  },[studio,libraryReady,formReady,modelsReady]);
  useEffect(()=>{
    if (activeMode === "create" && pendingArea.current) {
      focusStudioArea(pendingArea.current);
      pendingArea.current = undefined;
    }
  }, [activeMode]);
  useEffect(()=>{
    if(!studio)return;
    const keyboard = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || document.querySelector("dialog[open]")) return;
      const area = event.code === "KeyB" ? "library" : event.code === "KeyN" ? "creator" : null;
      if (area) { event.preventDefault(); focusArea(area); }
    };
    document.addEventListener("keydown",keyboard);return()=>document.removeEventListener("keydown",keyboard);
  },[studio,focusArea]);
  const preferences = settings.data ?? bootstrap.settings;
  const recommended = preferences.recommended_profiles ?? bootstrap.recommended_profiles;
  const allowed = modelAllowed(selection ?? undefined, preferences.expert_mode, recommended);
  const remixModels = useRemixModels(studio && activeMode === "remix", remixChoice, selection, preferences);
  const remixSelection = remixModels.selection;
  const currentSelection = activeMode === "remix" ? remixSelection ?? null : selection;
  return <GenerationAdmissionProvider settingsBlocked={blocked}>
    <WindowBar onClose={close} studioControls={studio?{selection:currentSelection,inert:closingAccepted}:undefined}/><div className="glow" aria-hidden="true"/>
    <SceneContext.Provider value={{bootstrap:{...bootstrap,settings:settings.data??bootstrap.settings},complete,back,ready:setupInitialized,importLibrary}}><Outlet/></SceneContext.Provider>
    {!bootstrap.needs_setup && <div className="workspace" hidden={!studio} inert={closingAccepted || !studio}>
    <WorkspaceNavigation mode={activeMode} active={studio} onChange={navigateWorkspace} onSettings={()=>openSettings()}/>
    <div className="workspace-content">
    <main id="studio" hidden={!studioVisible} inert={closingAccepted || !studioVisible}>
      <div className={`wrap ${layout!=="stack"?"side":""}`}>
        {studio && mode !== "mix" && <Header selection={selection} reference={reference} brandOnly={mode === "remix"}
          blocked={blocked||closingAccepted} onAnalysis={(values,microphone)=>setAnalysis({values,microphone,revision:++intentRevision.current})}/>}
        <section className="card generation-card min-h-0" aria-labelledby="genHeading" hidden={mode !== "create"}>
          <h2 id="genHeading" className="sr-only">{t("gen_heading")}</h2>
          <ModelControls selection={selection} selectionRevision={reuse?.revision} onSelectionChange={selectModel} onManage={manage} onOpenSettings={openModelSettings} onOpenManager={openModelSettings} onOpenEngines={()=>openSettings("engines")} onOpenExpertSettings={()=>openSettings("general")} onReady={modelsInitialized}/>
          <GenerationForm selection={selection} reference={reference} onSelectionChange={selectModel} settingsBlocked={blocked||closingAccepted||mode!=="create"} modelAllowed={allowed} folderId={folder} reuse={reuse} analysis={analysis} recommendedSteps={recommendedSteps} onReady={formInitialized} onPreferencesFlush={registerFlush}/>
        </section>
        <section className="card generation-card min-h-0" aria-labelledby="remix-heading" hidden={mode !== "remix"}>
          <h2 id="remix-heading" className="sr-only">{t("workspace_remix")}</h2>
          <ModelPickerBar scope="remix" selection={remixSelection} options={remixModels.options}
            loading={remixModels.loading} disabled={blocked || closingAccepted || mode !== "remix" || !!remixModels.error} allowed
            onChange={value => {
              const next = remixModels.options.find(option => option.value === value);
              if (next) { intentRevision.current++; setRemixChoice(next.selection); }
            }} onManage={() => openModelSettings(remixSelection)} />
          {remixModels.error
            ? <ErrorState error={remixModels.error} retry={() => void remixModels.retry()} />
            : !remixSelection && !remixModels.loading && <p className="small" role="status">{t("remix_ace_required")}</p>}
          <RemixForm key={remixSource?.revision} song={remixSource?.song} selection={remixSelection} folder={folder}
            blocked={blocked || closingAccepted || mode !== "remix"}/>
        </section>
        <Library folder={folder} onFolderChange={setFolderChoice} selection={selection} onReuse={song=>{
          setReuse({song,revision:++intentRevision.current});
          changeMode("create");
        }} onRemix={remixSong} onReady={libraryInitialized} onError={libraryFailed} onStems={request=>{
          setMixerJob(null);
          setStemStudio(request);
        }}/>
      </div><Player mixerOpen={mixVisible}/>
    </main>
    {queueVisible && <QueueView onModels={()=>openSettings("models")} onEngines={()=>openSettings("engines")}/>}
    {mixSong && <main className="mixer-view" hidden={!originalMixVisible} inert={closingAccepted || !originalMixVisible}>
      <SongMixer key={mixSong.id} song={mixSong} active={originalMixVisible} onProject={setMixerJob}
        onBack={showMixProjects} onClose={closeMixer} onSeparate={()=>setMixerSeparation({ song: mixSong })}/>
    </main>}
    {originalMixVisible && !mixSong && <main className="mixer-view" inert={closingAccepted}>
      <StemStudio inline request={{ projects: true }} open close={()=>changeMode("create")} onMixer={setMixerJob}
        onOpenEngines={()=>openSettings("engines")} onOpenModels={()=>openSettings("stems")}/>
    </main>}
    {mixerJob&&<main id="stem-mixer-view" className="mixer-view" hidden={!mixVisible || Boolean(mixerPreview)} inert={closingAccepted || !mixVisible || Boolean(mixerPreview)}>
      <StemMixer job={mixerJob} key={mixerJob.id} active={mixVisible && !mixerPreview} onBack={showMixProjects}
        onClose={closeMixer} onOpenProject={setMixerJob} onOpenModels={openModelSettings}
        onNewSeparation={()=>setMixerSeparation({source:mixerJob.source,folder:mixerJob.request.folder_id??undefined})}/>
    </main>}
    {mixVisible&&mixerPreview&&<main className="mixer-view" inert={closingAccepted}>
      <StemMixer job={mixerPreview} onBack={()=>setMixerPreview(null)}
        onClose={closeMixer}/>
    </main>}
    </div></div>}
    <SettingsDialog open={settingsOpen} pageRequest={settingsPage} onClose={()=>setSettingsOpen(false)} onBusyChange={setSettingsBusy} modelManager={{selection:requestedModel??currentSelection,currentSelection,selectionRevision:intentRevision.current,onUse:acceptSettingsModel,onManage:manage,onRecommendedSteps:steps=>setRecommendedSteps({steps,revision:++intentRevision.current})}} onMoveLibrary={()=>setImportState({mode:"move",target:settings.data?.songs_dir??bootstrap.settings.songs_dir})} layout={layout} onLayoutChange={setLayoutChoice}/>
    {stemStudio&&<StemStudio key={stemStudio.song?.id ?? "all-projects"} request={stemStudio} open={studio&&!mixVisible} close={()=>setStemStudio(null)} onMixer={setMixerJob}
      onOpenEngines={()=>openSettings("engines")} onOpenModels={()=>openSettings("stems")}/>}
    {mixerSeparation&&<StemStudio request={mixerSeparation} open={mixVisible&&!mixerPreview} openQueuedResult={!mixerJob}
      close={()=>setMixerSeparation(null)} onMixer={job=>{
        if(job.request.preview){setMixerPreview(job);return;}
        setMixerSeparation(null);setMixerJob(job);
      }}
      onOpenEngines={()=>openSettings("engines")} onOpenModels={()=>openSettings("stems")}/>}
    {importState&&<ImportDialog open mode={importState.mode} songsDirectory={importState.target} platform={bootstrap.hardware.platform} onClose={()=>setImportState(null)} onImported={directory=>importState.done?.(directory)}/>}
  </GenerationAdmissionProvider>;
}
