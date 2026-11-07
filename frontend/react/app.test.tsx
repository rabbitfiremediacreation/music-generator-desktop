// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory } from "@tanstack/react-router";
import { DesktopApp, createAppRouter } from "./app";
import { createAppQueryClient } from "./data";
import { measuredBackend, setupFixture, standard } from "./setup/fixtures";
import { setLang, t } from "../i18n.js";
import source from "../../models/catalog.json";
import type { PhoneAccess } from "../types";
const mocks = vi.hoisted(()=>({invoke:vi.fn(),listen:vi.fn(),close:vi.fn(),confirm:vi.fn()}));
vi.mock("@tauri-apps/api/core",()=>({invoke:mocks.invoke,convertFileSrc:(path:string)=>path}));
vi.mock("@tauri-apps/api/event",()=>({listen:mocks.listen}));
vi.mock("@tauri-apps/api/window",()=>({getCurrentWindow:()=>({onCloseRequested:mocks.close,minimize:vi.fn(),toggleMaximize:vi.fn()})}));
vi.mock("@tauri-apps/plugin-dialog",()=>({confirm:mocks.confirm,open:vi.fn(),save:vi.fn()}));
vi.mock("@tauri-apps/plugin-opener",()=>({openUrl:vi.fn()}));
let firstRun=true;
let phoneAccess:PhoneAccess;
beforeEach(()=>{
  vi.resetAllMocks();setLang("en");firstRun=true;
  phoneAccess={enabled:false,port:8767,token:"",addresses:["http://studio.local:8767"]};
  mocks.listen.mockResolvedValue(()=>{});mocks.close.mockResolvedValue(()=>{});
  mocks.invoke.mockImplementation(async(name,args)=>{
    if(name==="bootstrap")return {...setupFixture,needs_setup:firstRun};
    if(name==="get_settings")return {...setupFixture.settings,recommended_profiles:[standard]};
    if(name==="generation_policy")return {backend:"cpu",cpu_iteration_behavior:"ask",recommended_steps:30,defaults:{duration:90,bpm:0,inference_steps:30,lm_temperature:1.2,variants:2}};
    if(name==="get_generation_form_preferences")return {duration:90,bpm:0,inference_steps:30,lm_temperature:1.2,variants:2};
    if(name==="setup_estimate")return {missing_bytes:0,free_bytes:1000000};
    if(name==="setup_models")return {ok:true,mode:"single",backend_status:measuredBackend};
    if(name==="model_catalog")return {...source,selection:standard,expert_mode:false,recommended_profiles:[standard],hardware:setupFixture.hardware,free_bytes:null,models_dir:"/models",busy:false,title_model:{...setupFixture.title_model,verified:true,present:true,partial_bytes:0},models:source.models.map(model=>({...model,verified:true,present:true,partial_bytes:0}))};
    if(name==="list_songs")return [];
    if(name==="list_folders")return {folders:[],all:0,none:0};
    if(name==="queue")return {running:[],queued:0,active:false,progress:null,library:{count:0,bytes:0}};
    if(name==="health")return {ok:true};
    if(name==="phone_access_status")return {...phoneAccess};
    if(name==="set_phone_access"){
      phoneAccess={...phoneAccess,enabled:args.enabled??phoneAccess.enabled,token:"phone-key"};
      return {...phoneAccess};
    }
  });
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
async function mount(path="/"){
  const client=createAppQueryClient(),router=createAppRouter(client,createMemoryHistory({initialEntries:[path]}));
  await act(async()=>{
    render(<DesktopApp client={client} router={router}/>);
    await router.load();
  });
  return router;
}
it("keeps startup pending until the first library and saved form values are ready",async()=>{
  firstRun=false;const original=mocks.invoke.getMockImplementation()!;
  let finishPreferences!:(value:unknown)=>void,finishSongs!:(value:unknown)=>void;
  mocks.invoke.mockImplementation((name,args)=>name==="get_generation_form_preferences"?new Promise(resolve=>{finishPreferences=resolve;}):name==="list_songs"?new Promise(resolve=>{finishSongs=resolve;}):original(name,args));
  await mount();
  await waitFor(()=>expect(finishSongs).toBeTypeOf("function"));
  expect(mocks.invoke.mock.calls.some(([name])=>name==="startup_complete")).toBe(false);
  finishSongs([]);
  await screen.findByText("Nothing yet");
  expect(mocks.invoke.mock.calls.some(([name])=>name==="startup_complete")).toBe(false);
  finishPreferences({duration:60,bpm:0,inference_steps:30,lm_temperature:1.2,variants:1});
  await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledWith("startup_complete",{attempt:1}));
  await waitFor(()=>expect(document.activeElement).toBe(document.querySelector('#genForm input[name="title"]')));
});
it("reports a failed initial library snapshot without completing startup",async()=>{
  firstRun=false;const original=mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((name,args)=>name==="list_songs"?Promise.reject(new Error("database busy")):original(name,args));
  await mount();await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledWith("startup_error",{attempt:1,error:"database busy"}));
  expect(mocks.invoke.mock.calls.some(([name])=>name==="startup_complete")).toBe(false);
});
it("guards direct studio navigation and reports readiness after the initial wizard renders",async()=>{
  const router=await mount("/studio");
  await screen.findByRole("heading",{name:"Welcome to Music Generator"});
  await waitFor(()=>expect(router.state.location.pathname).toBe("/setup"));
  await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledWith("startup_complete",{attempt:1}));
  expect(mocks.invoke.mock.calls.filter(([name])=>name==="bootstrap")).toHaveLength(1);
});
it("lets a first-run user switch phone access on and off before configuring models",async()=>{
  const router=await mount("/studio");
  const access=await screen.findByRole("switch",{name:"Phone access"}) as HTMLInputElement;
  await waitFor(()=>expect(access.disabled).toBe(false));
  expect(router.state.location.pathname).toBe("/setup");
  expect(access.checked).toBe(false);

  fireEvent.click(access);
  await waitFor(()=>expect(access.checked).toBe(true));
  expect(mocks.invoke).toHaveBeenCalledWith("set_phone_access",{enabled:true,newToken:false});
  expect(await screen.findByTestId("phone-access-qr")).toBeTruthy();

  await waitFor(()=>expect(access.disabled).toBe(false));
  fireEvent.click(access);
  await waitFor(()=>expect(access.checked).toBe(false));
  expect(mocks.invoke).toHaveBeenCalledWith("set_phone_access",{enabled:false,newToken:false});
  expect(screen.queryByTestId("phone-access-qr")).toBeNull();
  expect(mocks.invoke.mock.calls.filter(([name])=>name==="setup_models")).toHaveLength(0);
});
it("keeps a studio draft when visiting setup and returning",async()=>{
  firstRun=false;await mount();
  const prompt=await screen.findByRole("textbox",{name:"Prompt"});
  await waitFor(()=>expect((prompt as HTMLTextAreaElement).disabled).toBe(false));
  fireEvent.change(prompt,{target:{value:"keep this idea"}});
  fireEvent.click(screen.getByRole("button",{name:"Settings"}));
  fireEvent.click(await screen.findByRole("button",{name:"Models and hardware"}));
  fireEvent.click(await screen.findByRole("button",{name:"Hardware test in setup wizard…"}));
  await screen.findByRole("heading",{name:"Welcome to Music Generator"});
  fireEvent.click(screen.getByRole("button",{name:"Back to studio"}));
  await waitFor(()=>expect((screen.getByRole("textbox",{name:"Prompt"}) as HTMLTextAreaElement).value).toBe("keep this idea"));
  expect(mocks.invoke.mock.calls.filter(([name])=>name==="bootstrap")).toHaveLength(1);
});

