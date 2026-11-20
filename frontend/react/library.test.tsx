// @vitest-environment happy-dom
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Library } from "./library/Library";
import { I18nProvider } from "./i18n";
import { createAppQueryClient } from "./data";
import { Player, PlayerProvider } from "./player";
import { GenerationAdmissionProvider } from "./generation/admission";
import { setLang } from "../i18n.js";
import type { Song } from "../types";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, convertFileSrc:(path:string)=>`asset:${path}` }));
const waveform={loadBlob:vi.fn(),play:vi.fn(),pause:vi.fn(),playPause:vi.fn(),destroy:vi.fn(),on:vi.fn(),setVolume:vi.fn(),getDuration:()=>10,getCurrentTime:()=>0};
let songs: Song[];
beforeEach(() => {
  setLang("en");
  Object.values(waveform).forEach(method=>{if(vi.isMockFunction(method))method.mockReset();});
  waveform.loadBlob.mockResolvedValue(undefined);waveform.play.mockResolvedValue(undefined);waveform.on.mockReturnValue(()=>{});
  Object.assign(window,{WaveSurfer:{create:()=>waveform}});
  vi.stubGlobal("ResizeObserver",class {observe(){}disconnect(){}});
  songs = [{id:"one",title:"A song",caption:"night",letter:"A",group_id:"g",status:"done",favorite:false,params:{inference_steps:200},result_meta:{duration: 8,duration_source:"wav",inference_steps_limit:200,effective_inference_steps:200},created_at:"2026-01-01",lyrics:"[Instrumental]",finished_at:null,message:null,seed:1,file:null,audio_missing:false,folder_id:null,path:null}];
  mocks.invoke.mockReset().mockImplementation(async (name,args) => {
    if(name === "read_song_audio") return new Uint8Array([82,73,70,70]).buffer;
    if(name === "list_song_page") {
      const { filter, offset, limit } = args;
      const matching = songs.filter(song => (!filter.favorites || song.favorite)
        && (!filter.folder || song.folder_id === filter.folder)
        && (!filter.q || song.title?.includes(filter.q)));
      return { songs: matching.slice(offset, offset + limit), total: matching.length };
    }
    if(name === "list_folders") {
      const count=songs.filter(song=>song.folder_id==="ideas").length;
      return {folders:count?[{id:"ideas",name:"Ideas",count}]:[],all:songs.length,none:songs.length-count};
    }
    if(name === "queue") return {running:[],queued:0,active:false,progress:null,library:{count:songs.length,bytes:1000}};
    if(name === "get_settings") return {export_format:"wav"};
    if(name === "cancel_song") {
      const active = songs.find(song => song.id === args.id && (song.status === "queued" || song.status === "running"));
      if (!active) return false;
      songs = songs.map(song => song === active ? {...song, status:"cancelled"} : song);
      return true;
    }
    if(name === "delete_song") {songs=songs.filter(song=>song.id!==args.id);return;}
    if(name === "patch_song") {songs = songs.map(song => song.id === args.id ? {...song,...args.patch} : song);return songs[0];}
  });
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function mount(withPlayer=false) {
  const client = createAppQueryClient();
  function TestLibrary() {
    const [folder,setFolder]=useState("");
    return <Library folder={folder} onFolderChange={setFolder} onReuse={() => {}} selection={null}/>;
  }
  render(<QueryClientProvider client={client}><I18nProvider><GenerationAdmissionProvider><PlayerProvider><TestLibrary/>{withPlayer&&<Player/>}</PlayerProvider></GenerationAdmissionProvider></I18nProvider></QueryClientProvider>);
  return client;
}

function seedPages(count: number) {
  const song = songs[0];
  songs = Array.from({length:count}, (_,index) => ({
    ...song,
    id:`song-${index}`,
    title:`${index%2===0?"Piano":"Drums"} ${index}`,
    letter:"",
    favorite:index%2===0,
    folder_id:index%2===0?"ideas":null,
  }));
}

it("navigates both ways and resets the page when search, folder or favorites changes", async () => {
  seedPages(106);
  mount();
  const next=await screen.findByRole("button",{name:"Next"});
  const previous=screen.getByRole("button",{name:"Previous"});
  expect(previous).toHaveProperty("disabled",true);
  expect(screen.getByText("Page 1 of 3")).toBeTruthy();
  fireEvent.click(next);
  await screen.findByText("Piano 50");
  expect(screen.queryByText("Drums 49")).toBeNull();
  fireEvent.click(next);
  await screen.findByText("Drums 105");
  expect(screen.getByText("Page 3 of 3")).toBeTruthy();
  expect(next).toHaveProperty("disabled",true);
  fireEvent.click(previous);
  await screen.findByText("Piano 50");

  fireEvent.change(screen.getByRole("searchbox"),{target:{value:"Piano"}});
  await waitFor(()=>expect(document.querySelector("#library article:last-child")?.textContent).toContain("Piano 98"));
  expect(screen.getByText("Page 1 of 2")).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Next"}));
  await screen.findByText("Piano 104");
  fireEvent.click(screen.getByRole("button",{name:"Ideas 53"}));
  await screen.findByText("Piano 0");
  expect(screen.getByText("Page 1 of 2")).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Next"}));
  await screen.findByText("Piano 104");
  fireEvent.click(screen.getByRole("button",{name:"Show favorites only"}));
  await screen.findByText("Piano 0");
  expect(screen.getByText("Page 1 of 2")).toBeTruthy();
  expect(mocks.invoke).toHaveBeenLastCalledWith("list_song_page",{
    filter:{q:"Piano",folder:"ideas",favorites:true},offset:0,limit:50,
  });
});

it("returns to the remaining page when deletion removes the last page", async () => {
  seedPages(51);
  mount();
  fireEvent.click(await screen.findByRole("button",{name:"Next"}));
  await screen.findByText("Piano 50");
  fireEvent.click(screen.getByRole("button",{name:"Delete"}));
  fireEvent.click(screen.getByRole("button",{name:"Delete song?"}));
  await screen.findByText("Piano 0");
  expect(screen.queryByRole("navigation",{name:"Library pages"})).toBeNull();
  expect(screen.queryByText("Piano 50")).toBeNull();
});
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

it("shows each Magenta recording observation separately from the WAV duration", async () => {
  songs[0].result_meta = {
    duration: 12, duration_source: "wav",
    stream_metrics: { first_audio_ms: 750, underrun_blocks: 0, peak_rss_bytes: 2 ** 30, realtime: true },
  };
  mount();
  expect(await screen.findByText("First audio after 0.75 s")).toBeTruthy();
  expect(screen.getByText("0 underrun blocks")).toBeTruthy();
  expect(screen.getByText("Peak resident RAM 1 GiB")).toBeTruthy();
  expect(screen.getByText("Real-time capture verified")).toBeTruthy();
  expect(screen.getByText(/0:12/)).toBeTruthy();
});

it("shows measured MiniMax audio, runtime provenance and the publication reminder", async () => {
  songs[0].params = { model_selection: { provider: "minimax-music3", synthesis: "fixed-profile", language: "" } };
  songs[0].result_meta = {
    duration: 27.53, duration_source: "wav", runtime: "audio.cpp", runtime_revision: "1234567890abcdef",
    audio_format: { container: "wav", encoding: "pcm", sample_rate_hz: 44100, channels: 2, bits_per_sample: 16 },
    machine_generated: true, generated_by: "MiniMax-Music3",
  };
  mount();
  expect(await screen.findByText("0:27")).toBeTruthy();
  expect(screen.getByText("WAV PCM 16-bit · 44.1 kHz · 2 ch", { exact: false })).toBeTruthy();
  expect(screen.getByText("audio.cpp 12345678")).toHaveProperty("title", "1234567890abcdef");
  expect(screen.getByText("AI-generated with MiniMax-Music3")).toBeTruthy();
  const note = screen.getByRole("note");
  expect(note.textContent).toContain("Clearly label the audio as AI-generated if you publish it.");
  expect(screen.getByRole("button", { name: "Download" }).getAttribute("aria-describedby")).toBe(note.id);
});

it.each([
  ["minimax-music3", { prompt: true, lyrics: true, instrumental: false }],
  ["heartmula", { prompt: false, lyrics: true, instrumental: false }],
  ["stable-audio-3", { prompt: true, lyrics: false, instrumental: true }],
  ["magenta-realtime-2", { prompt: true, lyrics: false, instrumental: true }],
] as const)("uses the saved %s capabilities when requesting another variant", async (provider, capabilities) => {
  const caption = "Global Metadata: pop\nVocal Details: warm\nArrangement: keys";
  const { prompt, lyrics, instrumental } = capabilities;
  const params = {
    caption, duration: 27, lyrics: lyrics ? "[Verse]\nAt dawn" : "", style: prompt ? "" : "synth pop",
    model_selection: { provider, synthesis: "fixed-profile", language: "" },
    generation_profile: { capabilities },
  };
  songs[0].params = params;
  const original = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((name, args) => {
    if (name === "generation_policy") return Promise.resolve({ backend: "gpu", capabilities: { advanced: false } });
    if (name === "generate") return Promise.resolve({ ids: ["variant"] });
    return original(name, args);
  });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Another variant (new seed)" }));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("generate", expect.anything()));
  const request = mocks.invoke.mock.calls.find(([name]) => name === "generate")?.[1].request;
  if (prompt) expect(request).toHaveProperty("caption", caption);
  else expect(request).not.toHaveProperty("caption");
  expect(request).toHaveProperty("instrumental", instrumental);
});

it("shows the variance with up to two decimals",async()=>{
  songs[0].params={inference_steps:0,lm_temperature:0.85};songs[0].result_meta={};
  const view=mount();await screen.findByText("A song A");
  expect(document.querySelector(".song .m")!.textContent).toBe("0.85VAR");
  songs[0]={...songs[0],params:{inference_steps:0,lm_temperature:1.2}};
  await view.invalidateQueries({queryKey:["songs"]});
  await screen.findByText("1.2VAR");
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

it("shows measured clip seconds and keeps the meter for a new library variant", async () => {
  const selection = { provider: "mimetic-a0", synthesis: "mimetic-a0-model.fp16.safetensors", language: "" };
  const params = { model_selection: selection, prompt: "jazzy swung drums", caption: "jazzy swung drums", instrumental: true, bars: 1, bpm: 300, duration: 0.8, seed: 42 };
  songs[0].params = params;
  songs[0].result_meta = { duration: 0.8, duration_source: "wav", bpm: 300 };
  const original = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((name, args) => {
    if (name === "generation_policy") return Promise.resolve({ backend: "gpu", cpu_iteration_behavior: "ask" });
    if (name === "generate") return Promise.resolve({ ids: ["new-clip"] });
    return original(name, args);
  });
  mount();
  expect(await screen.findByText("300BPM · 0.8 s")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Another variant (new seed)" }));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("generate", { request: {
    model_selection: selection, prompt: "jazzy swung drums", instrumental: true, bars: 1, bpm: 300,
    duration: 0.8, seed: -1, variants: 1, keep_caption: true, title: "A song", folder_id: null, group_id: "g",
  } }));
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

it("only invokes cancellation when a running row is stale", async () => {
  songs[0].status = "running";
  mount();
  const cancel = await screen.findByRole("button", {name:"Cancel"});
  songs[0] = {...songs[0], status:"done", file:"one.wav", path:"/songs/one.wav"};

  fireEvent.click(cancel);

  expect(await screen.findByRole("button", {name:"Play"})).toBeTruthy();
  expect(mocks.invoke).toHaveBeenCalledWith("cancel_song", {id:"one"});
  expect(mocks.invoke).not.toHaveBeenCalledWith("delete_song", {id:"one"});
  expect(screen.getByRole("button", {name:"Delete"})).toBeTruthy();
});

it("stops playback and clears the player only after a successful confirmed deletion",async()=>{
  songs[0].path="/songs/one.wav";mount(true);
  fireEvent.click(await screen.findByRole("button",{name:"Play"}));
  await waitFor(()=>expect(waveform.play).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button",{name:"Delete"}));
  expect(mocks.invoke).not.toHaveBeenCalledWith("delete_song", {id:"one"});
  expect(document.querySelector<HTMLElement>("#player")!.hidden).toBe(false);
  fireEvent.click(screen.getByRole("button",{name:"Delete song?"}));
  await waitFor(()=>expect(document.querySelector<HTMLElement>("#player")!.hidden).toBe(true));
  expect(mocks.invoke).toHaveBeenCalledWith("delete_song", {id:"one"});
  await screen.findByText("Nothing yet");
  expect(document.querySelector("#pTitle")!.textContent).toBe("");
  expect(waveform.destroy).toHaveBeenCalledOnce();
});
it("keeps the loaded song after a rejected deletion or a filtered library refresh",async()=>{
  songs[0].path="/songs/one.wav";
  const original=mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((name,args)=>name==="delete_song"?Promise.reject(new Error("permission denied")):original(name,args));
  mount(true);fireEvent.click(await screen.findByRole("button",{name:"Play"}));
  await waitFor(()=>expect(waveform.play).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button",{name:"Delete"}));fireEvent.click(screen.getByRole("button",{name:"Delete song?"}));
  await screen.findByRole("alert");
  expect(document.querySelector<HTMLElement>("#player")!.hidden).toBe(false);expect(waveform.destroy).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Show favorites only"}));await screen.findByText("Nothing yet");
  expect(document.querySelector("#pTitle")!.textContent).toBe("A song");expect(waveform.destroy).not.toHaveBeenCalled();
});
