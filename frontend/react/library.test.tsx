// @vitest-environment happy-dom
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Library } from "./library/Library";
import { I18nProvider } from "./i18n";
import { createAppQueryClient } from "./data";
import { Player, PlayerProvider } from "./player";
import { GenerationAdmissionProvider } from "./generation/admission";
import { setLang, t } from "../i18n.js";
import type { ModelSelection, Song } from "../types";
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, convertFileSrc:(path:string, scheme = "asset")=>`${scheme}:${path}` }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: async ({ defaultPath }: { defaultPath: string }) => defaultPath }));
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
function mount(withPlayer=false, selection: ModelSelection | null = null) {
  const client = createAppQueryClient();
  function TestLibrary({ model }: { model: ModelSelection | null }) {
    const [folder,setFolder]=useState("");
    return <Library folder={folder} onFolderChange={setFolder} onReuse={() => {}} selection={model}/>;
  }
  const tree = (model: ModelSelection | null) => <QueryClientProvider client={client}><I18nProvider><GenerationAdmissionProvider><PlayerProvider><TestLibrary model={model}/>{withPlayer&&<Player/>}</PlayerProvider></GenerationAdmissionProvider></I18nProvider></QueryClientProvider>;
  const view = render(tree(selection));
  return Object.assign(client, { switchModel: (model: ModelSelection) => view.rerender(tree(model)) });
}

async function openDetails(name = "A song A") {
  const row = within(await screen.findByRole("article", { name }));
  const toggle = row.getByRole("button", { name });
  if (toggle.getAttribute("aria-expanded") === "false") fireEvent.click(toggle);
  return row;
}

async function openActions(name = "A song A") {
  const row = within(await screen.findByRole("article", { name }));
  fireEvent.click(row.getByRole("button", { name: t("song_actions") }));
  return within(screen.getByRole("menu", { name: t("song_actions") }));
}