it.each([["de", "Modelle und Hardware", "Hardwaretest im Einrichtungsassistenten …"], ["en", "Models and hardware", "Hardware test in setup wizard…"]])("opens model management before explicitly running the existing hardware test in %s", async (language, entry, action) => {
  setLang(language); firstRun=false;
  const router=await mount();
  const prompt=await screen.findByRole("textbox",{name:t("prompt")});
  await waitFor(()=>expect((prompt as HTMLTextAreaElement).disabled).toBe(false));
  fireEvent.change(prompt,{target:{value:"keep this idea"}});
  fireEvent.click(screen.getByRole("button",{name:t("settings_title")}));
  fireEvent.click(await screen.findByRole("button",{name:entry}));
  const dialog=await screen.findByRole("dialog",{name:t("picker_title")});
  expect(screen.queryByRole("dialog",{name:t("settings_title")})).toBeNull();
  expect(router.state.location.pathname).toBe("/studio");
  await screen.findByRole("button",{name:t("picker_use")});
  expect(mocks.invoke.mock.calls.some(([name])=>["setup_models","use_models","select_models"].includes(name))).toBe(false);
  const testButton=screen.getByRole("button",{name:action});
  expect(document.getElementById(testButton.getAttribute("aria-describedby")!)?.textContent).toBe(t("desktop_manage_hint"));
  fireEvent.click(testButton);
  await waitFor(()=>expect(router.state.location.pathname).toBe("/setup"));
  expect(dialog.isConnected).toBe(false);
  for(let step=0;step<2;step++){
    const next=screen.getByRole("button",{name:t("setup_next")}) as HTMLButtonElement;
    await waitFor(()=>expect(next.disabled).toBe(false));
    fireEvent.click(next);
  }
  const start=screen.getByRole("button",{name:t("desktop_start")}) as HTMLButtonElement;
  await waitFor(()=>expect(start.disabled).toBe(false));
  expect(mocks.invoke.mock.calls.filter(([name])=>name==="setup_models")).toHaveLength(0);
  fireEvent.click(start);
  await screen.findByRole("heading",{name:t("backend_setup_result")});
  expect(mocks.invoke.mock.calls.filter(([name])=>name==="setup_models")).toEqual([["setup_models",{request:{models_dir:"/models",songs_dir:"/songs",lm:"1.7B",xl:false}}]]);
  fireEvent.click(screen.getByRole("button",{name:t("backend_enter_studio")}));
  await waitFor(()=>expect(router.state.location.pathname).toBe("/studio"));
  expect((screen.getByRole("textbox",{name:t("prompt")}) as HTMLTextAreaElement).value).toBe("keep this idea");
});

