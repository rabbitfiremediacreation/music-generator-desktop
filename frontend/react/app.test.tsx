// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory } from "@tanstack/react-router";
import { DesktopApp, createAppRouter } from "./app";
import { createAppQueryClient } from "./data";
import { setupFixture, standard } from "./setup/fixtures";
import { setLang } from "../i18n.js";
const mocks = vi.hoisted(()=>({invoke:vi.fn(),listen:vi.fn(),close:vi.fn(),confirm:vi.fn()}));
vi.mock("@tauri-apps/api/core",()=>({invoke:mocks.invoke,convertFileSrc:(path:string)=>path}));
vi.mock("@tauri-apps/api/event",()=>({listen:mocks.listen}));
vi.mock("@tauri-apps/api/window",()=>({getCurrentWindow:()=>({onCloseRequested:mocks.close,minimize:vi.fn(),toggleMaximize:vi.fn()})}));
vi.mock("@tauri-apps/plugin-dialog",()=>({confirm:mocks.confirm,open:vi.fn(),save:vi.fn()}));
vi.mock("@tauri-apps/plugin-opener",()=>({openUrl:vi.fn()}));
let firstRun=true;
beforeEach(()=>{
  vi.resetAllMocks();setLang("en");firstRun=true;
  mocks.listen.mockResolvedValue(()=>{});mocks.close.mockResolvedValue(()=>{});
  mocks.invoke.mockImplementation(async(name)=>{
    if(name==="bootstrap")return {...setupFixture,needs_setup:firstRun};
    if(name==="get_settings")return {...setupFixture.settings,recommended_profiles:[standard]};
    if(name==="generation_policy")return {backend:"cpu",cpu_iteration_behavior:"ask",recommended_steps:30,defaults:{duration:90,bpm:0,inference_steps:30,lm_temperature:1.2,variants:2}};
    if(name==="get_generation_form_preferences")return {duration:90,bpm:0,inference_steps:30,lm_temperature:1.2,variants:2};
    if(name==="setup_estimate")return {missing_bytes:0,free_bytes:1000000};
    if(name==="list_songs")return [];
    if(name==="list_folders")return {folders:[],all:0,none:0};
    if(name==="queue")return {running:[],queued:0,active:false,progress:null,library:{count:0,bytes:0}};
    if(name==="health")return {ok:true};
  });
});
afterEach(cleanup);
function mount(path="/"){
  const client=createAppQueryClient(),router=createAppRouter(client,createMemoryHistory({initialEntries:[path]}));
  render(<DesktopApp client={client} router={router}/>);return router;
}
it("keeps startup pending until the first library and saved form values are ready",async()=>{
  firstRun=false;const original=mocks.invoke.getMockImplementation()!;
  let finishPreferences!:(value:unknown)=>void,finishSongs!:(value:unknown)=>void;
  mocks.invoke.mockImplementation((name,args)=>name==="get_generation_form_preferences"?new Promise(resolve=>{finishPreferences=resolve;}):name==="list_songs"?new Promise(resolve=>{finishSongs=resolve;}):original(name,args));
  mount();
  await waitFor(()=>expect(finishSongs).toBeTypeOf("function"));
  expect(mocks.invoke.mock.calls.some(([name])=>name==="startup_complete")).toBe(false);
  finishSongs([]);
  await screen.findByText("Nothing yet");
  expect(mocks.invoke.mock.calls.some(([name])=>name==="startup_complete")).toBe(false);
  finishPreferences({duration:60,bpm:0,inference_steps:30,lm_temperature:1.2,variants:1});
  await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledWith("startup_complete"));
});
it("reports a failed initial library snapshot without completing startup",async()=>{
  firstRun=false;const original=mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((name,args)=>name==="list_songs"?Promise.reject(new Error("database busy")):original(name,args));
  mount();await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledWith("startup_error",{error:"database busy"}));
  expect(mocks.invoke.mock.calls.some(([name])=>name==="startup_complete")).toBe(false);
});
it("guards direct studio navigation and reports readiness after the initial wizard renders",async()=>{
  const router=mount("/studio");
  await screen.findByRole("heading",{name:"Welcome to Music Generator"});
  await waitFor(()=>expect(router.state.location.pathname).toBe("/setup"));
  await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledWith("startup_complete"));
  expect(mocks.invoke.mock.calls.filter(([name])=>name==="bootstrap")).toHaveLength(1);
});
it("keeps a studio draft when visiting setup and returning",async()=>{
  firstRun=false;mount();
  const prompt=await screen.findByRole("textbox",{name:"Prompt"});
  await waitFor(()=>expect((prompt as HTMLTextAreaElement).disabled).toBe(false));
  fireEvent.change(prompt,{target:{value:"keep this idea"}});
  fireEvent.click(screen.getByRole("button",{name:"Settings"}));
  fireEvent.click(await screen.findByRole("button",{name:"Reopen setup wizard…"}));
  await screen.findByRole("heading",{name:"Welcome to Music Generator"});
  fireEvent.click(screen.getByRole("button",{name:"Back to studio"}));
  await waitFor(()=>expect((screen.getByRole("textbox",{name:"Prompt"}) as HTMLTextAreaElement).value).toBe("keep this idea"));
  expect(mocks.invoke.mock.calls.filter(([name])=>name==="bootstrap")).toHaveLength(1);
});