it("opens only the selected song and selects a song when playback starts", async () => {
  songs.push({ ...songs[0], id: "two", title: "Second song", path: "/songs/two.wav" });
  mount(true);
  const first = within(await screen.findByRole("article", { name: "A song A" }));
  const second = within(screen.getByRole("article", { name: "Second song A" }));
  const firstTitle = first.getByRole("button", { name: "A song A" });
  const secondTitle = second.getByRole("button", { name: "Second song A" });
  expect(firstTitle.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(first.getByText("0:08"));
  expect(firstTitle.getAttribute("aria-expanded")).toBe("true");
  expect(mocks.invoke).not.toHaveBeenCalledWith("read_song_audio", expect.anything());
  fireEvent.click(second.getByRole("button", { name: "Play" }));
  await waitFor(() => expect(waveform.play).toHaveBeenCalledOnce());
  expect(secondTitle.getAttribute("aria-expanded")).toBe("true");
  expect(firstTitle.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(firstTitle);
  expect(secondTitle.getAttribute("aria-expanded")).toBe("false");
  expect(document.querySelector("#pTitle")?.textContent).toBe("Second song");
  fireEvent.click(firstTitle);
  expect(firstTitle.getAttribute("aria-expanded")).toBe("false");
});

it("uses the ellipsis as a keyboard-accessible action menu independently of song details", async () => {
  mount();
  const row = within(await screen.findByRole("article", { name: "A song A" }));
  const title = row.getByRole("button", { name: "A song A" });
  const trigger = row.getByRole("button", { name: "Song actions" });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const menu = within(screen.getByRole("menu", { name: "Song actions" }));
  const rename = menu.getByRole("menuitem", { name: "Rename" });
  expect(document.activeElement).toBe(rename);
  expect(title.getAttribute("aria-expanded")).toBe("false");
  fireEvent.keyDown(rename, { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(title);
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
  expect(screen.queryByRole("menu")).toBeNull();
  expect(row.getByRole("textbox")).toHaveProperty("value", "A song");
  expect(row.getByText("Iterations 200")).toBeTruthy();
  expect(mocks.invoke).not.toHaveBeenCalledWith("read_song_audio", expect.anything());
});

it("moves a song from its action menu only after the destination is confirmed", async () => {
  songs.push({ ...songs[0], id: "two", title: "Second song", folder_id: "ideas" });
  mount();
  const move = async () => {
    fireEvent.click((await openActions()).getByRole("menuitem", { name: "Move to folder" }));
    const dialog = within(screen.getByRole("dialog", { name: "Move to folder" }));
    fireEvent.change(dialog.getByRole("combobox"), { target: { value: "ideas" } });
    return dialog;
  };
  fireEvent.click((await move()).getByRole("button", { name: "Cancel" }));
  expect(mocks.invoke).not.toHaveBeenCalledWith("patch_song", expect.anything());
  fireEvent.click((await move()).getByRole("button", { name: t("save") }));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("patch_song", { id: "one", patch: { folder_id: "ideas" } }));
  expect(screen.getByRole("button", { name: "A song A" }).getAttribute("aria-expanded")).toBe("false");
});

it("shows the model license and the song's own usage badge before and after selection", async () => {
  songs[0].params.model_selection = { provider: "yue2", synthesis: "yue2/YuE2-3B-Q5_K_M.gguf", language: "" };
  songs[0].result_meta = { output_usage: {
    text: "Individual creators may release, sell, and license generated songs, including to clients, without license fees or mandatory output credit. Follow MAP’s responsible-use terms and obtain the necessary rights and consent.",
    source_urls: ["https://github.com/multimodal-art-projection/YuE/blob/cbb3b060725ddd95ac6e6237cfb709e153da5988/MODEL_LICENSE",
      "https://huggingface.co/m-a-p/YuE2-3B/blob/1a96eca688d6ae5d7f0feb88573fec89920fcd19/LICENSE"],
  } };
  mount(false, { provider: "audiocraft", synthesis: "musicgen-small", language: "" });
  const row = within(await screen.findByRole("article", { name: "A song A" }));
  const badges = () => within(row.getByRole("group", { name: "Usage terms" }));
  expect(badges().getByText("CC-BY-NC-4.0")).toBeTruthy();
  expect(badges().getByText("Individual creators may sell")).toBeTruthy();
  expect(row.queryByText(/Individual creators may release/)).toBeNull();
  fireEvent.click(badges().getByText("Individual creators may sell"));
  expect(row.getByRole("button", { name: "A song A" }).getAttribute("aria-expanded")).toBe("true");
  expect(row.getByText(/Individual creators may release/)).toBeTruthy();
  expect(badges().getByText("CC-BY-NC-4.0")).toBeTruthy();
  expect(badges().getByText("Individual creators may sell")).toBeTruthy();
});

it("shows known model licenses for queued songs and adds output terms after completion", async () => {
  songs[0].status = "queued";
  songs[0].params.model_selection = { provider: "yue2", synthesis: "yue2/YuE2-3B-Q5_K_M.gguf", language: "" };
  const client = mount();
  const row = within(await screen.findByRole("article", { name: "A song A" }));
  expect(row.getByText("CC-BY-NC-4.0")).toBeTruthy();
  expect(row.queryByText("Individual creators may sell")).toBeNull();
  songs[0] = { ...songs[0], status: "done" };
  await client.invalidateQueries({ queryKey: ["songs"] });
  expect(await row.findByText("Individual creators may sell")).toBeTruthy();
});

it("shows each song's saved model and variant after reopening with another active profile", async () => {
  const ace = { provider: "ace-step", synthesis: "acestep-v15-sft-Q8_0.gguf", language: "acestep-5Hz-lm-4B-Q8_0.gguf" };
  const yue = { provider: "yue2", synthesis: "yue2/YuE2-3B-Q5_K_M.gguf", language: "" };
  songs[0].params = { model_selection: ace };
  songs.push({ ...songs[0], id: "yue", title: "Another song", params: { model_selection: yue } });

  const expectSavedModels = async () => {
    const first = await openDetails();
    expect(first.getByText("Music model: ACE-Step 1.5 SFT · Q8_0 · LM 4B-Q8_0")).toBeTruthy();
    const second = await openDetails("Another song A");
    expect(second.getByText("Music model: YuE2 3B · Q5_K_M")).toBeTruthy();
  };
  const library = mount(false, ace);
  await expectSavedModels();
  library.switchModel(yue);
  await expectSavedModels();
  cleanup();
  library.clear();
  mount(false, yue);
  await expectSavedModels();

  expect(mocks.invoke.mock.calls.filter(([name]) => name === "list_song_page")).toHaveLength(2);
  expect(mocks.invoke.mock.calls.some(([name]) => name === "generate")).toBe(false);
});

it("generates a cover for a saved song with automatic cover generation off", async () => {
  songs[0].path = "/songs/one.wav";
  const invoke = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation(async (name, args) => {
    if (name === "get_settings") return { export_format: "wav", generate_cover_art: false, cover_art_supported: true, cover_art_installed: true };
    if (name === "generate_song_cover") {
      songs = songs.map(song => song.id === args.id ? { ...song, cover_path: "/songs/one.cover.png" } : song);
      return;
    }
    return invoke(name, args);
  });
  mount();
  fireEvent.click((await openActions()).getByRole("menuitem", { name: "Generate cover art" }));
  const cover = await screen.findByAltText("Generated cover art");
  expect(cover.getAttribute("src")).toBe("cover-thumb:one");
  const fullSize = () => document.querySelector('img[src="asset:/songs/one.cover.png"]');
  expect(fullSize()).toBeNull();
  const play = screen.getByRole("button", { name: "Play" });
  fireEvent.mouseEnter(play);
  expect(fullSize()).toBeTruthy();
  fireEvent.mouseLeave(play);
  expect(fullSize()).toBeNull();
  expect(mocks.invoke).toHaveBeenCalledWith("generate_song_cover", { id: "one" });
  expect(mocks.invoke.mock.calls.some(([name]) => name === "generate")).toBe(false);
});

it("reports a rejected cover action even when the song is collapsed", async () => {
  songs[0].path = "/songs/one.wav";
  const original = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((name, args) => {
    if (name === "get_settings") return Promise.resolve({ export_format: "wav", cover_art_supported: true, cover_art_installed: true });
    if (name === "generate_song_cover") return Promise.reject("cover_art_engine_denied");
    return original(name, args);
  });
  mount();
  fireEvent.click((await openActions()).getByRole("menuitem", { name: "Generate cover art" }));
  expect((await screen.findByRole("alert")).textContent).toContain(t("cover_art_engine_denied"));
});

it("uses only recorded origins when old songs lack a saved model selection", async () => {
  setLang("de");
  const legacy = songs[0];
  legacy.engine = "acestep_cpp";
  songs.push(
    { ...legacy, id: "profile", title: "Profil", engine: null, params: { generation_profile: { provider: "heartmula", model_revision: "saved-pin" } } },
    { ...legacy, id: "unknown", title: "Ohne Herkunft", engine: null },
  );
  mount(false, { provider: "yue2", synthesis: "yue2/YuE2-3B-Q5_K_M.gguf", language: "" });

  await openDetails();
  expect(await screen.findByText("Musikmodell: ACE-Step · Variante unbekannt")).toBeTruthy();
  await openDetails("Profil A");
  expect(screen.getByText("Musikmodell: HeartMuLa · Variante unbekannt")).toHaveProperty("title", "Modellrevision: saved-pin");
  await openDetails("Ohne Herkunft A");
  expect(within(screen.getByRole("article", { name: "Ohne Herkunft A" })).getByText("Musikmodell unbekannt")).toBeTruthy();
  expect(screen.queryByText(/YuE2/)).toBeNull();
});

it("keeps the saved variant visible when it no longer exists in the model catalog", async () => {
  songs[0].params = { model_selection: { provider: "heartmula", synthesis: "heartmula-retired-q5_0", language: "" } };
  mount();
  expect(await screen.findByText("HeartMuLa · heartmula-retired-q5_0")).toBeTruthy();
});

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

it("opens the song and ZIP format dropdowns and exports the chosen format", async () => {
  const original = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation(async (name, args) => {
    if (name === "get_settings") return { export_format: "mp3_320", export_formats: ["wav", "mp3_320", "aac", "ogg", "original"] };
    if (name === "export_default_path") return `/Downloads/${args.filename}`;
    return original(name, args);
  });
  mount();
  const download = await screen.findByRole("button", { name: "Download" });
  fireEvent.keyDown(download, { key: "ArrowDown" });
  const songMenu = screen.getByRole("menu", { name: "Download format" });
  const [first, second] = within(songMenu).getAllByRole("menuitem");
  expect(first).toBe(within(songMenu).getByRole("menuitem", {
    name: "MP3 · 320 kbit/s", description: "Includes recorded model and usage metadata",
  }));
  expect(within(songMenu).getByRole("menuitem", {
    name: "AAC · 192 kbit/s", description: "Model and usage metadata unavailable in AAC",
  })).toBeTruthy();
  expect(within(songMenu).getByRole("menuitem", {
    name: "Original file", description: "Keeps existing file tags. Some originals lack model metadata.",
  })).toBeTruthy();
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: "ArrowDown" });
  expect(document.activeElement).toBe(second);
  fireEvent.keyDown(second, { key: "Escape" });
  expect(screen.queryByRole("menu", { name: "Download format" })).toBeNull();
  expect(document.activeElement).toBe(download);
  fireEvent.click(download);
  fireEvent.click(screen.getByRole("menuitem", { name: "Ogg/Opus · 160 kbit/s" }));
  const exportDialog = screen.getByRole("dialog", { name: "Export audio" });
  expect(mocks.invoke).not.toHaveBeenCalledWith("export_default_path", expect.anything());
  fireEvent.click(within(exportDialog).getByRole("button", { name: "Continue to save" }));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("export_file", {
    kind: "audio", destination: "/Downloads/A song.ogg", id: "one", folder: null, format: "ogg",
  }));
  fireEvent.click(screen.getByRole("button", { name: "Download all" }));
  const zipMenu = screen.getByRole("menu", { name: "Audio format in ZIP" });
  expect(within(zipMenu).getAllByRole("menuitem")[0]).toBe(within(zipMenu).getByRole("menuitem", { name: "MP3 · 320 kbit/s" }));
  fireEvent.click(within(zipMenu).getByRole("menuitem", { name: "WAV" }));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("export_file", {
    kind: "zip", destination: "/Downloads/Music Generator.zip", id: null, folder: "", format: "wav",
  }));
});

