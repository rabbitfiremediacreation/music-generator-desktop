// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryHistory } from "@tanstack/react-router";
import { DesktopApp, createAppRouter } from "./app";
import { createAppQueryClient } from "./data";
import { turbo } from "./models/model-fixtures";
import { measuredBackend, setupFixture, standard } from "./setup/fixtures";
import { setLang, t } from "../i18n.js";
import source from "../../models/catalog.json";
import type { JobProgress, PhoneAccess, Song } from "../types";
import { restoreTitlebarDesign } from "../titlebar-design";
import type { StemJob } from "../stems";
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
  phoneAccess={enabled:false,port:8767,token:"",addresses:["http://studio.local:8767"],web_addresses:["https://studio.local:8768/mobile/"]};
  mocks.listen.mockResolvedValue(()=>{});mocks.close.mockResolvedValue(()=>{});
  mocks.invoke.mockImplementation(async(name,args)=>{
    if(name==="bootstrap")return {...setupFixture,needs_setup:firstRun};
    if(name==="get_settings")return {...setupFixture.settings,recommended_profiles:[standard]};
    if(name==="generation_policy")return {backend:"cpu",cpu_iteration_behavior:"ask",recommended_steps:30,defaults:{duration:90,bpm:0,inference_steps:30,lm_temperature:1.2,variants:2}};
    if(name==="get_generation_form_preferences")return {duration:90,bpm:0,inference_steps:30,lm_temperature:1.2,variants:2};
    if(name==="setup_estimate")return {missing_bytes:0,free_bytes:1000000};
    if(name==="setup_models")return {ok:true,mode:"single",backend_status:measuredBackend};
    if(name==="discover_hugging_face_models")return {candidates:[],unavailable_repositories:[]};
    if(name==="hugging_face_token_status")return false;
    if(name==="model_catalog")return {...source,selection:standard,expert_mode:false,recommended_profiles:[standard],hardware:setupFixture.hardware,free_bytes:null,models_dir:"/models",busy:false,title_model:{...setupFixture.title_model,verified:true,present:true,partial_bytes:0},models:source.models.map(model=>({...model,verified:true,present:true,partial_bytes:0}))};
    if(name==="list_song_page")return {songs:[],total:0};
    if(name==="list_folders")return {folders:[],all:0,none:0};
    if(name==="queue")return {running:[],queued:0,active:false,progress:null,library:{count:0,bytes:0}};
    if(name==="work_queue")return {jobs:[],progress:null,downloads:[],download_limit:4};
    if(name==="completed_work")return {jobs:[],next_offset:null};
    if(name==="health")return {ok:true};
    if(name==="phone_access_status")return {...phoneAccess};
    if(name==="set_phone_access"){
      phoneAccess={...phoneAccess,enabled:args.enabled??phoneAccess.enabled,token:"phone-key"};
      return {...phoneAccess};
    }
  });
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();localStorage.removeItem("desktop_titlebar_design");restoreTitlebarDesign();});
async function mount(path="/"){
  const client=createAppQueryClient(),router=createAppRouter(client,createMemoryHistory({initialEntries:[path]}));
  await act(async()=>{
    render(<DesktopApp client={client} router={router}/>);
    await router.load();
  });
  return router;
}
it("switches between Create, Remix and Mix from the icon navigation and keeps the Create draft", async () => {
  firstRun = false;
  const invoke = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation(async (name, args) => name === "stem_jobs" ? [] : invoke(name, args));
  await mount();
  const navigation = within(await screen.findByRole("navigation", { name: "Workspace" }));
  const create = navigation.getByRole("button", { name: "Create" });
  const remix = navigation.getByRole("button", { name: "Remix" });
  const mix = navigation.getByRole("button", { name: "Mix" });
  expect(create.getAttribute("aria-current")).toBe("page");
  expect([create, remix, mix].every(button => button.textContent === "")).toBe(true);
  const title = await screen.findByRole<HTMLInputElement>("textbox", { name: t("title") });
  fireEvent.change(title, { target: { value: "In progress" } });
  fireEvent.click(remix);
  expect(remix.getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("region", { name: "Remix" })).toBeTruthy();
  expect(document.querySelector("#studio .top > .logo")).toBeTruthy();
  const remixTitle = screen.getByRole<HTMLInputElement>("textbox", { name: t("title") });
  expect(remixTitle.value).toBe("");
  fireEvent.change(remixTitle, { target: { value: "Remix draft" } });
  fireEvent.click(mix);
  expect(mix.getAttribute("aria-current")).toBe("page");
  expect(await screen.findByText(t("stem_empty_projects"))).toBeTruthy();
  fireEvent.click(create);
  expect(screen.getByRole<HTMLInputElement>("textbox", { name: t("title") }).value).toBe("In progress");
  fireEvent.click(remix);
  expect(screen.getByRole<HTMLInputElement>("textbox", { name: t("title") }).value).toBe("Remix draft");
});

