// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { I18nProvider } from "../i18n";
import { Header } from "../Header";
import { useReferenceAudio } from "../audio/useReferenceAudio";
import { I18N, LANGS, setLang } from "../../i18n.js";
import { GenerationAdmissionProvider } from "./admission";
import { GenerationForm, type GenerationFormProps } from "./GenerationForm";
import type { Generation, GenerationPolicy, Song } from "../../types";
import { catalogWithNativeProfiles, catalogWithAudioCraft, catalogWithDiffRhythm2, catalogWithHeartMuLa, catalogWithMagenta, catalogWithMiniMax, catalogWithMuLaCover, catalogWithStableAudio } from "../models/model-fixtures";

const ipc = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: ipc.invoke, convertFileSrc: (p: string) => p, Channel: class {} }));
const selection = { provider: "acestep", synthesis: "sft.gguf", language: "lm.gguf" };
const clipSelection = { provider: "mimetic-a0", synthesis: "mimetic-a0-model.fp16.safetensors", language: "" };
const preferences = { duration: 90, bpm: 0, inference_steps: 30, lm_temperature: 1.2, variants: 2 };
const policy: GenerationPolicy = { backend: "gpu", cpu_iteration_behavior: "ask", recommended_steps: 80, defaults: { ...preferences, inference_steps: 80 } };
const clipPolicy: GenerationPolicy = { ...policy, available: true, capabilities: {
  prompt: true, lyrics: false, lyrics_required: false, instrumental: true, bpm: true, advanced: false, analysis: false,
  min_duration: 0, max_duration: 16, max_variants: 1, bars: [1, 2, 4],
} };
let requests: Generation[];
let currentPolicy: GenerationPolicy;
beforeEach(() => {
  setLang("de"); requests = []; currentPolicy = policy;
  ipc.invoke.mockImplementation(async (command: string, args: { request?: Generation }) => {
    if (command === "get_generation_form_preferences") return preferences;
    if (command === "generation_policy") return currentPolicy;
    if (command === "queue") return { queued: requests.length, running: [], active: false, progress: null, library: { count: 0, bytes: 0 } };
    if (command === "generate") { requests.push(args.request!); return { ids: ["song-1"] }; }
    if (command === "save_generation_form_preferences") return;
    throw new Error(`Unexpected command: ${command}`);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function FormWithAudioControls(props: GenerationFormProps) {
  const reference = useReferenceAudio(props.selection);
  const [analysis, setAnalysis] = useState(props.analysis);
  return <><Header selection={props.selection} reference={reference}
    onAnalysis={(values, microphone) => setAnalysis(current => ({ values, microphone, revision: (current?.revision ?? 0) + 1 }))} />
    <GenerationForm {...props} reference={reference} analysis={analysis} /></>;
}

function mount(props: Partial<GenerationFormProps> = {}, withAudioControls = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Form = withAudioControls ? FormWithAudioControls : GenerationForm;
  const view = (next: Partial<GenerationFormProps>) => <QueryClientProvider client={client}><I18nProvider><GenerationAdmissionProvider settingsBlocked={next.settingsBlocked}><Form selection={selection} settingsBlocked={false} {...next} /></GenerationAdmissionProvider></I18nProvider></QueryClientProvider>;
  const rendered = render(view(props));
  return { ...rendered, client, changeProps(next: Partial<GenerationFormProps>) { rendered.rerender(view({ ...props, ...next })); } };
}
it("keeps conservative initial defaults and supported limits before backend values arrive",()=>{
  ipc.invoke.mockImplementation(()=>new Promise(()=>{}));
  const {container}=mount();
  const input=(name:string)=>container.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  expect(input("inference_steps").value).toBe("30");
  expect(input("lm_temperature").value).toBe("0.85");
  expect(input("duration").max).toBe("600");
  expect(input("inference_steps").max).toBe("200");
  expect(screen.queryByText(I18N.de.len_long)).toBeNull();
});
it("generates the displayed automatic prompt with saved numeric preferences and preserves it during editing", async () => {
  mount();
  await waitFor(() => expect((screen.getByRole("button", { name: "2× GENERIEREN" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.submit(screen.getByRole("button", { name: "2× GENERIEREN" }).closest("form")!);
  await waitFor(() => expect(requests).toHaveLength(1));
  const prompt = (screen.getByLabelText("Prompt") as HTMLTextAreaElement).value;
  expect(prompt.trim().length).toBeGreaterThan(0);
  expect(requests[0]).toMatchObject({ prompt, duration: 90, variants: 2, inference_steps: 30, instrumental: true, lyrics: "", model_selection: selection });
  expect(screen.getByText("GENERATED")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "A quiet lake" } });
  expect(screen.queryByText("GENERATED")).toBeNull();
});
it("allows fifteen minutes only when the length override is enabled", async () => {
  mount();
  const length = screen.getByRole<HTMLInputElement>("slider", { name: "Länge" });
  const choice = screen.getByRole("switch", { name: "Empfohlene Maximallänge ignorieren" });
  const generate = screen.getByRole<HTMLButtonElement>("button", { name: "2× GENERIEREN" });
  await waitFor(() => expect(generate.disabled).toBe(false));
  expect(length.max).toBe("600");
  fireEvent.click(choice);
  expect(length.max).toBe("900");
  fireEvent.change(length, { target: { value: "900" } });
  fireEvent.submit(generate.closest("form")!);
  await waitFor(() => expect(requests[0]).toMatchObject({ duration: 900, ignore_recommended_duration: true }));
  fireEvent.click(choice);
  expect(length.max).toBe("600");
  expect(length.value).toBe("90");
});
it("submits DiffRhythm lyrics and style text with the selected duration and seed", async () => {
  const diffrhythm = catalogWithDiffRhythm2().profiles![0];
  currentPolicy = { ...policy, backend: "unknown", available: true, capabilities: diffrhythm.capabilities };
  mount({ selection: diffrhythm.selection });
  const style = await screen.findByRole("textbox", { name: "Stilbeschreibung" });
  expect(screen.getByRole("textbox", { name: "Stilbeschreibung", description: "Beschreibe, wie der Song klingen soll." })).toBe(style);
  const lyrics = screen.getByRole("textbox", { name: "Lyrics" });
  expect(screen.queryByRole("textbox", { name: "Prompt" })).toBeNull();
  expect(screen.queryByRole("slider", { name: "BPM" })).toBeNull();
  expect(screen.queryByRole("slider", { name: "Iterationen" })).toBeNull();
  const generate = screen.getByRole("button", { name: "GENERIEREN" }) as HTMLButtonElement;
  expect(generate.disabled).toBe(true);
  fireEvent.change(style, { target: { value: "Soft piano under an intimate folk vocal" } });
  fireEvent.change(lyrics, { target: { value: "一场雨落下\nThe rain is falling" } });
  const duration = screen.getByRole("slider", { name: "Länge" }) as HTMLInputElement;
  expect(Number(duration.min)).toBe(diffrhythm.capabilities.min_duration);
  expect(Number(duration.max)).toBe(diffrhythm.capabilities.max_duration);
  fireEvent.change(duration, { target: { value: duration.min } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "Seed" }), { target: { value: "123" } });
  fireEvent.submit(generate.closest("form")!);
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toEqual({
    model_selection: diffrhythm.selection, folder_id: null, title: "", style: "Soft piano under an intimate folk vocal",
    lyrics: "一场雨落下\nThe rain is falling", duration: Number(duration.min), seed: 123,
    variants: 1, instrumental: false, keep_caption: true,
  });
  expect(ipc.invoke.mock.calls.some(([command]) => command === "save_generation_form_preferences")).toBe(false);
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("computes a clip from 4/4 bars and BPM and blocks submissions over 16 seconds", async () => {
  currentPolicy = clipPolicy;
  const { container } = mount({ selection: clipSelection });
  const description = await screen.findByRole("textbox", { name: "Beschreibung" });
  expect(screen.getByRole("textbox", { name: "Beschreibung", description: "Beschreibe Idee und Stil gemeinsam in diesem Feld." })).toBe(description);
  const generate = screen.getByRole("button", { name: "GENERIEREN" }) as HTMLButtonElement;
  expect(generate.disabled).toBe(true);
  expect(screen.queryByRole("slider", { name: "Länge" })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Stil" })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Lyrics" })).toBeNull();
  const bars = screen.getByRole<HTMLSelectElement>("combobox", { name: "Takte (4/4)" });
  expect([...bars.options].map(option => option.value)).toEqual(["1", "2", "4"]);
  const bpm = screen.getByRole("spinbutton", { name: "BPM" });
  expect(screen.getByText("Länge: 2 s")).toBeTruthy();
  fireEvent.change(description, { target: { value: "boom bap drum loop" } });
  fireEvent.change(bars, { target: { value: "4" } });
  fireEvent.change(bpm, { target: { value: "59" } });
  expect(screen.getByText(/maximal 16 Sekunden/)).toBeTruthy();
  expect(generate.disabled).toBe(true);
  fireEvent.submit(container.querySelector("form")!);
  expect(requests).toHaveLength(0);
  fireEvent.change(bpm, { target: { value: "60.5" } });
  expect(generate.disabled).toBe(true);
  fireEvent.change(bpm, { target: { value: "60" } });
  expect(screen.getByText("Länge: 16 s")).toBeTruthy();
  expect(generate.disabled).toBe(false);
  fireEvent.change(screen.getByRole("spinbutton", { name: "Seed" }), { target: { value: "123" } });
  fireEvent.submit(container.querySelector("form")!);
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toEqual({
    model_selection: clipSelection, title: "", folder_id: null, instrumental: true, lyrics: "",
    prompt: "boom bap drum loop", bars: 4, bpm: 60, duration: 16, variants: 1, seed: 123, keep_caption: true,
  });
  expect(ipc.invoke.mock.calls.some(([command]) => command === "save_generation_form_preferences")).toBe(false);
});
it("restores the saved clip meter and seed from a library item", async () => {
  currentPolicy = clipPolicy;
  const song = { id: "clip", title: "Bass loop", seed: 123, params: {
    model_selection: clipSelection, prompt: "finger bass in A minor", bars: 2, bpm: 95, duration: 480 / 95,
  } } as Song;
  mount({ selection: clipSelection, reuse: { song, revision: 1 } });
  const description = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Beschreibung" });
  await waitFor(() => expect(description.value).toBe("finger bass in A minor"));
  expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Takte (4/4)" }).value).toBe("2");
  expect(screen.getByRole<HTMLInputElement>("spinbutton", { name: "BPM" }).value).toBe("95");
  expect(screen.getByRole<HTMLInputElement>("spinbutton", { name: "Seed" }).value).toBe("123");
  expect(screen.getByText("Länge: 5,053 s")).toBeTruthy();
});

it("submits a MAGNeT prompt at the checkpoint's fixed duration", async () => {
  const profile = catalogWithAudioCraft(true).profiles!.find(item => item.selection.synthesis === "magnet-small-30secs")!;
  currentPolicy = { ...policy, backend: "unknown", available: true, capabilities: profile.capabilities };
  mount({ selection: profile.selection });
  await screen.findByText("30 Sekunden");
  expect(screen.queryByRole("slider", { name: "Länge" })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Lyrics" })).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), { target: { value: "instrumental funk" } });
  fireEvent.submit(screen.getByRole("button", { name: "GENERIEREN" }).closest("form")!);
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toMatchObject({ model_selection: profile.selection, prompt: "instrumental funk",
    duration: 30, variants: 1, lyrics: "", instrumental: false });
  expect(requests[0].inference_steps).toBeUndefined();
});

it("queues a timed instrumental Magenta recording with a text prompt", async () => {
  const magenta = catalogWithMagenta(true).profiles![0];
  currentPolicy = { ...policy, available: true, capabilities: magenta.capabilities };
  mount({ selection: magenta.selection });
  const duration = await screen.findByRole("slider", { name: "Aufnahmedauer" }) as HTMLInputElement;
  await waitFor(() => expect(duration.max).toBe("120"));
  expect(duration.min).toBe("10");
  expect(screen.queryByRole("textbox", { name: "Lyrics" })).toBeNull();
  expect(screen.queryByRole("slider", { name: "BPM" })).toBeNull();
  expect(screen.queryByRole("slider", { name: "Iterationen" })).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), { target: { value: "Sparse jazz piano, soft brushing" } });
  fireEvent.change(duration, { target: { value: "18" } });
  const generate = screen.getByRole("button", { name: "GENERIEREN" });
  fireEvent.submit(generate.closest("form")!);
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toMatchObject({ model_selection: magenta.selection, prompt: "Sparse jazz piano, soft brushing", duration: 18, instrumental: true, lyrics: "", variants: 1 });
});

it.each([120, 380])("submits a Stable Audio prompt and a duration limited to %s seconds", async max => {
  const profile = catalogWithStableAudio().profiles!.find(item => item.capabilities.max_duration === max)!;
  currentPolicy = { ...policy, backend: "unknown", available: true, capabilities: profile.capabilities };
  mount({ selection: profile.selection });
  const generate = await screen.findByRole("button", { name: "GENERIEREN" }) as HTMLButtonElement;
  await waitFor(() => expect(generate.disabled).toBe(false));
  expect(screen.queryByRole("textbox", { name: "Lyrics" })).toBeNull();
  expect(screen.queryByRole("slider", { name: "BPM" })).toBeNull();
  const duration = screen.getByRole("slider", { name: "Länge" }) as HTMLInputElement;
  expect(duration.max).toBe(String(max));
  fireEvent.change(duration, { target: { value: String(max) } });
  fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), { target: { value: "Slow jazz piano" } });
  fireEvent.submit(generate.closest("form")!);
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toMatchObject({
    model_selection: profile.selection, duration: max, prompt: "Slow jazz piano",
    instrumental: true, lyrics: "", variants: 1,
  });
});
it("passes the MiniMax description and lyrics through and labels its duration control", async () => {
  const minimax = catalogWithMiniMax().profiles![0];
  currentPolicy = { ...policy, backend: "unknown", available: true, capabilities: minimax.capabilities };
  mount({ selection: minimax.selection });
  const description = await screen.findByRole("textbox", { name: "Strukturierte Beschreibung" });
  expect(screen.getByText("MiniMax-Music3")).toBeTruthy();
  const prompt = "Global Metadata: folk\nVocal Details: warm\nArrangement: strings";
  const lyrics = "[Verse]\nWe follow starlight";
  fireEvent.change(description, { target: { value: prompt } });
  fireEvent.change(screen.getByRole("textbox", { name: "Lyrics" }), { target: { value: lyrics } });
  const duration = screen.getByRole("slider", { name: "Länge" });
  expect(duration.getAttribute("title")).toContain("Generierungsbudget");
  fireEvent.change(duration, { target: { value: "180" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "Seed" }), { target: { value: "314159" } });
  const generate = screen.getByRole("button", { name: "GENERIEREN" }) as HTMLButtonElement;
  expect(generate.disabled).toBe(false);
  fireEvent.submit(generate.closest("form")!);
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toMatchObject({ prompt, lyrics, duration: 180, seed: 314159, variants: 1, instrumental: false, model_selection: minimax.selection });
  expect(requests[0].inference_steps).toBeUndefined();
});

it("submits a MIDI composition prompt without audio-only controls", async () => {
  const midi = { provider: "text2midi", synthesis: "text2midi", language: "flan-t5-base" };
  currentPolicy = { ...policy, backend: "cpu", available: true, capabilities: {
    output_kind: "midi", prompt: true, instrumental: true, lyrics: false, lyrics_required: false,
    bpm: false, analysis: false, advanced: false, min_duration: 0, max_duration: 0, max_variants: 1,
  } };
  mount({ selection: midi });
  const generate = await screen.findByRole("button", { name: "MIDI generieren" }) as HTMLButtonElement;
  expect(screen.getByRole("heading", { name: "MIDI-Komposition" })).toBeTruthy();
  expect(generate.disabled).toBe(true);
  expect(screen.queryByRole("slider")).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Stil" })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Lyrics" })).toBeNull();
  const prompt = screen.getByRole("textbox", { name: "Prompt" });
  fireEvent.change(prompt, { target: { value: "  " } });
  expect(generate.disabled).toBe(true);
  fireEvent.change(prompt, { target: { value: "  Slow piano waltz in A minor  " } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "Seed" }), { target: { value: "133" } });
  fireEvent.click(generate);
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toEqual({
    model_selection: midi, prompt: "Slow piano waltz in A minor", seed: 133,
    title: "", instrumental: true, keep_caption: true, variants: 1, folder_id: null,
  });
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("queues a MuLaCover remix only after choosing and approving a reference beside the microphone", async () => {
  const profile = catalogWithMuLaCover().profiles![0];
  currentPolicy = { ...policy, available: true, capabilities: profile.capabilities };
  const original = ipc.invoke.getMockImplementation()!;
  const id = "a".repeat(64);
  ipc.invoke.mockImplementation((name, args) => name === "pick_reference_audio"
    ? Promise.resolve({ id, name: "Meine Aufnahme.wav" })
    : original(name, args));
  mount({ selection: profile.selection }, true);
  const pick = await screen.findByRole("button", { name: "Referenz-WAV auswählen" });
  expect(pick.previousElementSibling?.id).toBe("recBtn");
  expect(pick.closest("form")).toBeNull();
  const generate = screen.getByRole("button", { name: "GENERIEREN" });
  const form = generate.closest("form")!;
  fireEvent.change(screen.getByRole("textbox", { name: "Stil" }), { target: { value: "genre:[folk]; instrument:[piano]" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Lyrics" }), { target: { value: "[Verse]\nAm Ufer ist es leise" } });
  fireEvent.submit(form);
  expect(requests).toHaveLength(0);
  fireEvent.click(pick);
  expect(await screen.findByText("Meine Aufnahme.wav")).toBeTruthy();
  fireEvent.submit(form);
  expect(requests).toHaveLength(0);
  fireEvent.click(screen.getByRole("switch", { name: /Die Referenz gehört mir/ }));
  fireEvent.submit(form);
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toMatchObject({
    model_selection: profile.selection,
    reference_audio: id,
    style: "genre:[folk]; instrument:[piano]",
    lyrics: "[Verse]\nAm Ufer ist es leise",
    instrumental: false,
  });
  expect(requests[0]).not.toHaveProperty("prompt");
});

it("keeps the CPU confirmation cancellable after a failed hardware probe and admits only one reduced request", async () => {
  currentPolicy = { ...policy, backend: "cpu" };
  mount();
  await waitFor(() => expect((screen.getByRole("button", { name: "2× GENERIEREN" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByText("Erweitert"));
  fireEvent.change(screen.getByRole("slider", { name: "Iterationen" }), { target: { value: "80" } });
  const production = ipc.invoke.getMockImplementation()!;
  ipc.invoke.mockImplementation((command: string, args: { refresh?: boolean }) => {
    if (command === "generation_policy" && args.refresh) return Promise.reject(new Error("probe unavailable"));
    return production(command, args);
  });
  const form = screen.getByRole("button", { name: "2× GENERIEREN" }).closest("form")!;
  fireEvent.submit(form); fireEvent.submit(form);
  await screen.findByRole("dialog");
  expect(requests).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Mit 30 starten" }));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0].inference_steps).toBe(30);
  expect((screen.getByRole("slider", { name: "Iterationen" }) as HTMLInputElement).value).toBe("30");
});
it("does not admit generation when remembering the CPU choice fails and preserves the choice for retry", async () => {
  currentPolicy = { ...policy, backend: "cpu" };
  const production = ipc.invoke.getMockImplementation()!;
  let failSave = true;
  ipc.invoke.mockImplementation(async (command: string, args: { values?: { cpu_iteration_behavior: string } }) => {
    if (command === "save_settings") {
      if (failSave) throw new Error("disk full");
      return { cpu_iteration_behavior: args.values!.cpu_iteration_behavior };
    }
    return production(command, args);
  });
  mount();
  await waitFor(() => expect((screen.getByRole("button", { name: "2× GENERIEREN" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByText("Erweitert"));
  fireEvent.change(screen.getByRole("slider", { name: "Iterationen" }), { target: { value: "80" } });
  fireEvent.submit(screen.getByRole("button", { name: "2× GENERIEREN" }).closest("form")!);
  await screen.findByRole("dialog");
  fireEvent.click(screen.getByRole("switch", { name: "Diese Entscheidung merken" }));
  fireEvent.click(screen.getByRole("button", { name: "Trotzdem starten" }));
  await screen.findByRole("alert");
  expect(requests).toHaveLength(0);
  failSave = false;
  fireEvent.click(screen.getByRole("button", { name: "Trotzdem starten" }));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0].inference_steps).toBe(80);
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("serializes durable preference writes and flushes the newest numeric edit before closing", async () => {
  const production = ipc.invoke.getMockImplementation()!;
  let finish!: () => void;
  let persistedDuration = 90;
  const writes: number[] = [];
  ipc.invoke.mockImplementation(async (command: string, args: { values?: { duration: number } }) => {
    if (command !== "save_generation_form_preferences") return production(command, args);
    const duration = args.values!.duration; writes.push(duration);
    if (writes.length === 1) await new Promise<void>(resolve => { finish = resolve; });
    persistedDuration = duration;
  });
  let flush!: () => Promise<void>;
  mount({ onPreferencesFlush: value => { flush = value; } });
  await waitFor(() => expect((screen.getByRole("button", { name: "2× GENERIEREN" }) as HTMLButtonElement).disabled).toBe(false));
  expect(writes).toEqual([]);
  fireEvent.change(screen.getByRole("slider", { name: "Länge" }), { target: { value: "100" } });
  await waitFor(() => expect(writes).toEqual([100]));
  fireEvent.change(screen.getByRole("slider", { name: "Länge" }), { target: { value: "105" } });
  fireEvent.change(screen.getByRole("slider", { name: "Länge" }), { target: { value: "110" } });
  expect(writes).toEqual([100]);
  await act(async () => { finish(); await flush(); });
  expect(persistedDuration).toBe(110);
  expect(writes).toEqual([100, 110]);
});
it("does not overwrite durable preferences after a failed read, including when the window closes", async () => {
  const production = ipc.invoke.getMockImplementation()!;
  let reads = 0, writes = 0;
  ipc.invoke.mockImplementation(async (command: string, args: unknown) => {
    if (command === "get_generation_form_preferences") { reads++; if (reads === 1) throw new Error("database busy"); return preferences; }
    if (command === "save_generation_form_preferences") { writes++; return; }
    return production(command, args);
  });
  let flush!: () => Promise<void>;
  mount({ onPreferencesFlush: value => { flush = value; } });
  await waitFor(() => expect((screen.getByRole("button", { name: "2× GENERIEREN" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByText("Erweitert"));
  expect((screen.getByRole("slider", { name: "Iterationen" }) as HTMLInputElement).value).toBe("80");
  expect(screen.getByText("Die Formularwerte konnten nicht geladen oder gespeichert werden. Bei der nächsten Änderung oder beim Schließen wird das Speichern erneut versucht.")).toBeTruthy();
  await act(async () => { await flush(); });
  expect(reads).toBe(2); expect(writes).toBe(0);
});
it.each([80,91,100,120,200])("preserves a stored %s-step preference until an explicit reset uses current model defaults", async steps => {
  const production = ipc.invoke.getMockImplementation()!;
  const saved: unknown[] = [];
  ipc.invoke.mockImplementation(async (command: string, args: { values?: unknown }) => {
    if (command === "get_generation_form_preferences") return { ...preferences, inference_steps: steps };
    if (command === "save_generation_form_preferences") { saved.push(args.values); return; }
    return production(command, args);
  });
  let flush!: () => Promise<void>;
  mount({ onPreferencesFlush: value => { flush = value; } });
  await waitFor(() => expect((screen.getByRole("button", { name: "2× GENERIEREN" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByText("Erweitert"));
  expect((screen.getByRole("slider", { name: "Iterationen" }) as HTMLInputElement).value).toBe(String(steps));
  expect(saved).toEqual([]);
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Keep this title" } });
  fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "Keep this idea" } });
  fireEvent.click(screen.getByRole("button", { name: "Grundeinstellungen zurücksetzen" }));
  await act(async () => { await flush(); });
  expect(saved.at(-1)).toEqual({ ...preferences, inference_steps: 80 });
  expect((screen.getByLabelText("Titel") as HTMLInputElement).value).toBe("Keep this title");
  expect((screen.getByLabelText("Prompt") as HTMLTextAreaElement).value).toBe("Keep this idea");
});
it("keeps generated prompt text, edited style and accessible descriptions across all twelve languages", async () => {
  mount();
  await waitFor(() => expect((screen.getByRole("button", { name: "2× GENERIEREN" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText("Stil"), { target: { value: "quiet piano" } });
  fireEvent.submit(screen.getByRole("button", { name: "2× GENERIEREN" }).closest("form")!);
  await waitFor(() => expect(requests).toHaveLength(1));
  const prompt = (screen.getByLabelText("Prompt") as HTMLTextAreaElement).value;
  for (const language of Object.keys(LANGS) as (keyof typeof LANGS)[]) {
    act(() => setLang(language));
    const texts = I18N[language] as Record<string, unknown>;
    const field = screen.getByLabelText(texts.prompt as string) as HTMLTextAreaElement;
    const hint = texts.prompt_style_combined_hint as string;
    expect(hint).toBeTruthy();
    expect(screen.getByText(hint)).toBeTruthy();
    expect(screen.getByRole("textbox", { name: texts.prompt as string, description: hint })).toBe(field);
    expect(screen.getByRole("textbox", { name: texts.style as string, description: hint })).toBeTruthy();
    expect(document.documentElement.lang).toBe(language);
    expect(field.value).toBe(prompt); expect(field.placeholder).toBe(texts.prompt_ph);
    expect(screen.getByText("GENERATED").title).toBe(texts.prompt_generated);
    expect(screen.getByText("GENERATED").getAttribute("aria-label")).toBe(texts.prompt_generated);
  }
  expect((document.querySelector('[name="style"]') as HTMLTextAreaElement).value).toBe("quiet piano");
});
it.each(["", " \n\t "])("fills blank prompt %j without replacing style or requested variants", async prompt => {
  mount();
  await waitFor(() => expect((screen.getByRole("button", { name: "2× GENERIEREN" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: prompt } });
  fireEvent.change(screen.getByLabelText("Stil"), { target: { value: "trip hop, piano" } });
  fireEvent.change(screen.getByRole("slider", { name: "Versionen" }), { target: { value: "4" } });
  fireEvent.submit(screen.getByRole("button", { name: "4× GENERIEREN" }).closest("form")!);
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toMatchObject({ style: "trip hop, piano", variants: 4, prompt: (screen.getByLabelText("Prompt") as HTMLTextAreaElement).value });
});
it("preserves an explicit prompt byte for byte and blocks settings-time generation without filling it", async () => {
  const view = mount({ settingsBlocked: true });
  await waitFor(() => expect(document.querySelector("#genForm")!.getAttribute("aria-busy")).toBe("false"));
  fireEvent.submit(document.querySelector("#genForm")!);
  expect(requests).toHaveLength(0); expect((screen.getByLabelText("Prompt") as HTMLTextAreaElement).value).toBe("");
  view.changeProps({ settingsBlocked: false });
  const prompt = "  Meine Idee: Regen über Berlin.\nEin leiser Chor.  ";
  fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: prompt } });
  fireEvent.submit(document.querySelector("#genForm")!);
  await waitFor(() => expect(requests).toHaveLength(1)); expect(requests[0].prompt).toBe(prompt); expect(screen.queryByText("GENERATED")).toBeNull();
});
it("keeps microphone analysis from replacing the user's chosen title, style and duration", async () => {
  const view = mount();
  await waitFor(() => expect((screen.getByRole("button", { name: "2× GENERIEREN" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "My idea" } });
  fireEvent.change(screen.getByLabelText("Stil"), { target: { value: "quiet piano" } });
  view.changeProps({ analysis: { values: { caption: "energetic synthesizer", prompt: "A rising melody", duration: 201, bpm: 120, keyscale: "B minor" }, revision: 1, microphone: true } });
  expect((screen.getByLabelText("Titel") as HTMLInputElement).value).toBe("My idea");
  expect((screen.getByLabelText("Stil") as HTMLTextAreaElement).value).toBe("quiet piano");
  expect((screen.getByRole("slider", { name: "Länge" }) as HTMLInputElement).value).toBe("90");
  expect((screen.getByLabelText("Prompt") as HTMLTextAreaElement).value).toBe("energetic synthesizer");
  view.changeProps({ analysis: { values: { caption: "energetic synthesizer", duration: 201, bpm: 120 }, revision: 2 } });
  expect((screen.getByRole("slider", { name: "Länge" }) as HTMLInputElement).value).toBe("200");
});
it.each([[120,"sft.gguf",120],[0,"turbo.gguf",8]] as const)("reuses historical %s-step %s parameters without mutating history", async (steps, synthesis, expected) => {
  const historicalSelection = { ...selection, synthesis };
  const song = { id: "saved", title: "Historical song", seed: 42, params: Object.freeze({ caption: "quiet piano", lyrics: "[Instrumental]", inference_steps: steps, model_selection: historicalSelection }), } as Song;
  const chosen: unknown[] = [];
  const view = mount({ onSelectionChange: value => chosen.push(value) });
  await waitFor(() => expect((screen.getByRole("button", { name: "2× GENERIEREN" }) as HTMLButtonElement).disabled).toBe(false));
  view.changeProps({ reuse: { song, revision: 1 } });
  expect((screen.getByRole("slider", { name: "Iterationen" }) as HTMLInputElement).value).toBe(String(expected));
  expect((screen.getByLabelText("Stil") as HTMLTextAreaElement).value).toBe("quiet piano");
  expect(chosen).toEqual([historicalSelection]); expect(song.params.inference_steps).toBe(steps);
  expect(screen.queryByText("GENERATED")).toBeNull();
});
it.each([true,false])("uses instrumental=%s when rolling an automatic prompt", async instrumental => {
  vi.spyOn(Math, "random").mockReturnValue(0.1);
  mount();
  await waitFor(() => expect((screen.getByRole("button", { name: "2× GENERIEREN" }) as HTMLButtonElement).disabled).toBe(false));
  if (!instrumental) fireEvent.click(screen.getByRole("button", { name: "Lyrics automatisch schreiben lassen (erst beim Generieren)" }));
  fireEvent.submit(document.querySelector("#genForm")!);
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toMatchObject({ instrumental, prompt: instrumental ? "A marching band in slow motion" : "A marching band in slow motion, with a soft female lead" });
});
it.each(["collapsed", "reopened"] as const)("submits custom lyrics and their language with the lyrics panel %s", async state => {
  const { container } = mount();
  const generate = screen.getByRole<HTMLButtonElement>("button", { name: "2× GENERIEREN" });
  await waitFor(() => expect(generate.disabled).toBe(false));
  const panel = container.querySelector<HTMLDetailsElement>("#lyricsBox")!;
  const summary = panel.querySelector("summary")!;
  fireEvent.click(summary);
  expect(panel.open).toBe(true);
  const field = screen.getByRole("textbox", { name: "Lyrics" });
  const lyrics = "[verse]\nSous la pluie, je chante.";
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: lyrics } });
  fireEvent.change(screen.getByRole("combobox", { name: I18N.de.language_aria }), { target: { value: "fr" } });
  fireEvent.click(summary);
  expect(panel.open).toBe(false);
  if (state === "reopened") {
    fireEvent.click(summary);
    expect(panel.open).toBe(true);
    expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Lyrics" }).value).toBe(lyrics);
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: I18N.de.language_aria }).value).toBe("fr");
  }
  fireEvent.submit(generate.form!);
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toMatchObject({ instrumental: false, lyrics, vocal_language: "fr" });
});
it("submits automatic vocals with empty lyrics after collapsing the lyrics panel", async () => {
  const { container } = mount();
  const generate = screen.getByRole<HTMLButtonElement>("button", { name: "2× GENERIEREN" });
  await waitFor(() => expect(generate.disabled).toBe(false));
  const panel = container.querySelector<HTMLDetailsElement>("#lyricsBox")!;
  const summary = panel.querySelector("summary")!;
  fireEvent.click(summary);
  const field = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Lyrics" });
  fireEvent.focus(field);
  expect(field.value).toBe("");
  fireEvent.change(screen.getByRole("combobox", { name: I18N.de.language_aria }), { target: { value: "es" } });
  fireEvent.click(summary);
  expect(panel.open).toBe(false);
  fireEvent.submit(generate.form!);
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toMatchObject({ instrumental: false, lyrics: "", vocal_language: "es" });
});
it("submits an explicit instrumental selection after collapsing and reopening the lyrics panel", async () => {
  const { container } = mount();
  const generate = screen.getByRole<HTMLButtonElement>("button", { name: "2× GENERIEREN" });
  await waitFor(() => expect(generate.disabled).toBe(false));
  const summary = container.querySelector("#lyricsBox summary")!;
  fireEvent.click(summary);
  const field = screen.getByRole("textbox", { name: "Lyrics" });
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: "[verse]\nI used to sing." } });
  fireEvent.change(screen.getByRole("combobox", { name: I18N.de.language_aria }), { target: { value: "fr" } });
  fireEvent.click(screen.getByRole("button", { name: "[instrumental]" }));
  fireEvent.click(summary);
  fireEvent.click(summary);
  expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Lyrics" }).value).toBe("[Instrumental]");
  fireEvent.submit(generate.form!);
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toMatchObject({ instrumental: true, lyrics: "", vocal_language: "" });
});
it("retains the automatic prompt through admission failure and retry", async () => {
  const production = ipc.invoke.getMockImplementation()!;
  let fail = true;
  ipc.invoke.mockImplementation(async (command: string, args: unknown) => {
    if (command === "generate" && fail) throw new Error("Engine unavailable");
    return production(command, args);
  });
  mount();
  await waitFor(() => expect((screen.getByRole("button", { name: "2× GENERIEREN" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.submit(document.querySelector("#genForm")!);
  await screen.findByRole("alert");
  const prompt = (screen.getByLabelText("Prompt") as HTMLTextAreaElement).value;
  expect(screen.getByText("GENERATED")).toBeTruthy(); fail = false;
  fireEvent.submit(document.querySelector("#genForm")!);
  await waitFor(() => expect(requests).toHaveLength(1)); expect(requests[0].prompt).toBe(prompt);
});
it("shows warning text and risk semantics at 30 steps outside the collapsed advanced controls", async () => {
  currentPolicy = { ...policy, backend: "cpu" }; mount();
  await screen.findByText("Die Klangerzeugung läuft auf der CPU. Mehr als 30 Iterationen können die Generierung deutlich verlängern. Für einen ersten Versuch empfehlen wir 30 Iterationen und 10 Sekunden Musik.");
  const warning = document.querySelector("#cpuGenerationWarning")!;
  expect(document.querySelector("#advBox")!.contains(warning)).toBe(false);
  fireEvent.click(screen.getByText("Erweitert"));
  const slider = screen.getByRole("slider", { name: "Iterationen" });
  expect(slider.getAttribute("aria-describedby")).toBe("cpuGenerationWarning");
  fireEvent.change(slider, { target: { value: "29" } });
  expect(document.querySelector("#cpuGenerationWarning")).toBeNull();
  expect(slider.hasAttribute("aria-describedby")).toBe(false);
});
it("keeps a failed preference write available for retry on close after subsequent edits", async () => {
  const production = ipc.invoke.getMockImplementation()!;
  let fail = true;
  let persisted: unknown;
  ipc.invoke.mockImplementation(async (command: string, args: { values?: unknown }) => {
    if (command === "save_generation_form_preferences") { if (fail) throw new Error("Disk full"); persisted = args.values; return; }
    return production(command, args);
  });
  let flush!: () => Promise<void>;
  mount({ onPreferencesFlush: value => { flush = value; } });
  await waitFor(() => expect((screen.getByRole("button", { name: "2× GENERIEREN" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.change(screen.getByRole("slider", { name: "Länge" }), { target: { value: "600" } });
  await screen.findByText("Die Formularwerte konnten nicht geladen oder gespeichert werden. Bei der nächsten Änderung oder beim Schließen wird das Speichern erneut versucht.");
  fireEvent.change(screen.getByRole("slider", { name: "Versionen" }), { target: { value: "4" } });
  await act(async () => { await Promise.resolve(); }); fail = false;
  await act(async () => { await flush(); });
  expect(persisted).toEqual({ ...preferences, duration: 600, variants: 4 });
  expect(document.querySelector("#genPreferencesError")).toBeNull();
});
it("bounds older out-of-range song parameters to the visible controls before generation", async () => {
  const song = { id: "old", title: "Old parameters", seed: 42, params: { duration: 900, bpm: 250, lm_temperature: 2, inference_steps: 80, lyrics: "[Instrumental]" } } as Song;
  const view = mount();
  await waitFor(() => expect((screen.getByRole("button", { name: "2× GENERIEREN" }) as HTMLButtonElement).disabled).toBe(false));
  view.changeProps({ reuse: { song, revision: 1 } });
  fireEvent.submit(document.querySelector("#genForm")!);
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toMatchObject({ duration: 600, bpm: 200, lm_temperature: 1.5 });
  expect(song.params.duration).toBe(900);
});

it.each([[30, 0], [123.7, 124], [250, 200]])("normalizes analyzed %s BPM before saving preferences and generating", async (bpm, expected) => {
  let flush!: () => Promise<void>;
  const view = mount({ onPreferencesFlush: value => { flush = value; } });
  await waitFor(() => expect((screen.getByRole("button", { name: "2× GENERIEREN" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.change(screen.getByRole("slider", { name: "BPM" }), { target: { value: "90" } });
  view.changeProps({ analysis: { values: { caption: "a calm piano", prompt: "unrelated engine prompt", bpm }, revision: 1 } });
  await act(async () => { await flush(); });
  const writes = ipc.invoke.mock.calls.filter(([command]) => command === "save_generation_form_preferences");
  expect(writes.at(-1)?.[1]).toEqual({ values: { ...preferences, bpm: expected } });
  expect(screen.getByRole("slider", { name: "BPM" }).getAttribute("aria-valuetext")).toBe(expected ? `${expected} BPM` : "Auto");
  fireEvent.submit(document.querySelector("#genForm")!);
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toMatchObject({ prompt: "a calm piano", bpm: expected });
});
it.each(["[Instrumental]", "  [instrumental]  "])("recognizes manually typed %s as instrumental in both hint and payload", async lyrics => {
  mount();
  await waitFor(() => expect((screen.getByRole("button", { name: "2× GENERIEREN" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Lyrics automatisch schreiben lassen (erst beim Generieren)" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Lyrics" }), { target: { value: lyrics } });
  expect(document.querySelector("#lyricsHint")!.textContent).toBe("[Instrumental]");
  fireEvent.submit(document.querySelector("#genForm")!);
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toMatchObject({ instrumental: true, lyrics: "", vocal_language: "" });
});
it("updates the queued announcement from backend snapshots and clears it once no songs are queued", async () => {
  const original = ipc.invoke.getMockImplementation()!;
  let queued = 2;
  ipc.invoke.mockImplementation(async (command, args) => command === "queue" ? { queued, running: [], active: false, progress: null, library: { count: 0, bytes: 0 } } : original(command, args));
  const view = mount();
  await waitFor(() => expect((screen.getByRole("button", { name: "2× GENERIEREN" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.submit(document.querySelector("#genForm")!);
  await screen.findByText("2 Song(s) in der Warteschlange");
  queued = 1;
  await act(async () => { await view.client.invalidateQueries({ queryKey: ["queue"] }); });
  await screen.findByText("1 Song(s) in der Warteschlange");
  queued = 0;
  await act(async () => { await view.client.invalidateQueries({ queryKey: ["queue"] }); });
  await waitFor(() => expect(screen.queryByText(/Song\(s\) in der Warteschlange/)).toBeNull());
});

it.each([["yue2", "Maximale Dauer", 360], ["heartmula", "Länge", 240]] as const)("submits only the supported %s controls and preserves ACE-Step duration preferences", async (provider, durationLabel, maxDuration) => {
  const nativeProfile = catalogWithNativeProfiles().profiles!.find(profile => profile.selection.provider === provider)!;
  currentPolicy = { ...policy, backend: "unknown", available: true, capabilities: nativeProfile.capabilities };
  mount({ selection: nativeProfile.selection });
  const style = await screen.findByRole("textbox", { name: "Stil-Tags" });
  const lyrics = screen.getByRole("textbox", { name: "Lyrics" });
  expect(screen.queryByRole("textbox", { name: "Prompt" })).toBeNull();
  expect(screen.queryByRole("slider", { name: "BPM" })).toBeNull();
  expect(screen.queryByRole("slider", { name: "Iterationen" })).toBeNull();
  const generate = screen.getByRole("button", { name: "GENERIEREN" }) as HTMLButtonElement;
  expect(generate.disabled).toBe(true);
  fireEvent.change(style, { target: { value: "soul, piano" } });
  fireEvent.change(lyrics, { target: { value: "[verse]\nThe rain is falling" } });
  const duration = screen.getByRole("slider", { name: durationLabel }) as HTMLInputElement;
  expect(Number(duration.min)).toBe(nativeProfile.capabilities.min_duration);
  expect(Number(duration.max)).toBe(maxDuration);
  fireEvent.change(duration, { target: { value: String(maxDuration) } });
  fireEvent.change(screen.getByRole("spinbutton", { name: provider === "yue2" ? "Audio-Seed" : "Seed" }), { target: { value: "123" } });
  fireEvent.submit(generate.closest("form")!);
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toEqual({
    model_selection: nativeProfile.selection, folder_id: null, title: "", style: "soul, piano",
    lyrics: "[verse]\nThe rain is falling", duration: maxDuration, seed: 123,
    variants: 1, instrumental: false, keep_caption: true,
  });
  expect(ipc.invoke.mock.calls.some(([command]) => command === "save_generation_form_preferences")).toBe(false);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("lets YuE2 queue an instrumental without lyrics and keeps the vocal draft when switching back", async () => {
  const profile = catalogWithNativeProfiles().profiles!.find(profile => profile.selection.provider === "yue2")!;
  currentPolicy = { ...policy, available: true, capabilities: profile.capabilities };
  mount({ selection: profile.selection });
  fireEvent.change(await screen.findByRole("textbox", { name: "Stil-Tags" }), { target: { value: "lofi piano" } });
  const lyrics = "[verse]\nWe walk home";
  const generate = screen.getByRole<HTMLButtonElement>("button", { name: "GENERIEREN" });
  expect(generate.disabled).toBe(true);
  fireEvent.change(screen.getByRole("textbox", { name: "Lyrics" }), { target: { value: lyrics } });
  const mode = screen.getByRole("switch", { name: "Instrumental" });
  fireEvent.click(mode);
  expect(screen.queryByRole("textbox", { name: "Lyrics" })).toBeNull();
  fireEvent.click(mode);
  expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Lyrics" }).value).toBe(lyrics);
  fireEvent.click(mode);
  expect(generate.disabled).toBe(false);
  fireEvent.submit(generate.closest("form")!);
  await waitFor(() => expect(requests[0]).toMatchObject({ instrumental: true, lyrics: "", style: "lofi piano" }));
});

it("enables YuE2 file analysis through ACE-Step and merges the result into styles", async () => {
  const profile = catalogWithNativeProfiles().profiles!.find(profile => profile.selection.provider === "yue2")!;
  currentPolicy = { ...policy, available: true, analysis_available: true, capabilities: profile.capabilities };
  const original = ipc.invoke.getMockImplementation()!;
  ipc.invoke.mockImplementation((command, args) => {
    if (command === "dialog_directory") return Promise.resolve("/audio");
    if (command === "pick_and_analyze_audio") return Promise.resolve({ caption: "A jazz piano trio", bpm: 97, lyrics: "Words from the recording" });
    return original(command, args);
  });
  mount({ selection: profile.selection }, true);
  const style = await screen.findByRole<HTMLInputElement>("textbox", { name: "Stil-Tags" });
  const lyrics = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Lyrics" });
  fireEvent.change(style, { target: { value: "warm" } });
  fireEvent.change(lyrics, { target: { value: "My lyrics" } });
  const pick = await waitFor(() => {
    const button = screen.getByRole<HTMLButtonElement>("button", { name: "Audiodatei analysieren" });
    expect(button.disabled).toBe(false);
    return button;
  });
  fireEvent.click(pick);
  await waitFor(() => expect(style.value).toBe("warm, jazz, piano, 97 bpm"));
  expect(lyrics.value).toBe("My lyrics");
  expect(ipc.invoke).toHaveBeenCalledWith("pick_and_analyze_audio", expect.objectContaining({ selection: profile.selection }));
});

it("queues multiple YuE2 versions with independent planning and synthesis controls", async () => {
  const profile = catalogWithNativeProfiles().profiles!.find(profile => profile.selection.provider === "yue2")!;
  currentPolicy = { ...policy, available: true, capabilities: profile.capabilities };
  const { container } = mount({ selection: profile.selection });
  fireEvent.change(await screen.findByRole("textbox", { name: "Stil-Tags" }), { target: { value: "lofi, upright piano" } });
  fireEvent.click(screen.getByRole("switch", { name: "Instrumental" }));
  const versions = screen.getByRole<HTMLInputElement>("slider", { name: "Versionen" });
  expect(versions.value).toBe("1");
  expect(versions.max).toBe("8");
  fireEvent.change(versions, { target: { value: "3" } });
  container.querySelector<HTMLDetailsElement>(".yue2-fields")!.open = true;
  fireEvent.change(screen.getByLabelText("Audio-Seed"), { target: { value: "42" } });
  fireEvent.change(screen.getByLabelText("Planungs-Seed"), { target: { value: "99" } });
  fireEvent.change(screen.getByLabelText("Syntheseschritte"), { target: { value: "16" } });
  fireEvent.change(screen.getByLabelText("Partiturplanung"), { target: { value: "melody" } });
  fireEvent.change(screen.getByLabelText("Guidance (CFG)"), { target: { value: "1.25" } });
  const sampling = container.querySelectorAll("details.yue2-sampling")[1]!;
  fireEvent.change(sampling.querySelectorAll("input")[1]!, { target: { value: "0.83" } });
  const generate = screen.getByRole<HTMLButtonElement>("button", { name: "3× GENERIEREN" });
  expect(generate.disabled).toBe(false);
  fireEvent.submit(generate.closest("form")!);
  await waitFor(() => expect(requests[0]).toMatchObject({
    seed: 42, instrumental: true, variants: 3,
    yue2: { lm_seed: 99, steps: 16, cot: "melody", cfg_scale: 1.25, semantic_sampling: { top_p: 0.83 } },
  }));
  expect(requests[0].inference_steps).toBeUndefined();
  fireEvent.change(screen.getByLabelText("Partiturplanung"), { target: { value: "off" } });
  await waitFor(() => expect(generate.disabled).toBe(true));
  expect(screen.getByText(/Wähle für eine ABC-Partitur/)).toBeTruthy();
});