it("shows MuLaCover terms and the open reference rights before saving the selected audio", async () => {
  songs[0].params = {
    model_selection: { provider: "mulacover", synthesis: "mulacover-noncommercial", language: "" },
    reference_audio: "saved-reference",
  };
  const terms = /Commercial use requires written permission from MuLa Labs/;
  const reference = /Check whether your permission covers the intended use of this song/;
  const view = mount(false, songs[0].params.model_selection);
  const badges = within(await screen.findByRole("group", { name: "Usage terms" }));
  expect(badges.getByText("Noncommercial use")).toBeTruthy();
  expect(badges.getByText("Check reference rights")).toBeTruthy();
  await openDetails();
  const song = await screen.findByRole("article", { name: "A song A" });
  expect(within(song).getByText(/Noncommercial use/)).toBeTruthy();
  expect(within(song).getByText(terms)).toBeTruthy();
  expect(within(song).getByText(reference)).toBeTruthy();
  view.switchModel({ provider: "audiocraft", synthesis: "musicgen-small", language: "" });
  expect(within(song).getByText(terms)).toBeTruthy();

  const download = within(song).getByRole("button", { name: "Download" });
  fireEvent.click(download);
  fireEvent.click(screen.getByRole("menuitem", { name: "WAV" }));
  const dialog = screen.getByRole("dialog", { name: "Export audio" });
  expect(within(dialog).getByText("A song", { exact: false })).toBeTruthy();
  expect(within(dialog).getByText(terms)).toBeTruthy();
  expect(within(dialog).getByText(reference)).toBeTruthy();
  expect(within(dialog).getByRole("link", { name: "Source" }).getAttribute("href")).toMatch(/HeartMuLa\/MuLaCover\/.*\/MODEL_LICENSE$/);
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(mocks.invoke).not.toHaveBeenCalledWith("export_default_path", expect.anything());
});