it("counts running audio jobs and downloads from another tab and cancels the selected download", async () => {
  firstRun = false;
  const invoke = mocks.invoke.getMockImplementation()!;
  const file = "model.gguf";
  let running = true;
  mocks.invoke.mockImplementation(async (name, args) => name === "work_queue" ? {
    jobs: [
      ...(running ? [{ id: "running-song", caption: "Night Session", kind: "song", status: "running" }] : []),
      { id: "waiting-song", caption: "Morning Session", kind: "song", status: "queued" },
    ],
    progress: { job_id: "running-song", overall_percent: 42 },
    downloads: [
      { id: "model", file, phase: running ? "downloading" : "done", downloaded: 10 * 1024 ** 2, total: 20 * 1024 ** 2, error: null },
      { id: "engine", file: "engine.zip", phase: "queued", downloaded: 0, total: 100, error: null },
    ],
    download_limit: 4,
  } : invoke(name, args));
  await mount();
  const navigation = within(await screen.findByRole("navigation", { name: "Workspace" }));
  const queue = navigation.getByRole("button", { name: "Job queue" });
  await waitFor(() => expect(queue.textContent).toBe("2"));
  expect(queue.getAttribute("aria-description")).toBe("2 running jobs");
  fireEvent.click(queue);
  expect(queue.getAttribute("aria-current")).toBe("page");
  expect(await screen.findByText("1 of 4 download slots in use")).toBeTruthy();
  expect(screen.getByRole("progressbar", { name: "Night Session" }).getAttribute("value")).toBe("42");
  expect(screen.getByRole("progressbar", { name: file }).getAttribute("value")).toBe(String(10 * 1024 ** 2));
  fireEvent.click(screen.getByRole("button", { name: `${t("cancel")} · ${file}` }));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("cancel_download", { id: "model" }));
  fireEvent.click(navigation.getByRole("button", { name: "Create" }));
  running = false;
  await waitFor(() => expect(queue.textContent).toBe(""), { timeout: 2500 });
});

it("uses persisted progress for a running stem export", async () => {
  firstRun = false;
  const invoke = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation(async (name, args) => name === "work_queue" ? {
    jobs: [{ id: "export", caption: "Mix export", kind: "export", status: "running", progress: 37 }],
    progress: null, downloads: [], download_limit: 4,
  } : invoke(name, args));
  await mount();
  fireEvent.click(screen.getByRole("button", { name: "Job queue" }));
  const progress = await screen.findByRole("progressbar", { name: "Mix export" });
  expect(progress.getAttribute("value")).toBe("37");
});

it("opens settings from the bottom of the workspace sidebar", async () => {
  firstRun = false;
  await mount();
  const navigation = within(await screen.findByRole("navigation", { name: "Workspace" }));
  const settings = navigation.getByRole("button", { name: t("settings_title") });
  expect(navigation.getAllByRole("button").at(-1)).toBe(settings);
  fireEvent.click(settings);
  expect(await screen.findByRole("dialog", { name: t("settings_title") })).toBeTruthy();
});

