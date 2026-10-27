// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { I18N, LANGS, setLang } from "../../i18n.js";
import { GenerationAdmissionProvider } from "./admission";
import { GenerationForm, type GenerationFormProps } from "./GenerationForm";
import type { Generation, GenerationPolicy, Song } from "../../types";

const ipc = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: ipc.invoke, convertFileSrc: (p: string) => p }));
const selection = { provider: "acestep", synthesis: "sft.gguf", language: "lm.gguf" };
const preferences = { duration: 90, bpm: 0, inference_steps: 30, lm_temperature: 1.2, variants: 2 };
const policy: GenerationPolicy = { backend: "gpu", cpu_iteration_behavior: "ask", recommended_steps: 80, defaults: { ...preferences, inference_steps: 80 } };
let requests: Generation[];
let currentPolicy: GenerationPolicy;
beforeEach(() => {
  setLang("de"); requests = []; currentPolicy = policy;
  ipc.invoke.mockImplementation(async (command: string, args: { request?: Generation }) => {
    if (command === "get_generation_form_preferences") return preferences;
    if (command === "generation_policy") return currentPolicy;
    if (command === "generate") { requests.push(args.request!); return { ids: ["song-1"] }; }
    if (command === "save_generation_form_preferences") return;
    throw new Error(`Unexpected command: ${command}`);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function mount(props: Partial<GenerationFormProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = (next: Partial<GenerationFormProps>) => <QueryClientProvider client={client}><I18nProvider><GenerationAdmissionProvider settingsBlocked={next.settingsBlocked}><GenerationForm selection={selection} settingsBlocked={false} {...next} /></GenerationAdmissionProvider></I18nProvider></QueryClientProvider>;
  const rendered = render(view(props));
  return { ...rendered, client, changeProps(next: Partial<GenerationFormProps>) { rendered.rerender(view({ ...props, ...next })); } };
}
it("keeps conservative initial defaults and supported limits before backend values arrive",()=>{
  ipc.invoke.mockImplementation(()=>new Promise(()=>{}));
  const {container}=mount();
  const input=(name:string)=>container.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  expect(input("inference_steps").value).toBe("30");
  expect(input("lm_temperature").value).toBe("1.2");
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
  fireEvent.click(screen.getByRole("checkbox", { name: "Diese Entscheidung merken" }));
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
it.each([100,120,200])("preserves a stored %s-step preference until an explicit reset uses current model defaults", async steps => {
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
  expect((screen.getByLabelText("Prompt") as HTMLTextAreaElement).value).toBe("A rising melody");
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
