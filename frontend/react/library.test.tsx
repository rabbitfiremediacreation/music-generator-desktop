// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Library } from "./library/Library";
import { I18nProvider } from "./i18n";
import { createAppQueryClient } from "./data";
import { PlayerProvider } from "./player";
import { GenerationAdmissionProvider } from "./generation/admission";
import { setLang } from "../i18n.js";
import type { Song } from "../types";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, convertFileSrc:(path:string)=>`asset:${path}` }));
let songs: Song[];
beforeEach(() => {
  setLang("en");
  songs = [{id:"one",title:"A song",caption:"night",letter:"A",group_id:"g",status:"done",favorite:false,params:{inference_steps:200},result_meta:{duration: 8,duration_source:"wav",inference_steps_limit:200,effective_inference_steps:200},created_at:"2026-01-01",lyrics:"[Instrumental]",finished_at:null,message:null,seed:1,file:null,audio_missing:false,folder_id:null,path:null}];
  mocks.invoke.mockReset().mockImplementation(async (name,args) => {
    if(name === "list_songs") return songs.filter(song => !args.filter.favorites || song.favorite);
    if(name === "list_folders") return {folders:[],all:songs.length,none:songs.length};
    if(name === "queue") return {running:[],queued:0,active:false,progress:null,library:{count:songs.length,bytes:1000}};
    if(name === "get_settings") return {export_format:"wav"};
    if(name === "patch_song") {songs = songs.map(song => song.id === args.id ? {...song,...args.patch} : song);return songs[0];}
  });
});
afterEach(cleanup);
function mount() {
  const client = createAppQueryClient();
  render(<QueryClientProvider client={client}><I18nProvider><GenerationAdmissionProvider><PlayerProvider><Library folder="" onFolderChange={() => {}} onReuse={() => {}} selection={null}/></PlayerProvider></GenerationAdmissionProvider></I18nProvider></QueryClientProvider>);
  return client;
}
it("updates the favorite view after mutation and preserves inline edits during a refresh", async () => {
  const client = mount();
  await screen.findByText("A song A");
  expect(screen.getByText(/200IT/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Show favorites only"}));
  await screen.findByText("Nothing yet");
  fireEvent.click(screen.getByRole("button",{name:"Show favorites only"}));
  await screen.findByText("A song A");
  fireEvent.click(screen.getByRole("button",{name:"Favorite"}));
  await waitFor(() => expect(songs[0].favorite).toBe(true));
  fireEvent.click(screen.getByRole("button",{name:/A song A · Click to rename/}));
  const input = screen.getByRole("textbox",{name:"Click to rename"});
  fireEvent.change(input,{target:{value:"still editing"}});
  await client.invalidateQueries({queryKey:["songs"]});
  expect((input as HTMLInputElement).value).toBe("still editing");
  fireEvent.keyDown(input,{key:"Enter"});
  await screen.findByText("still editing A");
});

it.each([
  ["done",120,{effective_inference_steps:60},"60IT"],
  ["done",120,{inference_steps:120},"100IT"],
  ["queued",200,null,"200IT"],
  ["running",200,null,"200IT"],
  ["error",200,null,"200IT"],
] as const)("keeps measured execution distinct from the %s historical request",async(status,steps,meta,expected)=>{
  songs[0]={...songs[0],status,params:{inference_steps:steps},result_meta:meta};
  mount();expect(await screen.findByText(expected)).toBeTruthy();
  expect(songs[0].params.inference_steps).toBe(steps);
});

it.each([["short_audio",22,"Kürzer als angefordert: 0:22 statt 0:30."],["long_audio",44,"Länger als angefordert: 0:44 statt 0:30."]] as const)("renders the measured %s warning",async(code,actual,text)=>{
  setLang("de");songs[0].result_meta={duration:actual,duration_source:"wav",duration_warning:{code,requested_seconds:30,actual_seconds:actual}};
  mount();expect(await screen.findByRole("note")).toHaveProperty("textContent",text);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("hides unverified duration and unknown automatic iterations",async()=>{
  songs[0].params={inference_steps:0};songs[0].result_meta={duration:85};
  const view=mount();await screen.findByText("A song A");
  expect(document.querySelector(".song .m")!.textContent).toBe("");
  songs[0]={...songs[0],result_meta:{duration:29.8,duration_source:"wav"}};
  await view.invalidateQueries({queryKey:["songs"]});
  await screen.findByText("0:29");
  expect(screen.queryByRole("note")).toBeNull();
});

it("allows selecting lyrics without starting a song drag",async()=>{
  const original=mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((name,args)=>name==="list_folders"?Promise.resolve({folders:[{id:"ideas",name:"Ideas",count:1}],all:1,none:0}):original(name,args));
  songs[0].lyrics="[Verse] lyrics";songs[0].result_meta={lyrics:"Select this lyric text"};
  mount();fireEvent.click(await screen.findByRole("button",{name:"Show the lyrics the model wrote"}));
  const lyric=screen.getByText("Select this lyric text");
  fireEvent.mouseDown(lyric);
  expect(lyric.closest("article")!.getAttribute("draggable")).toBe("false");
});

it("localizes a rejected library variant instead of exposing a backend message key",async()=>{
  const original=mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((name,args)=>{
    if(name==="generation_policy")return Promise.resolve({backend:"gpu",recommended_steps:80,cpu_iteration_behavior:"ask",defaults:{duration:90,bpm:0,inference_steps:80,lm_temperature:1.2,variants:2}});
    if(name==="generate")return Promise.reject(new Error("expert_mode_required"));
    return original(name,args);
  });
  mount();fireEvent.click(await screen.findByRole("button",{name:"Another variant (new seed)"}));
  const alert=await screen.findByRole("alert");
  expect(alert.textContent).toContain("Expert Mode");
  expect(alert.textContent).not.toContain("expert_mode_required");
});

it("resets delete confirmation after a keyboard or screenreader click on another action",async()=>{
  mount();fireEvent.click(await screen.findByRole("button",{name:"Delete"}));
  expect(screen.getByRole("button",{name:"Delete song?"})).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Favorite"}));
  expect(screen.getByRole("button",{name:"Delete"})).toBeTruthy();
});

it("translates the existing admission message for unverified models",async()=>{
  setLang("de");const original=mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((name,args)=>{
    if(name==="generation_policy")return Promise.resolve({backend:"gpu",recommended_steps:80,cpu_iteration_behavior:"ask",defaults:{duration:90,bpm:0,inference_steps:80,lm_temperature:1.2,variants:2}});
    if(name==="generate")return Promise.reject(new Error("Open the ModelPicker and download or verify the selected models first"));
    return original(name,args);
  });
  mount();fireEvent.click(await screen.findByRole("button",{name:"Weitere Variante (neuer Seed)"}));
  expect((await screen.findByRole("alert")).textContent).toContain("Dieses Modell ist noch nicht einsatzbereit.");
});

it("translates the completion announcement when the interface language changes",async()=>{
  songs[0].status="running";const client=mount();await screen.findByText("A song A");
  songs[0]={...songs[0],status:"done"};await client.invalidateQueries({queryKey:["songs"]});
  await waitFor(()=>expect(screen.getByRole("status").textContent).toBe("Done: A song A"));
  act(()=>setLang("de"));
  expect(screen.getByRole("status").textContent).toBe("Fertig: A song A");
});