it("loads completed jobs and older history without adding them to the running badge", async () => {
  firstRun = false;
  const invoke = mocks.invoke.getMockImplementation()!;
  const finishedAt = "2026-11-22T01:00:00Z";
  mocks.invoke.mockImplementation(async (name, args) => {
    if (name !== "completed_work") return invoke(name, args);
    if (args.offset === 0) return {
      jobs: [{ id: "recent", label: "Finished remix", kind: "remix", finished_at: finishedAt }], next_offset: 25,
    };
    return { jobs: [{ id: "older", label: "Earlier export", kind: "export", finished_at: finishedAt }], next_offset: null };
  });
  await mount();
  const queue = screen.getByRole("button", { name: t("workspace_queue") });
  fireEvent.click(queue);
  const completed = within(await screen.findByRole("region", { name: t("queue_completed") }));
  const recent = await completed.findByText("Finished remix");
  expect(recent.closest("li")?.querySelector("time")?.dateTime).toBe(finishedAt);
  expect(completed.queryByRole("button", { name: /Cancel/ })).toBeNull();
  fireEvent.click(completed.getByRole("button", { name: t("queue_show_older") }));
  await completed.findByText("Earlier export");
  expect(completed.getByText("Finished remix")).toBeTruthy();
  expect(queue.textContent).toBe("");
  expect(mocks.invoke).toHaveBeenCalledWith("completed_work", { offset: 25 });
});
it("queues a library remix with its own model selection and Create-style input fields", async () => {
  firstRun = false;
  const song: Song = { id: "source-song", title: "Library song", caption: "Acoustic", status: "done", path: "/songs/song.wav",
    group_id: "group", letter: "", created_at: "2026-01-01", finished_at: "2026-01-01", message: null, lyrics: "[Chorus]\nTry again",
    seed: 1, params: { vocal_language: "en" }, result_meta: null, file: "song.wav", audio_missing: false, favorite: false, folder_id: null };
  const invoke = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation(async (name, args) => {
    if (name === "list_song_page") return { songs: [song], total: 1 };
    if (name === "generate") return { ids: ["remix-song"] };
    if (name === "get_settings") return { ...setupFixture.settings, recommended_profiles: [standard, turbo] };
    return invoke(name, args);
  });
  await mount();
  const row = within(await screen.findByRole("article", { name: song.title! }));
  fireEvent.click(row.getByRole("button", { name: "Remix" }));
  const remix = within(screen.getByRole("region", { name: "Remix" }));
  const model = remix.getByRole<HTMLSelectElement>("combobox", { name: t("picker_title") });
  const turboKey = JSON.stringify([turbo.provider, turbo.synthesis, turbo.language]);
  const standardKey = JSON.stringify([standard.provider, standard.synthesis, standard.language]);
  await waitFor(() => expect(model.value).toBe(standardKey));
  expect(Array.from(model.options).map(option => option.value)).toEqual([standardKey, turboKey]);
  fireEvent.change(model, { target: { value: turboKey } });
  expect(remix.getByRole<HTMLTextAreaElement>("textbox", { name: t("lyrics") }).value).toBe(song.lyrics);
  expect(remix.getByRole<HTMLInputElement>("textbox", { name: t("title") }).value).toBe("Library song (Remix)");
  fireEvent.change(remix.getByRole("textbox", { name: t("title") }), { target: { value: "After Hours" } });
  fireEvent.change(remix.getByRole("textbox", { name: t("remix_prompt") }), { target: { value: "Warm jazz" } });
  fireEvent.change(remix.getByRole("textbox", { name: t("style") }), { target: { value: "Brush drums" } });
  fireEvent.change(remix.getByRole("combobox", { name: t("remix_mode") }), { target: { value: "cover-nofsq" } });
  const generate = remix.getByRole<HTMLButtonElement>("button", { name: t("remix_submit") });
  await waitFor(() => expect(generate.disabled).toBe(false));
  fireEvent.click(generate);
  expect(await remix.findByText(t("remix_queued"))).toBeTruthy();
  expect(mocks.invoke).toHaveBeenCalledWith("generate", { request: expect.objectContaining({
    title: "After Hours", prompt: "Warm jazz", style: "Brush drums", lyrics: song.lyrics, model_selection: turbo,
    remix: { mode: "cover-nofsq", source_song_id: song.id },
  }) });
  fireEvent.click(within(screen.getByRole("navigation", { name: "Workspace" })).getByRole("button", { name: "Create" }));
  expect(screen.getByRole<HTMLSelectElement>("combobox", { name: t("picker_title") }).value).toBe(standardKey);
});

it("asks again before staging a replacement WAV for an external remix", async () => {
  firstRun = false;
  const invoke = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation(async (name, args) => {
    if (name === "pick_reference_audio") return { id: "approved-ref", name: "approved.wav" };
    if (name === "generate") return { ids: ["remix-song"] };
    return invoke(name, args);
  });
  mocks.confirm.mockResolvedValue(false);
  const upload = vi.fn();
  vi.stubGlobal("fetch", upload);
  await mount();
  fireEvent.click(within(screen.getByRole("navigation", { name: "Workspace" })).getByRole("button", { name: "Remix" }));
  const remix = within(screen.getByRole("region", { name: "Remix" }));
  fireEvent.click(remix.getByRole("button", { name: t("remix_source") }));
  await remix.findByText("approved.wav");
  expect(mocks.invoke).toHaveBeenCalledWith("pick_reference_audio", expect.objectContaining({
    remix: true, permission: expect.objectContaining({ question: expect.stringContaining("Publishing the remix may require separate permission.") }),
  }));

  const zone = remix.getByRole("group", { name: t("remix_source_label") });
  const replacement = new File(["music"], "replacement.wav");
  const read = vi.spyOn(replacement, "arrayBuffer");
  await act(async () => fireEvent.drop(zone, { dataTransfer: { files: [replacement] } }));
  expect(mocks.confirm).toHaveBeenCalledWith(expect.stringContaining("replacement.wav"), expect.objectContaining({ okLabel: "Use as remix reference" }));
  expect(read).not.toHaveBeenCalled();
  expect(upload).not.toHaveBeenCalled();
  expect(remix.getByText("approved.wav")).toBeTruthy();

  mocks.confirm.mockResolvedValue(true);
  upload.mockResolvedValue(Response.json({ id: "replacement-ref", name: replacement.name }));
  await act(async () => fireEvent.drop(zone, { dataTransfer: { files: [replacement] } }));
  await remix.findByText(replacement.name);
  fireEvent.change(remix.getByRole("textbox", { name: t("remix_prompt") }), { target: { value: "Warm jazz" } });
  const submit = remix.getByRole<HTMLButtonElement>("button", { name: t("remix_submit") });
  await waitFor(() => expect(submit.disabled).toBe(false));
  fireEvent.click(submit);
  await remix.findByText(t("remix_queued"));
  expect(mocks.invoke).toHaveBeenCalledWith("generate", { request: expect.objectContaining({ reference_audio: "replacement-ref" }) });
});