it.each(["pending", "failed"])("keeps setup reachable when the model catalog is %s", async status => {
  firstRun=false;
  const original=mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((name,args)=>name==="model_catalog"
    ? status==="pending" ? new Promise(()=>{}) : Promise.reject(new Error("catalog unavailable"))
    : original(name,args));
  const router=await mount();
  fireEvent.click(await screen.findByRole("button",{name:"Settings"}));
  fireEvent.click(await screen.findByRole("button",{name:"Models and hardware"}));
  await screen.findByRole("dialog",{name:"Models"});
  if(status==="failed")await screen.findByText("catalog unavailable");
  fireEvent.click(screen.getByRole("button",{name:"Hardware test in setup wizard…"}));
  await waitFor(()=>expect(router.state.location.pathname).toBe("/setup"));
  expect(mocks.invoke.mock.calls.some(([name])=>name==="setup_models")).toBe(false);
});

it("can reapply the same song twice even when the system clock has not advanced",async()=>{
  firstRun=false;
  const original=mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((name,args)=>name==="list_songs"?Promise.resolve([{id:"one",title:"Old",caption:"old prompt",letter:"",group_id:"g",status:"done",params:{prompt:"old prompt",inference_steps:30},result_meta:null,created_at:"2026-01-01",path:null}]):original(name,args));
  await mount();
  const reuse=await screen.findByRole("button",{name:"Copy settings to the form"});
  vi.spyOn(Date,"now").mockReturnValue(Date.now());
  const prompt=screen.getByRole("textbox",{name:"Prompt"});
  fireEvent.click(reuse);
  await waitFor(()=>expect((prompt as HTMLTextAreaElement).value).toBe("old prompt"));
  fireEvent.change(prompt,{target:{value:"an edit"}});
  fireEvent.click(reuse);
  await waitFor(()=>expect((prompt as HTMLTextAreaElement).value).toBe("old prompt"));
});

it("waits for native presentation before two main-window frames and binds readiness to the launch attempt",async()=>{
  let presented!:()=>void;
  const original=mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((name,args)=>name==="startup_show_main"?new Promise<void>(resolve=>{presented=resolve;}):original(name,args));
  const frames:FrameRequestCallback[]=[];
  vi.spyOn(window,"requestAnimationFrame").mockImplementation(callback=>{frames.push(callback);return frames.length;});
  const client=createAppQueryClient(4),router=createAppRouter(client,createMemoryHistory({initialEntries:["/"]}));
  await act(async()=>{
    render(<DesktopApp client={client} router={router}/>);
    await router.load();
  });
  await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledWith("startup_show_main",{attempt:4}));
  expect(mocks.invoke).toHaveBeenCalledWith("bootstrap",{attempt:4});
  expect(mocks.invoke).not.toHaveBeenCalledWith("startup_complete",{attempt:4});
  expect(frames).toHaveLength(0);
  await act(async()=>{presented();});
  await waitFor(()=>expect(frames).toHaveLength(1));
  frames.shift()!(0);await Promise.resolve();
  expect(mocks.invoke).not.toHaveBeenCalledWith("startup_complete",{attempt:4});
  frames.shift()!(16);
  await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledWith("startup_complete",{attempt:4}));
});
