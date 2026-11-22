// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App, secureConnectionUrl } from "./App";
import { connectionKey, RemoteApi } from "./client";
import { MobileStems } from "./Stems";
import { ACE_STEP_ABILITIES } from "../generation-limits";
import type { ActiveGenerationProfile } from "../types";
import models from "../../models/catalog.json";

const request = vi.fn();
const song = { id: "one", title: "Rain song", status: "done", favorite: false, folder_id: null, duration: 90, bpm: 80, has_audio: true, message: null };
const library = { songs: [song], folders: { folders: [], all: 1, none: 1 } };
const ace: ActiveGenerationProfile = { selection: { provider: "ace-step", synthesis: "acestep-v15-sft-Q8_0.gguf", language: "lm.gguf" }, name: "ACE-Step 1.5", capabilities: ACE_STEP_ABILITIES, available: true };
const heartmula: ActiveGenerationProfile = {
  selection: { provider: "heartmula", synthesis: "heartmula-oss-3b-hny", language: "" },
  name: "HeartMuLa 3B HNY", available: true,
  capabilities: { prompt: false, lyrics: true, lyrics_required: true, instrumental: false, bpm: false, advanced: false, analysis: false, min_duration: 5, max_duration: 240, max_variants: 1, max_seed: 4294967295 },
};
beforeEach(() => {
  window.localStorage.clear(); window.history.replaceState(null, "", "/mobile/#token=paired-key");
  vi.stubGlobal("isSecureContext", true);
  vi.spyOn(navigator, "language", "get").mockReturnValue("en");
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.stubGlobal("fetch", request);
  request.mockReset();
  request.mockImplementation(async (path: string) => {
    const value = path.startsWith("/api/pwa/library?") ? library : path === "/api/queue" ? { running: [], queued: 0, active: false, progress: null } : path === "/api/generate" ? { ids: ["new"], group_id: "g" } : path === "/api/generation-profile" ? ace : {};
    return new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("exports the selected mobile Original from a legacy mix with current package selection rules", async () => {
  const project = {
    id: "separation", status: "done", phase: "done", project: { frames: 44100, roles: ["vocals"] },
    request: { name: "Rain stems", pin: { model: "htdemucs" }, preview: false },
  };
  const legacy = { id: "saved", name: "Legacy version", updated_at: "", mix: {
    version: 1, first: 12, end: 218, master_db: -3, looping: false,
    tracks: [{ role: "vocals", name: "Voice", gain_db: -2, pan: .25, mute: false, solo: false, fade_in: 0, fade_out: 0 }],
  } };
  request.mockImplementation(async (path: string) => {
    const body = path === "/api/stems/models" ? { models: [] }
      : path === "/api/stems/jobs" ? [project] : path.endsWith("/mixes") ? [legacy] : path === "/api/stems/exports" ? { id: "export" } : [];
    return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  });
  render(<MobileStems api={new RemoteApi("paired-key", "en", vi.fn())} language="en" exit={vi.fn()}/>);
  fireEvent.click(await screen.findByRole("button", { name: "Mixer" }));
  await screen.findByRole("option", { name: legacy.name });
  fireEvent.change(screen.getByRole("combobox", { name: "Stem" }), { target: { value: "original" } });
  fireEvent.click(screen.getByRole("button", { name: "Export stem package" }));
  await waitFor(() => expect(request.mock.calls.find(([path]) => path === "/api/stems/exports")).toBeTruthy());
  const [, options] = request.mock.calls.find(([path]) => path === "/api/stems/exports")!;
  expect(JSON.parse(options.body)).toMatchObject({ project_id: "separation", kind: "package", selected: [], include_original: true, include_mix: true,
    mix: { ...legacy.mix, version: 2 } });
});

it("pairs from the QR fragment, shows the library and submits a generation to the same computer", async () => {
  render(<App />);
  await screen.findByRole("heading", { name: "Rain song" });
  expect(window.location.hash).toBe("");
  expect(window.localStorage.getItem(connectionKey)).toBe("paired-key");
  fireEvent.click(screen.getByRole("button", { name: "Favorite: Rain song" }));
  await waitFor(() => expect(request).toHaveBeenCalledWith("/api/songs/one", expect.objectContaining({ method: "PATCH", body: '{"favorite":true}' })));
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  fireEvent.change(await screen.findByRole("textbox", { name: "Your idea" }), { target: { value: "warm piano" } });
  fireEvent.click(screen.getByRole("button", { name: "Generate on computer" }));
  await screen.findByText("Your song is in the queue.");
  const call = request.mock.calls.find(([path]) => path === "/api/generate")!;
  expect(call[1].headers.get("Authorization")).toBe("Bearer paired-key");
  expect(JSON.parse(call[1].body)).toMatchObject({ prompt: "warm piano", instrumental: true, duration: 90, variants: 1, folder_id: null });
});

it("keeps the engine progress and animated logo visible when switching to Create", async () => {
  const original = request.getMockImplementation()!;
  request.mockImplementation((path, options) => {
    if (path.startsWith("/api/pwa/library?")) return Response.json({ ...library, songs: [{ ...song, status: "running", has_audio: false }] });
    if (path !== "/api/queue") return original(path, options);
    return Response.json({
      running: [{ id: song.id }], queued: 0, active: true,
      progress: { job_id: song.id, sequence: 1, phase: "dit", step: 8, total_steps: 20, elapsed_seconds: 15, overall_percent: 71, estimated_remaining_seconds: 24 },
    });
  });
  const { container } = render(<App />);
  const meter = await screen.findByRole<HTMLProgressElement>("progressbar", { name: "Progress" });
  expect(meter.value).toBe(71);
  expect(meter.max).toBe(100);
  expect(meter.getAttribute("aria-valuetext")).toBe("Generating audio · 8/20 · 0:15 · ≈ 71% · Remaining ≈ 0:24");
  expect((await screen.findByRole<HTMLProgressElement>("progressbar", { name: "Progress · Rain song" })).value).toBe(71);
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  await screen.findByRole("textbox", { name: "Your idea" });
  expect(screen.getByRole("progressbar", { name: "Progress" })).toBe(meter);
  expect(container.querySelector(".app-header .app-wave[data-active]")).toBeTruthy();
});

it("limits HeartMuLa generation to lyrics, style tags, seed and its profile duration", async () => {
  const original = request.getMockImplementation()!;
  request.mockImplementation((path, options) => path === "/api/generation-profile" ? Response.json(heartmula) : original(path, options));
  render(<App />);
  await screen.findByRole("heading", { name: "Rain song" });
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  const style = await screen.findByRole("textbox", { name: "Style tags" });
  expect(screen.getByRole("textbox", { name: "Style tags", description: "Separate style tags with commas." })).toBe(style);
  expect(screen.queryByRole("textbox", { name: "Your idea" })).toBeNull();
  expect(screen.queryByRole("switch", { name: "Instrumental" })).toBeNull();
  expect(screen.queryByText("Use an audio idea")).toBeNull();
  const generate = screen.getByRole("button", { name: "Generate on computer" }) as HTMLButtonElement;
  expect(generate.disabled).toBe(true);
  fireEvent.change(style, { target: { value: "jazz, keys" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Lyrics" }), { target: { value: "[chorus]\nThe road is clear" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "Seed" }), { target: { value: "42" } });
  const duration = screen.getByRole("spinbutton", { name: "Length (seconds)" }) as HTMLInputElement;
  expect(duration.min).toBe("5");
  expect(duration.max).toBe("240");
  fireEvent.change(duration, { target: { value: "240" } });
  fireEvent.click(generate);
  await screen.findByText("Your song is in the queue.");
  const call = request.mock.calls.find(([path]) => path === "/api/generate")!;
  expect(JSON.parse(call[1].body)).toEqual({
    model_selection: heartmula.selection, style: "jazz, keys", lyrics: "[chorus]\nThe road is clear",
    seed: 42, duration: 240, title: "", variants: 1, instrumental: false, folder_id: null, keep_caption: true,
  });
});

it("queues YuE2 versions with custom options from the phone", async () => {
  const original = request.getMockImplementation()!;
  const profile = models.profiles.find(profile => profile.selection.provider === "yue2")!;
  request.mockImplementation((path, options) => path === "/api/generation-profile"
    ? Response.json({ ...profile, available: true }) : original(path, options));
  const { container } = render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Create" }));
  fireEvent.change(await screen.findByRole("textbox", { name: "Style tags" }), { target: { value: "jazz piano" } });
  fireEvent.change(screen.getByLabelText("Versions"), { target: { value: "2" } });
  container.querySelector<HTMLDetailsElement>(".yue2-fields")!.open = true;
  fireEvent.change(screen.getByLabelText("Synthesis steps"), { target: { value: "12" } });
  fireEvent.change(screen.getByLabelText("Planning seed"), { target: { value: "-1" } });
  fireEvent.click(screen.getByRole("button", { name: "Generate on computer" }));
  await screen.findByText("Your song is in the queue.");
  const call = request.mock.calls.find(([path]) => path === "/api/generate")!;
  expect(JSON.parse(call[1].body)).toMatchObject({ variants: 2, style: "jazz piano", instrumental: true, yue2: { steps: 12, lm_seed: -1 } });
});

it("transmits an explicit extended duration to the desktop", async () => {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Create" }));
  const length = await screen.findByRole<HTMLInputElement>("spinbutton", { name: "Length (seconds)" });
  const choice = screen.getByRole("switch", { name: "Ignore recommended maximum length" });
  expect(length.max).toBe("600");
  fireEvent.click(choice);
  expect(length.max).toBe("900");
  fireEvent.change(length, { target: { value: "900" } });
  fireEvent.click(choice);
  expect(length.value).toBe("600");
  fireEvent.click(choice);
  fireEvent.change(length, { target: { value: "900" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Your idea" }), { target: { value: "ambient" } });
  fireEvent.click(screen.getByRole("button", { name: "Generate on computer" }));
  await screen.findByText("Your song is in the queue.");
  const call = request.mock.calls.find(([path]) => path === "/api/generate")!;
  expect(JSON.parse(call[1].body)).toMatchObject({ duration: 900, ignore_recommended_duration: true });
});

it("sends the metered clip controls and validates the same length limit as Studio", async () => {
  const clip: ActiveGenerationProfile = {
    selection: { provider: "mimetic-a0", synthesis: "mimetic-a0-model.fp16.safetensors", language: "" },
    name: "Mimetic A0", available: true,
    capabilities: { prompt: true, lyrics: false, lyrics_required: false, instrumental: true, bpm: true,
      advanced: false, analysis: false, min_duration: 0, max_duration: 16, max_variants: 1, bars: [1, 2, 4] },
  };
  const original = request.getMockImplementation()!;
  request.mockImplementation((path, options) => path === "/api/generation-profile" ? Response.json(clip) : original(path, options));
  render(<App />);
  await screen.findByRole("heading", { name: "Rain song" });
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  const description = await screen.findByRole("textbox", { name: "Description" });
  expect(screen.getByRole("textbox", { name: "Description", description: "Describe the idea and style together in this field." })).toBe(description);
  const generate = screen.getByRole<HTMLButtonElement>("button", { name: "Generate on computer" });
  expect(generate.disabled).toBe(true);
  expect(screen.queryByRole("spinbutton", { name: "Length (seconds)" })).toBeNull();
  expect(screen.queryByRole("switch", { name: "Instrumental" })).toBeNull();
  const bars = screen.getByRole("combobox", { name: "Bars (4/4)" });
  const bpm = screen.getByRole("spinbutton", { name: "BPM" });
  fireEvent.change(description, { target: { value: "analog synth melody" } });
  fireEvent.change(bars, { target: { value: "4" } });
  fireEvent.change(bpm, { target: { value: "59" } });
  expect(screen.getByText(/to stay within 16 seconds/)).toBeTruthy();
  expect(generate.disabled).toBe(true);
  fireEvent.submit(generate.closest("form")!);
  expect(request.mock.calls.some(([path]) => path === "/api/generate")).toBe(false);
  fireEvent.change(bpm, { target: { value: "124" } });
  expect(screen.getByText("7.742 s")).toBeTruthy();
  fireEvent.change(screen.getByRole("spinbutton", { name: "Seed" }), { target: { value: "42" } });
  fireEvent.click(generate);
  await screen.findByText("Your song is in the queue.");
  const call = request.mock.calls.find(([path]) => path === "/api/generate")!;
  expect(JSON.parse(call[1].body)).toEqual({
    model_selection: clip.selection, title: "", prompt: "analog synth melody", lyrics: "",
    bars: 4, bpm: 124, duration: 960 / 124, seed: 42, variants: 1, instrumental: true, folder_id: null, keep_caption: true,
  });
});

it("sends a Stable Audio instrumental without lyrics controls", async () => {
  const stableAudio: ActiveGenerationProfile = {
    selection: { provider: "stable-audio-3", synthesis: "stable-audio-3-small-music", language: "" },
    name: "Stable Audio 3 Small Music", available: true,
    capabilities: { ...heartmula.capabilities, prompt: true, lyrics: false, lyrics_required: false, instrumental: true, min_duration: 5, max_duration: 120 },
  };
  const original = request.getMockImplementation()!;
  request.mockImplementation((path, options) => path === "/api/generation-profile" ? Response.json(stableAudio) : original(path, options));
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Create" }));
  const hint = "Prompt and style tags are sent to the model as one description.";
  const prompt = await screen.findByRole("textbox", { name: "Your idea", description: hint });
  expect(screen.getByRole("textbox", { name: "Style", description: hint })).toBeTruthy();
  fireEvent.change(prompt, { target: { value: "warm piano" } });
  expect(screen.queryByRole("switch", { name: "Instrumental" })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Lyrics" })).toBeNull();
  expect((screen.getByRole("spinbutton", { name: "Length (seconds)" }) as HTMLInputElement).max).toBe("120");
  fireEvent.click(screen.getByRole("button", { name: "Generate on computer" }));
  await screen.findByText("Your song is in the queue.");
  const call = request.mock.calls.find(([path]) => path === "/api/generate")!;
  expect(JSON.parse(call[1].body)).toMatchObject({ model_selection: stableAudio.selection, prompt: "warm piano", lyrics: "", instrumental: true });
});

it("offers the default audio format first and downloads the format chosen on the phone", async () => {
  const original = request.getMockImplementation()!;
  request.mockImplementation((path, options) => {
    if (path === "/api/queue") return Response.json({
      running: [], queued: 0, active: false, audio_export: { default_format: "mp3_320", formats: ["wav", "mp3_320", "aac", "original"] },
    });
    if (path === "/api/songs/one/audio?download=true&format=aac") {
      return new Response(new Blob(["audio"]), { headers: { "Content-Disposition": 'attachment; filename="Rain.aac"' } });
    }
    return original(path, options);
  });
  const save = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.download).toBe("Rain.aac");
  });
  render(<App />);
  const download = await screen.findByRole("button", { name: "Download: Rain song" });
  fireEvent.click(download);
  const menu = screen.getByRole("menu", { name: "Download format" });
  expect(within(menu).getAllByRole("menuitem")).toEqual(
    ["MP3 · 320 kbit/s", "WAV", "AAC · 192 kbit/s", "Original file"].map(name => within(menu).getByRole("menuitem", { name })),
  );
  fireEvent.pointerDown(screen.getByRole("heading", { name: "Rain song" }));
  expect(screen.queryByRole("menu", { name: "Download format" })).toBeNull();
  fireEvent.click(download);
  fireEvent.click(screen.getByRole("menuitem", { name: "AAC · 192 kbit/s" }));
  await screen.findByText("Download prepared");
  expect(save).toHaveBeenCalledOnce();
  expect(screen.queryByRole("menu", { name: "Download format" })).toBeNull();
});

it("uses a MIDI prompt and downloads the result as a MIDI attachment", async () => {
  const midi: ActiveGenerationProfile = {
    selection: { provider: "text2midi", synthesis: "text2midi", language: "flan-t5-base" },
    name: "Text2midi", available: true,
    capabilities: {
      output_kind: "midi", prompt: true, lyrics: false, lyrics_required: false, instrumental: true,
      bpm: false, advanced: false, analysis: false, min_duration: 0, max_duration: 0, max_variants: 1,
    },
  };
  const original = request.getMockImplementation()!;
  request.mockImplementation((path, options) => {
    if (path === "/api/generation-profile") return Response.json(midi);
    if (path.startsWith("/api/pwa/library?")) return Response.json({
      ...library, songs: [{ ...song, duration: null, bpm: null, has_audio: false, output_kind: "midi", has_midi: true }],
    });
    if (path === "/api/songs/one/midi") return new Response(new Blob(["MThd"]), { headers: { "Content-Disposition": 'attachment; filename="Rain.mid"' } });
    return original(path, options);
  });
  const save = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.download).toBe("Rain.mid");
  });
  render(<App />);
  expect(await screen.findByText("MIDI (.mid)")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Play: Rain song" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Download MIDI: Rain song" }));
  await screen.findByText("Download prepared");
  expect(save).toHaveBeenCalledOnce();

  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  const generate = await screen.findByRole("button", { name: "Generate MIDI on computer" }) as HTMLButtonElement;
  expect(generate.disabled).toBe(true);
  expect(screen.queryByRole("spinbutton", { name: "Length (seconds)" })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Style" })).toBeNull();
  expect(screen.queryByText("Use an audio idea")).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: "Your idea" }), { target: { value: "Quiet violin in 3/4" } });
  fireEvent.click(generate);
  await waitFor(() => expect(request.mock.calls.some(([path]) => path === "/api/generate")).toBe(true));
  const call = request.mock.calls.find(([path]) => path === "/api/generate")!;
  expect(JSON.parse(call[1].body)).toEqual({
    model_selection: midi.selection, title: "", prompt: "Quiet violin in 3/4", seed: -1,
    variants: 1, folder_id: null, instrumental: true, keep_caption: true,
  });
});

it("cancels a queued song through the same authenticated computer", async () => {
  const original = request.getMockImplementation()!;
  let cancelled = false;
  request.mockImplementation((path, options) => {
    if (path.startsWith("/api/pwa/library?")) return Response.json({ ...library, songs: [{ ...song, status: cancelled ? "cancelled" : "queued", has_audio: false }] });
    if (path === "/api/songs/one/cancel") { cancelled = true; return Response.json({ cancelled }); }
    return original(path, options);
  });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Cancel: Rain song" }));
  await screen.findByText(/^Cancelled/);
  const call = request.mock.calls.find(([path]) => path === "/api/songs/one/cancel")!;
  expect(call[1].method).toBe("POST");
  expect(call[1].headers.get("Authorization")).toBe("Bearer paired-key");
});

it("keeps cards on two 304 polls, updates queue progress and refreshes the changed library", async () => {
  vi.useFakeTimers();
  const validators: (string | null)[] = [];
  let revision = '"first"';
  let progress = 0;
  const updated = {
    songs: [{ ...song, favorite: true, folder_id: "demos" }, { ...song, id: "two", title: "New song", status: "queued", has_audio: false }],
    folders: { folders: [{ id: "demos", name: "Demos", count: 1 }], all: 2, none: 1 },
  };
  request.mockImplementation(async (path: string, options: { headers: Headers }) => {
    if (path === "/api/queue") {
      progress += 20;
      return Response.json({ running: [{ message: `Rendering ${progress}%` }], queued: 0, active: true, progress: null });
    }
    expect(path).toMatch(/^\/api\/pwa\/library\?/);
    const validator = options.headers.get("If-None-Match");
    validators.push(validator);
    if (validator === revision) return new Response(null, { status: 304, headers: { ETag: revision } });
    const data = revision === '"first"' ? library : updated;
    return Response.json(path.includes("favorites=true") ? { ...data, songs: data.songs.filter(card => card.favorite) } : data, { headers: { ETag: revision } });
  });
  render(<App />);
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(screen.getByRole("heading", { name: "Rain song" })).toBeTruthy();
  expect(screen.getByText("1:30 · 80 BPM")).toBeTruthy();

  for (const progress of [40, 60]) {
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(screen.getByText(`Rendering ${progress}%`)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Rain song" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  }
  expect(validators).toEqual([null, '"first"', '"first"']);

  revision = '"changed"';
  await act(() => vi.advanceTimersByTimeAsync(5000));
  expect(validators.at(-1)).toBe('"first"');
  expect(screen.getByRole("heading", { name: "New song" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Favorite: Rain song" }).getAttribute("aria-pressed")).toBe("true");
  expect((screen.getByRole("combobox", { name: "Move to folder: Rain song" }) as HTMLSelectElement).value).toBe("demos");
  expect(screen.getByRole("option", { name: "Demos · 1" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Favorites" }));
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(validators.at(-1)).toBeNull();
  expect(screen.queryByRole("heading", { name: "New song" })).toBeNull();
});

it("clears a revoked saved key and asks for a fresh pairing", async () => {
  window.localStorage.setItem(connectionKey, "old");
  request.mockResolvedValue(new Response('{"detail":"expired"}', { status: 401 }));
  render(<App />);
  expect(await screen.findByText("The key is no longer valid. Scan the new QR code on your computer.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
  expect(window.localStorage.getItem(connectionKey)).toBeNull();
});

it("shows certificate onboarding over HTTP without sending the pairing key to the API", async () => {
  vi.stubGlobal("isSecureContext", false);
  request.mockResolvedValue(new Response(JSON.stringify({ secure_addresses: ["https://localhost:8768/mobile/"], certificate_url: "/mobile-ca.crt", certificate_fingerprint: "AB:CD" })));
  render(<App />);
  const link = await screen.findByRole("link", { name: "Open HTTPS web app" });
  expect(link.getAttribute("href")).toBe("https://localhost:8768/mobile/#token=paired-key");
  expect(screen.getByText("AB:CD")).toBeTruthy();
  const profile = screen.getByRole("link", { name: "iPhone: install profile" });
  expect(profile.getAttribute("href")).toBe("/mobile-ca.mobileconfig");
  expect(profile.hasAttribute("download")).toBe(false);
  expect(screen.getByRole("link", { name: "Android: download certificate" }).getAttribute("href")).toBe("/mobile-ca.crt");
  expect(request.mock.calls.every(([path]) => path === "/mobile/connection.json")).toBe(true);
  expect(request.mock.calls[0][1].headers).toBeUndefined();
});

it("carries the key only to an HTTPS address for this host and the designated secure port", () => {
  const host = { hostname: "studio.local" };
  expect(secureConnectionUrl(["https://evil.test:8768/mobile/", "https://studio.local:9999/mobile/", "http://studio.local:8768/mobile/"], host, "key")).toBeNull();
  expect(secureConnectionUrl(["https://studio.local:8768/mobile/"], host, "key")).toBe("https://studio.local:8768/mobile/#token=key");
});

it("stops audio and releases the blob when the connection is disconnected", async () => {
  const create = vi.fn(() => "blob:playing"), revoke = vi.fn();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  const original = request.getMockImplementation()!;
  request.mockImplementation((path, options) => path === "/api/songs/one/audio" ? Promise.resolve(new Response(new Blob(["audio"]))) : original(path, options));
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Play: Rain song" }));
  await screen.findByLabelText("Now playing");
  await act(async () => { fireEvent.click(screen.getByText("Connection", { selector: "summary" })); });
  fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
  await screen.findByRole("heading", { name: "Connect to your computer" });
  expect(revoke).toHaveBeenCalledWith("blob:playing");
  expect(screen.queryByLabelText("Now playing")).toBeNull();
});

it("keeps a generation submission pending when navigating between tabs", async () => {
  const original = request.getMockImplementation()!;
  let finish!: (value: Response) => void;
  request.mockImplementation((path, options) => path === "/api/generate" ? new Promise<Response>(resolve => { finish = resolve; }) : original(path, options));
  render(<App />);
  await screen.findByRole("heading", { name: "Rain song" });
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  fireEvent.change(await screen.findByRole("textbox", { name: "Your idea" }), { target: { value: "only one song" } });
  const form = screen.getByRole("button", { name: "Generate on computer" }).closest("form")!;
  fireEvent.submit(form);
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  fireEvent.click(screen.getByRole("button", { name: "Library" }));
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  expect((screen.getByRole("textbox", { name: "Your idea" }) as HTMLTextAreaElement).value).toBe("only one song");
  expect((screen.getByRole("button", { name: "Loading…" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.submit(form);
  expect(request.mock.calls.filter(([path]) => path === "/api/generate")).toHaveLength(1);
  await act(async () => { finish(new Response('{"ids":["new"],"group_id":"g"}')); });
  await screen.findByText("Your song is in the queue.");
});

it("waits for a successful queue response before claiming the computer is ready", async () => {
  const original = request.getMockImplementation()!;
  let finish!: (value: Response) => void;
  request.mockImplementation((path, options) => path === "/api/queue" ? new Promise<Response>(resolve => { finish = resolve; }) : original(path, options));
  render(<App />);
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  expect(screen.queryByText("Ready for a new idea")).toBeNull();
  expect(screen.queryByText("Connected to your computer")).toBeNull();
  await act(async () => { finish(new Response('{"running":[],"queued":0,"active":false,"progress":null}')); });
  await screen.findByText("Ready for a new idea");
});

it("remembers a QR connection across launches and lets the user opt out", async () => {
  render(<App />); await screen.findByRole("heading", { name: "Rain song" });
  expect(window.localStorage.getItem(connectionKey)).toBe("paired-key");
  cleanup(); window.history.replaceState(null, "", "/mobile/");
  render(<App />); await screen.findByRole("heading", { name: "Rain song" });
  fireEvent.click(screen.getByText("Connection", { selector: "summary" }));
  fireEvent.click(screen.getByRole("switch", { name: "Remember the key on this device" }));
  await waitFor(() => expect(window.localStorage.getItem(connectionKey)).toBeNull());
  expect(screen.getByRole("heading", { name: "Rain song" })).toBeTruthy();
  cleanup(); render(<App />);
  expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
});

it("shows scanning without requesting camera access and accepts a pasted connection link", async () => {
  const camera = vi.fn();
  vi.stubGlobal("navigator", { language: "en", mediaDevices: { getUserMedia: camera } });
  window.history.replaceState(null, "", "/mobile/");
  const originalAddress = window.location.href;
  render(<App />);
  expect(screen.getByRole("button", { name: "Scan QR code" })).toBeTruthy();
  expect(camera).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Access key"), { target: { value: "https://another-host.test/mobile/#token=pasted-key" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  await screen.findByRole("heading", { name: "Rain song" });
  expect(window.location.href).toBe(originalAddress);
  expect(window.localStorage.getItem(connectionKey)).toBe("pasted-key");
  expect(request.mock.calls.some(([path]) => String(path).startsWith("https://another-host.test"))).toBe(false);
});

it("shows a measured WAV just below one minute as 1:00", async () => {
  const original = request.getMockImplementation()!;
  request.mockImplementation((path, options) => path.startsWith("/api/pwa/library?")
    ? Response.json({ ...library, songs: [{ ...song, duration: 59.998667 }] })
    : original(path, options));
  render(<App />);
  expect(await screen.findByText("1:00 · 80 BPM")).toBeTruthy();
});