it("still lets the Remix workspace choose a local WAV independently of Create", async () => {
  firstRun = false;
  const invoke = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation(async (name, args) => name === "pick_reference_audio"
    ? { id: "a".repeat(64), name: "local.wav" }
    : invoke(name, args));
  await mount();

  fireEvent.click(within(screen.getByRole("navigation", { name: "Workspace" })).getByRole("button", { name: "Remix" }));
  const remix = within(screen.getByRole("region", { name: "Remix" }));
  expect(screen.queryByRole("button", { name: t("dialog_audio_import") })).toBeNull();
  fireEvent.click(remix.getByRole("button", { name: t("remix_source") }));

  expect(await remix.findByText("local.wav")).toBeTruthy();
  expect(mocks.invoke).toHaveBeenCalledWith("pick_reference_audio", expect.objectContaining({ title: t("remix_source"), remix: true }));
});

it("opens the current song as a single track and offers separation from Mix", async () => {
  firstRun = false;
  const song: Song = { id: "current-song", title: "Current song", caption: "Piano", status: "done", path: "/songs/song.wav",
    group_id: "group", letter: "", created_at: "2026-01-01", finished_at: "2026-01-01", message: null,
    lyrics: null, seed: 1, params: {}, result_meta: null, file: "song.wav", audio_missing: false, favorite: false, folder_id: null };
  const invoke = mocks.invoke.getMockImplementation()!;
  let separated = false;
  const audio = { rate: 44100, channels: 2, frames: 44100, peaks: [] };
  const project: StemJob = {
    id: "finished-separation", status: "done", phase: "done", error: null, created_at: "", finished_at: "",
    project: { ...audio, source_start_frame: 0, source_frames: audio.frames, roles: ["vocals"], engine: "Demucs",
      engine_version: "4.0.1", backend: "cpu", original_peak: 0, track_peaks: [] },
    request: { source_id: "source", pin: { model: "htdemucs", repository: "fixture", revision: "abc" }, start: 0,
      end: null, name: "Separated song", quality: "standard", overlap: .25, outputs: ["vocals"], preview: false },
    source: { id: "source", song_id: song.id, name: song.title!, hash: "test", audio },
  };
  mocks.invoke.mockImplementation(async (name, args) => {
    if (name === "list_song_page") return { songs: [song], total: 1 };
    if (name === "read_song_audio") return new ArrayBuffer(8);
    if (name === "stem_latest_project") {
      if (separated) return project;
      throw "stem_project_missing";
    }
    if (name === "stem_mixes" || name === "stem_exports") return [];
    if (name === "stem_models") return { engine_ready: false, platform_supported: true, models: [] };
    return invoke(name, args);
  });
  vi.stubGlobal("WaveSurfer", { create: () => ({
    on: () => () => {}, loadBlob: async () => {}, play: async () => {}, pause: vi.fn(), destroy: vi.fn(), setVolume: vi.fn(),
  }) });
  vi.stubGlobal("OfflineAudioContext", class {
    async decodeAudioData() {
      return { sampleRate: 48000, length: 48000, numberOfChannels: 1, getChannelData: () => new Float32Array(48000) };
    }
  });
  vi.stubGlobal("AudioContext", class {
    sampleRate = 48000;
    state = "suspended";
    createScriptProcessor() { return { connect() {}, disconnect() {} }; }
    async close() { this.state = "closed"; }
  });
  await mount();
  const row = within(await screen.findByRole("article", { name: song.title! }));
  fireEvent.click(row.getByRole("button", { name: t("play") }));
  fireEvent.click(within(screen.getByRole("navigation", { name: "Workspace" })).getByRole("button", { name: "Mix" }));
  const mixer = within(await screen.findByRole("region", { name: "Stem-Mixer" }));
  expect(mixer.getByText(song.title!)).toBeTruthy();
  expect(mixer.getAllByRole("button", { name: / · MUTE$/ }).map(button => button.getAttribute("aria-label")))
    .toEqual(["Original · MUTE"]);
  await waitFor(() => expect(mixer.getByRole<HTMLButtonElement>("button", { name: t("stem_play") }).disabled).toBe(false));
  fireEvent.click(mixer.getByRole("button", { name: t("stem_split") }));
  const separation = within(await screen.findByRole("dialog", { name: t("stem_title") }));
  expect(separation.getByText(song.title!)).toBeTruthy();
  fireEvent.click(separation.getByRole("button", { name: t("desktop_close") }));
  const nav = within(screen.getByRole("navigation", { name: "Workspace" }));
  fireEvent.click(nav.getByRole("button", { name: "Job queue" }));
  separated = true;
  fireEvent.click(nav.getByRole("button", { name: "Mix" }));
  expect(await screen.findByRole("button", { name: "Vocals · MUTE" })).toBeTruthy();
});
it("starts another separation from the mixer and keeps its draft until the user switches projects", async () => {
  firstRun = false;
  const roles = ["vocals", "drums"];
  const metadata = { frames: 44100, channels: 2, rate: 44100 };
  const project: StemJob = {
    id: "separation", status: "done", phase: "done", error: null, created_at: "", finished_at: "",
    project: { ...metadata, source_start_frame: 0, source_frames: metadata.frames, roles, engine: "Demucs", engine_version: "4.0.1",
      backend: "cpu", original_peak: 0, track_peaks: [] },
    request: { source_id: "source", pin: { model: "htdemucs", repository: "fixture", revision: "abc" }, name: "Two channels",
      start: 0, end: null, quality: "standard", overlap: .25, preview: false, outputs: roles },
    source: { id: "source", name: "Test", song_id: null, hash: "hash", audio: { ...metadata, peaks: [] } },
  };
  const invoke = mocks.invoke.getMockImplementation()!;
  const nextProject = { ...project, id: "new-separation", request: { ...project.request, name: "New project" } };
  const preview = { ...project, id: "preview", request: { ...project.request, name: "Preview project", preview: true } };
  let queued = false;
  mocks.invoke.mockImplementation(async (name, args) => {
    if (name === "stem_jobs") return queued ? [nextProject, project] : [project];
    if (name === "stem_mixes" || name === "stem_exports") return [];
    if (name === "stem_models") return { engine_ready: true, platform_supported: true,
      models: [{ id: "htdemucs", name: "HTDemucs", status: "ready", roles, active: project.request.pin }] };
    if (name === "stem_source_audio") return "source.wav";
    if (name === "stem_preflight") return { frames: 44100, bytes: 1024, seconds: 1 };
    if (name === "stem_start") {
      if (args.request.preview) return preview.id;
      queued = true; return nextProject.id;
    }
    if (name === "stem_job") return args.id === preview.id ? preview : nextProject;
    return invoke(name, args);
  });
  await mount();
  fireEvent.click(await screen.findByRole("button", { name: t("stem_projects") }));
  fireEvent.click(await screen.findByRole("button", { name: t("stem_mixer") }));
  const mixer = await screen.findByRole("region", { name: "Stem-Mixer" });
  expect(mixer.closest("main")?.id).toBe("stem-mixer-view");
  expect(mixer.closest("dialog")).toBeNull();
  expect(document.getElementById("studio")?.hidden).toBe(true);

  const draft = within(mixer).getByLabelText<HTMLInputElement>(t("stem_mix_name"));
  fireEvent.change(draft, { target: { value: "Unsaved draft" } });
  const mute = within(mixer).getByRole("button", { name: /Vocals.*MUTE/ });
  fireEvent.click(mute);
  fireEvent.click(within(mixer).getByRole("button", { name: t("stem_new") }));
  const wizard = within(await screen.findByRole("dialog", { name: t("stem_title") }));
  await wizard.findByRole("button", { name: `${t("del")} · ${project.source.name}` });
  expect(mocks.invoke).not.toHaveBeenCalledWith("stem_song_source", expect.anything());
  fireEvent.click(wizard.getByRole("button", { name: t("stem_continue") }));
  const audition = wizard.getByText(t("stem_preview"), { selector: "summary" }).closest("details")!;
  audition.open = true;
  fireEvent.click(within(audition).getByRole("button", { name: t("stem_preview") }));
  fireEvent.click(await wizard.findByRole("button", { name: t("stem_preview_result") }));
  const previewName = await screen.findByText(preview.request.name);
  expect(mixer.closest("main")?.hidden).toBe(true);
  fireEvent.click(within(previewName.closest("main")!).getByRole("button", { name: t("stem_back") }));
  expect(await wizard.findByRole("button", { name: t("stem_preview_result") })).toBeTruthy();
  expect(mixer.closest("main")?.hidden).toBe(false);
  fireEvent.click(wizard.getByRole("button", { name: t("stem_continue") }));
  fireEvent.click(wizard.getByRole("button", { name: t("stem_start") }));
  await wizard.findByText(nextProject.request.name);
  expect(mocks.invoke).toHaveBeenCalledWith("stem_start", { request: expect.objectContaining({ source_id: project.source.id }) });
  fireEvent.click(wizard.getByRole("button", { name: t("desktop_close") }));
  expect(draft.isConnected && draft.value).toBe("Unsaved draft");
  expect(mute.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(within(mixer).getByRole("button", { name: t("stem_undo") }));
  expect(mute.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(within(mixer).getByRole("button", { name: t("stem_back") }));
  expect(await screen.findByRole("dialog", { name: t("stem_title") })).toBeTruthy();
  expect(document.getElementById("studio")?.hidden).toBe(false);
});
it("opens a song's latest project directly and restores separation after confirmed removal", async () => {
  firstRun = false;
  const song: Song = { id: "song", title: "Library song", caption: "Music", status: "done", path: "/songs/song.wav",
    group_id: "group", letter: "", created_at: "2026-01-01", finished_at: "2026-01-01", message: null,
    lyrics: null, seed: 1, params: {}, result_meta: null, file: "song.wav", audio_missing: false, favorite: false, folder_id: null };
  const audio = { frames: 44100, channels: 2, rate: 44100, peaks: [] };
  const roles = ["vocals", "drums"];
  const project: StemJob = {
    id: "project", status: "done", phase: "done", error: null, created_at: "2026-01-01", finished_at: "2026-01-01",
    project: { ...audio, source_start_frame: 0, source_frames: audio.frames, roles, engine: "Demucs", engine_version: "4.0.1",
      backend: "cpu", original_peak: 0, track_peaks: [] },
    request: { source_id: "source", pin: { model: "htdemucs", repository: "fixture", revision: "abc" }, name: "Song project",
      start: 0, end: null, quality: "standard", overlap: .25, preview: false, outputs: roles },
    source: { id: "source", name: song.title!, song_id: song.id, hash: "hash", audio },
  };
  let exists = true;
  const invoke = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation(async (name, args) => {
    if (name === "list_song_page") return { songs: [{ ...song, stem_project_count: Number(exists), stem_mix_count: exists ? 2 : 0 }], total: 1 };
    if (name === "stem_latest_project") return project;
    if (name === "stem_jobs") return exists ? [project] : [];
    if (name === "stem_mixes" || name === "stem_exports") return [];
    if (name === "stem_remove_project") { exists = false; return; }
    return invoke(name, args);
  });
  await mount();
  const row = within(await screen.findByRole("article", { name: song.title! }));
  expect(row.queryByRole("button", { name: t("stem_split") })).toBeNull();
  fireEvent.click(row.getByRole("button", { name: t("stem_mixer") }));
  const mixer = await screen.findByRole("region", { name: "Stem-Mixer" });
  expect(mocks.invoke).toHaveBeenCalledWith("stem_latest_project", { songId: song.id });
  expect(screen.queryByRole("dialog", { name: t("stem_title") })).toBeNull();
  fireEvent.click(within(mixer).getByRole("button", { name: t("stem_back") }));
  const dialog = within(await screen.findByRole("dialog", { name: t("stem_title") }));
  const remove = await dialog.findByRole("button", { name: `${t("stem_remove_project")} · ${project.request.name}` });
  mocks.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  fireEvent.click(remove);
  await waitFor(() => expect((remove as HTMLButtonElement).disabled).toBe(false));
  expect(mocks.invoke).not.toHaveBeenCalledWith("stem_remove_project", { id: project.id });
  fireEvent.click(remove);
  await dialog.findByText(t("stem_empty_projects"));
  expect(mocks.invoke).toHaveBeenCalledWith("stem_remove_project", { id: project.id });
  fireEvent.click(dialog.getByRole("button", { name: t("desktop_close") }));
  expect(await row.findByRole("button", { name: t("stem_split") })).toBeTruthy();
});
it("changes the title bar design immediately and restores it independently of the app theme", async () => {
  firstRun = false;
  await mount();
  fireEvent.click(await screen.findByRole("button", { name: t("settings_title") }));
  fireEvent.click(await screen.findByRole("button", { name: t("settings_page_appearance") }));
  const field = await screen.findByRole<HTMLSelectElement>("combobox", { name: t("settings_titlebar_design") });
  const titlebar = document.querySelector(".titlebar")!;
  const theme = document.documentElement.dataset.theme;
  expect(field.value).toBe("auto");
  fireEvent.change(field, { target: { value: "nightly" } });
  expect(titlebar.getAttribute("data-titlebar-design")).toBe("nightly");
  expect(titlebar.textContent).toContain("Music Generator");
  expect(titlebar.textContent).not.toContain("Daily");
  expect(document.documentElement.dataset.theme).toBe(theme);
  expect(localStorage.getItem("desktop_titlebar_design")).toBe("nightly");
  localStorage.setItem("desktop_titlebar_design", "dev");
  act(restoreTitlebarDesign);
  expect(field.value).toBe("dev");
  expect(titlebar.getAttribute("data-titlebar-design")).toBe("dev");
  expect(mocks.invoke.mock.calls.some(([command]) => command === "save_settings")).toBe(false);
});

it("shows overall progress and the estimated remaining time across phase and view changes", async () => {
  firstRun = false;
  const handlers = new Map<string, (event: { payload: unknown }) => void>();
  mocks.listen.mockImplementation(async (name, handler) => { handlers.set(name, handler); return () => {}; });
  await mount();
  await screen.findByText("Nothing yet");
  const phase: JobProgress = { job_id: "running-song", sequence: 2, phase: "dit", step: 6, total_steps: 30, elapsed_seconds: 12, overall_percent: 62, estimated_remaining_seconds: 32 };
  const sendProgress = (progress: JobProgress) => act(() => handlers.get("generation-progress")?.({ payload: progress }));
  sendProgress({ ...phase, sequence: 1, phase: "loading", step: null, total_steps: null, overall_percent: 0, estimated_remaining_seconds: undefined });
  const meter = (parent: string) => document.querySelector<HTMLProgressElement>(`${parent} progress`);
  await waitFor(() => expect(meter(".titlebar")?.getAttribute("value")).toBe("0"));
  expect(document.querySelector(".titlebar .song-activity-estimate")).toBeNull();
  expect(document.querySelector("#dropzone .app-wave[data-active]")).toBeTruthy();
  sendProgress(phase);
  await waitFor(() => expect(meter(".titlebar")?.value).toBe(62));
  expect(meter(".titlebar")?.max).toBe(100);
  expect(meter(".genbar")).toBeNull();
  expect(meter(".titlebar")?.getAttribute("aria-valuetext")).toBe("DiT · 6/30 · 0:12 · ≈ 62% · Remaining ≈ 0:32");
  expect(meter(".library-generation-status")?.value).toBe(62);
  sendProgress({ ...phase, sequence: 3, phase: "vae", step: null, total_steps: null, overall_percent: 89, estimated_remaining_seconds: 10 });
  await waitFor(() => expect(meter(".titlebar")?.value).toBe(89));
  fireEvent.click(screen.getByRole("button", { name: t("settings_title") }));
  await waitFor(() => expect(document.querySelector("#settingsForm")).toBeTruthy());
  expect(meter("#settingsForm")).toBeNull();
  expect(meter(".titlebar")?.getAttribute("aria-valuetext")).toContain("Remaining ≈ 0:10");
  act(() => handlers.get("library-changed")?.({ payload: null }));
  await waitFor(() => expect(meter(".titlebar")).toBeNull());
  expect(document.querySelector("#dropzone .app-wave[data-active]")).toBeNull();
});
it.each([
  ["engine-download-progress", "engine.zip"],
  ["model-download-progress", "model.gguf"],
  ["setup-progress", "setup-model.gguf"],
])("shows %s in the app header until the backend clears it", async (event, file) => {
  firstRun = event === "setup-progress";
  const handlers = new Map<string, (event: { payload: unknown }) => void>();
  mocks.listen.mockImplementation(async (name, handler) => { handlers.set(name, handler); return () => {}; });
  await mount();
  const emit = (payload: unknown) => act(() => handlers.get(event)!({ payload }));
  const titlebar = within(document.querySelector<HTMLElement>(".titlebar")!);
  emit({ file, phase: "downloading", downloaded: 40, total: 100, bytes_per_second: 10 });
  const meter = await titlebar.findByRole<HTMLProgressElement>("progressbar");
  expect(meter.value).toBe(40);
  expect(meter.getAttribute("aria-valuetext")).toBe(`Downloading… · ${file} · 40% · Remaining ≈ 0:06`);
  expect(meter.closest(".song-activity")?.querySelector(".app-wave[data-active]")).toBeTruthy();
  if (event === "engine-download-progress") {
    fireEvent.click(screen.getByRole("button", { name: t("settings_title") }));
    await screen.findByRole("dialog");
    expect(document.querySelector("#settingsForm .settings-page-header progress")).toBeNull();
    emit({ file, phase: "installing", downloaded: 0, total: 0, bytes_per_second: 0 });
    await waitFor(() => expect(meter.hasAttribute("value")).toBe(false));
    expect(meter.getAttribute("aria-label")).toBe(t("engine_installing"));
  }
  emit(null);
  await waitFor(() => expect(titlebar.queryByRole("progressbar")).toBeNull());
});
it("keeps startup pending until the first library and saved form values are ready",async()=>{
  firstRun=false;const original=mocks.invoke.getMockImplementation()!;
  let finishPreferences!:(value:unknown)=>void,finishSongs!:(value:unknown)=>void;
  mocks.invoke.mockImplementation((name,args)=>name==="get_generation_form_preferences"?new Promise(resolve=>{finishPreferences=resolve;}):name==="list_song_page"?new Promise(resolve=>{finishSongs=resolve;}):original(name,args));
  await mount();
  await waitFor(()=>expect(finishSongs).toBeTypeOf("function"));
  expect(mocks.invoke.mock.calls.some(([name])=>name==="startup_complete")).toBe(false);
  finishSongs({songs:[],total:0});
  await screen.findByText("Nothing yet");
  expect(mocks.invoke.mock.calls.some(([name])=>name==="startup_complete")).toBe(false);
  finishPreferences({duration:60,bpm:0,inference_steps:30,lm_temperature:1.2,variants:1});
  await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledWith("startup_complete",{attempt:1}));
  await waitFor(()=>expect(document.activeElement).toBe(document.querySelector('#genForm input[name="title"]')));
});
it("reports a failed initial library snapshot without completing startup",async()=>{
  firstRun=false;const original=mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((name,args)=>name==="list_song_page"?Promise.reject(new Error("database busy")):original(name,args));
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
  fireEvent.click(await screen.findByRole("button",{name:"Music generation"}));
  fireEvent.click(await screen.findByRole("button",{name:"Hardware test in setup wizard…"}));
  await screen.findByRole("heading",{name:"Welcome to Music Generator"});
  fireEvent.click(screen.getByRole("button",{name:"Back to studio"}));
  await waitFor(()=>expect((screen.getByRole("textbox",{name:"Prompt"}) as HTMLTextAreaElement).value).toBe("keep this idea"));
  expect(mocks.invoke.mock.calls.filter(([name])=>name==="bootstrap")).toHaveLength(1);
});

it("opens the creator model chooser directly on the settings models page", async () => {
  firstRun=false; await mount();
  fireEvent.click(await screen.findByRole("button",{name:t("picker_choose")}));
  expect(await screen.findByRole("dialog",{name:t("settings_title")})).toBeTruthy();
  expect(await screen.findByRole("table", { name: t("models_music") })).toBeTruthy();
  expect(screen.queryByRole("searchbox",{name:t("browser_search")})).toBeNull();
  expect(screen.getByRole("button",{name:t("settings_page_models")}).getAttribute("aria-current")).toBe("page");
  expect(screen.queryByRole("dialog",{name:t("picker_title")})).toBeNull();
});

it("opens general settings from the Creator's Expert Mode notice", async () => {
  firstRun = false;
  const invoke = mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation(async (name, args) => {
    const result = await invoke(name, args);
    return name === "get_settings" ? { ...result, expert_mode: false, synthesis_model: turbo.synthesis } : result;
  });
  await mount();
  fireEvent.click(await screen.findByRole("button", { name: t("expert_settings") }));
  const dialog = within(await screen.findByRole("dialog", { name: t("settings_title") }));
  expect(dialog.getByRole("heading", { name: t("settings_page_general") })).toBeTruthy();
  expect(await dialog.findByRole("switch", { name: t("expert_mode") })).toBeTruthy();
  expect(dialog.getByLabelText(t("hf_token"))).toBeTruthy();
});

it.each([["de", "Musikerzeugung", "Hardwaretest im Einrichtungsassistenten …"], ["en", "Music generation", "Hardware test in setup wizard…"]])("opens model management before explicitly running the existing hardware test in %s", async (language, entry, action) => {
  setLang(language); firstRun=false;
  const router=await mount();
  const prompt=await screen.findByRole("textbox",{name:t("prompt")});
  await waitFor(()=>expect((prompt as HTMLTextAreaElement).disabled).toBe(false));
  fireEvent.change(prompt,{target:{value:"keep this idea"}});
  fireEvent.click(screen.getByRole("button",{name:t("settings_title")}));
  fireEvent.click(await screen.findByRole("button",{name:entry}));
  const dialog=await screen.findByRole("dialog",{name:t("settings_title")});
  expect(screen.queryByRole("dialog",{name:t("picker_title")})).toBeNull();
  expect(router.state.location.pathname).toBe("/studio");
  await screen.findByRole("table", { name: t("models_music") });
  fireEvent.click(screen.getByRole("button", { name: t("models_add") }));
  const picker = await screen.findByRole("dialog", { name: t("models_add") });
  expect(within(picker).queryByRole("button", { name: action })).toBeNull();
  expect(within(picker).queryByText(t("desktop_manage_hint"))).toBeNull();
  fireEvent.click(within(picker).getByRole("button", { name: t("desktop_close") }));
  await waitFor(() => expect(picker.isConnected).toBe(false));
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
  fireEvent.click(await screen.findByRole("button",{name:"Music generation"}));
  const dialog=within(await screen.findByRole("dialog",{name:"Settings"}));
  if(status==="failed")await dialog.findByText("catalog unavailable");
  fireEvent.click(dialog.getByRole("button",{name:"Hardware test in setup wizard…"}));
  await waitFor(()=>expect(router.state.location.pathname).toBe("/setup"));
  expect(mocks.invoke.mock.calls.some(([name])=>name==="setup_models")).toBe(false);
});

it("can reapply the same song twice even when the system clock has not advanced",async()=>{
  firstRun=false;
  const original=mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((name,args)=>name==="list_song_page"?Promise.resolve({songs:[{id:"one",title:"Old",caption:"old prompt",letter:"",group_id:"g",status:"done",params:{prompt:"old prompt",inference_steps:30},result_meta:null,created_at:"2026-01-01",path:null}],total:1}):original(name,args));
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