it("shows uncertainty for unknown models and separates AudioCraft's weights from the song", async () => {
  songs[0].params = { model_selection: { provider: "audiocraft", synthesis: "musicgen-small", language: "" } };
  songs = [...songs,
    { ...songs[0], id: "old", title: "Older recording", params: { reference_audio: "saved-reference" } },
    { ...songs[0], id: "unlisted", title: "Unlisted profile", params: { model_selection: { provider: "audiocraft", synthesis: "unknown", language: "" } } },
  ];
  mount(false, songs[0].params.model_selection);
  await openDetails();
  const audioCraft = await screen.findByRole("article", { name: "A song A" });
  expect(within(audioCraft).getByText("The weights license applies to the weights. Rights to the generated music must be assessed separately.")).toBeTruthy();
  expect(within(audioCraft).queryByText(/Noncommercial use/)).toBeNull();
  await openDetails("Older recording A");
  const older = screen.getByRole("article", { name: "Older recording A" });
  expect(within(older).getByText(/The original model is not known/)).toBeTruthy();
  expect(within(older).getByText(/Check whether your permission covers the intended use/)).toBeTruthy();
  await openDetails("Unlisted profile A");
  expect(within(screen.getByRole("article", { name: "Unlisted profile A" })).getByText(/terms for this recording's saved model version are unclear/)).toBeTruthy();
});

it("uses the saved terms and their sources in the library and export after changing models", async () => {
  setLang("de");
  songs[0].params = { model_selection: { provider: "audiocraft", synthesis: "musicgen-small", language: "" } };
  songs[0].result_meta = { output_usage: {
    text: "Archived output terms", text_de: "Archivierte Bedingungen für den Song", source_urls: ["https://example.org/model-terms", "file:///private/source"],
  } };
  const view = mount(false, songs[0].params.model_selection);
  const badges = within(await screen.findByRole("group", { name: "Nutzungsbedingungen" }));
  expect(badges.getByText("Gespeicherte Songbedingungen")).toBeTruthy();
  expect(badges.queryByText("CC BY-NC 4.0")).toBeNull();
  await openDetails();
  const song = await screen.findByRole("article", { name: "A song A" });
  view.switchModel({ provider: "mulacover", synthesis: "mulacover-noncommercial", language: "" });
  expect(within(song).getByText("Archivierte Bedingungen für den Song")).toBeTruthy();
  fireEvent.click(within(song).getByRole("button", { name: "Download" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "WAV" }));
  const dialog = screen.getByRole("dialog", { name: "Audio exportieren" });
  expect(within(dialog).getByText("Archivierte Bedingungen für den Song")).toBeTruthy();
  expect(within(dialog).getByRole("link", { name: "Quelle" }).getAttribute("href")).toBe("https://example.org/model-terms");
});

it("keeps publication and monetization open for a local ACE-Step checkpoint", async () => {
  songs[0].params = { model_selection: { provider: "ace-step", synthesis: "acestep-v15-base-BF16.gguf", language: "1.7B" } };
  mount();
  await openDetails();
  const song = await screen.findByRole("article", { name: "A song A" });
  expect(within(song).getByText(/Publication and monetization rights for this local checkpoint are unclear/)).toBeTruthy();
  expect(within(song).getByText(/check originality, disclose AI involvement and obtain permission/)).toBeTruthy();
  expect(within(song).getAllByRole("link", { name: /^Source/, hidden: true }).some(link => link.getAttribute("href")?.endsWith("/discussions/1256"))).toBe(true);
});

it("navigates both ways and resets the page when search, folder or favorites changes", { timeout: 15_000 }, async () => {
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
  await openActions("Piano 50");
  fireEvent.click(screen.getByRole("menuitem",{name:"Delete"}));
  fireEvent.click(screen.getByRole("menuitem",{name:"Delete song?"}));
  await screen.findByText("Piano 0");
  expect(screen.queryByRole("navigation",{name:"Library pages"})).toBeNull();
  expect(screen.queryByText("Piano 50")).toBeNull();
});
it("updates the favorite view after mutation and preserves inline edits during a refresh", async () => {
  const client = mount();
  await openDetails();
  expect(screen.getByText("Iterations 200")).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Show favorites only"}));
  await screen.findByText("Nothing yet");
  fireEvent.click(screen.getByRole("button",{name:"Show favorites only"}));
  await screen.findByText("A song A");
  fireEvent.click(screen.getByRole("button",{name:"Favorite"}));
  await waitFor(() => expect(songs[0].favorite).toBe(true));
  fireEvent.click((await openActions()).getByRole("menuitem", { name: "Rename" }));
  const input = screen.getByRole("textbox",{name:"Title"});
  fireEvent.change(input,{target:{value:"still editing"}});
  await client.invalidateQueries({queryKey:["songs"]});
  expect((input as HTMLInputElement).value).toBe("still editing");
  fireEvent.keyDown(input,{key:"Enter"});
  await screen.findByText("still editing A");
});
it("shows MIDI results and missing files separately from playable audio", async () => {
  songs = [
    ...songs,
    { ...songs[0], id: "midi", title: "MIDI composition", output_kind: "midi", file: "midi.mid", result_meta: null },
    { ...songs[0], id: "missing", title: "Missing composition", output_kind: "midi", audio_missing: true, file: "missing.mid", result_meta: null },
  ];
  mount(true);
  expect(await screen.findByRole("button", { name: "Export MIDI" })).toBeTruthy();
  expect(screen.getAllByText("MIDI (.mid)")).toHaveLength(2);
  expect(screen.getByText("MIDI file missing")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Play" })).toHaveLength(1);
  expect(mocks.invoke).not.toHaveBeenCalledWith("read_song_audio", expect.anything());
});

it.each([
  ["done",120,{effective_inference_steps:60},"Iterations 60"],
  ["done",120,{inference_steps:120},"Iterations 100"],
  ["queued",200,null,"Iterations 200"],
  ["running",200,null,"Iterations 200"],
  ["error",200,null,"Iterations 200"],
] as const)("keeps measured execution distinct from the %s historical request",async(status,steps,meta,expected)=>{
  songs[0]={...songs[0],status,params:{inference_steps:steps},result_meta:meta};
  mount();await openDetails();expect(await screen.findByText(expected)).toBeTruthy();
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
  const row = await openDetails();
  expect(row.queryByText(/Iterations|1:25/)).toBeNull();
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
  await openDetails();
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
  await openDetails();
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
  fireEvent.click((await openActions()).getByRole("menuitem", { name: "Another variant (new seed)" }));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("generate", expect.anything()));
  const request = mocks.invoke.mock.calls.find(([name]) => name === "generate")?.[1].request;
  if (prompt) expect(request).toHaveProperty("caption", caption);
  else expect(request).not.toHaveProperty("caption");
  expect(request).toHaveProperty("instrumental", instrumental);
});

it("shows the variance with up to two decimals",async()=>{
  songs[0].params={inference_steps:0,lm_temperature:0.85};songs[0].result_meta={};
  const view=mount();await screen.findByText("A song A");
  await openDetails();
  expect(screen.getByText("Variance 0.85")).toBeTruthy();
  songs[0]={...songs[0],params:{inference_steps:0,lm_temperature:1.2}};
  await view.invalidateQueries({queryKey:["songs"]});
  await screen.findByText("Variance 1.2");
});
it("allows selecting lyrics without starting a song drag",async()=>{
  const original=mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((name,args)=>name==="list_folders"?Promise.resolve({folders:[{id:"ideas",name:"Ideas",count:1}],all:1,none:0}):original(name,args));
  songs[0].lyrics="[Verse] lyrics";songs[0].result_meta={lyrics:"Select this lyric text"};
  mount();await openDetails();fireEvent.click(await screen.findByRole("button",{name:"Show the lyrics the model wrote"}));
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
  mount();fireEvent.click((await openActions()).getByRole("menuitem",{name:"Another variant (new seed)"}));
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
  const row = await openDetails();
  expect(row.getByText("0.8 s")).toBeTruthy();
  expect(row.getByText("300 BPM")).toBeTruthy();
  fireEvent.click((await openActions()).getByRole("menuitem", { name: "Another variant (new seed)" }));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("generate", { request: {
    model_selection: selection, prompt: "jazzy swung drums", instrumental: true, bars: 1, bpm: 300,
    duration: 0.8, seed: -1, variants: 1, keep_caption: true, title: "A song", folder_id: null, group_id: "g",
  } }));
});

it("resets delete confirmation after a keyboard or screenreader click on another action",async()=>{
  mount();fireEvent.click((await openActions()).getByRole("menuitem",{name:"Delete"}));
  expect(screen.getByRole("menuitem",{name:"Delete song?"})).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Favorite"}));
  expect(screen.queryByRole("menu")).toBeNull();
  expect((await openActions()).getByRole("menuitem",{name:"Delete"})).toBeTruthy();
});

it("translates the existing admission message for unverified models",async()=>{
  setLang("de");const original=mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((name,args)=>{
    if(name==="generation_policy")return Promise.resolve({backend:"gpu",recommended_steps:80,cpu_iteration_behavior:"ask",defaults:{duration:90,bpm:0,inference_steps:80,lm_temperature:1.2,variants:2}});
    if(name==="generate")return Promise.reject(new Error("Open the ModelPicker and download or verify the selected models first"));
    return original(name,args);
  });
  mount();fireEvent.click((await openActions()).getByRole("menuitem",{name:"Weitere Variante (neuer Seed)"}));
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
  await openActions();
  expect(screen.getByRole("menuitem", {name:"Delete"})).toBeTruthy();
});

it("stops playback and clears the player only after a successful confirmed deletion",async()=>{
  songs[0].path="/songs/one.wav";mount(true);
  fireEvent.click(await screen.findByRole("button",{name:"Play"}));
  await waitFor(()=>expect(waveform.play).toHaveBeenCalledOnce());
  await openActions();
  fireEvent.click(screen.getByRole("menuitem",{name:"Delete"}));
  expect(mocks.invoke).not.toHaveBeenCalledWith("delete_song", {id:"one"});
  expect(document.querySelector<HTMLElement>("#player")!.hidden).toBe(false);
  fireEvent.click(screen.getByRole("menuitem",{name:"Delete song?"}));
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
  await openActions();
  fireEvent.click(screen.getByRole("menuitem",{name:"Delete"}));fireEvent.click(screen.getByRole("menuitem",{name:"Delete song?"}));
  await screen.findByRole("alert");
  expect(document.querySelector<HTMLElement>("#player")!.hidden).toBe(false);expect(waveform.destroy).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Show favorites only"}));await screen.findByText("Nothing yet");
  expect(document.querySelector("#pTitle")!.textContent).toBe("A song");expect(waveform.destroy).not.toHaveBeenCalled();
});

it("rounds a duration-limited WAV at the displayed second", async () => {
  songs[0].params = { duration: 60 };
  songs[0].result_meta = { duration: 59.998667, duration_source: "wav", duration_limit: 60 };
  mount();
  expect(await screen.findByText("1:00")).toBeTruthy();
});

it("shows the supplied lyrics for a YuE2 song", async () => {
  songs[0].engine = "yue2";
  songs[0].lyrics = "[Verse]\nI hear the ocean roar";
  mount();
  await openDetails();
  fireEvent.click(screen.getByRole("button", { name: "Lyrics" }));
  expect(screen.getByText(/I hear the ocean roar/)).toBeTruthy();
});
