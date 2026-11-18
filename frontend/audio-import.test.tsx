// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "./react/i18n";
import { AudioControls } from "./react/audio/AudioControls";
import { setLang, t } from "./i18n.js";
import { backend } from "./backend";
import type { ModelSelection } from "./types";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  convertFileSrc: (path: string, protocol: string) => `http://${protocol}.localhost/${path}`,
  Channel: class { constructor(readonly onmessage: (value: unknown) => void) {} },
}));
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); setLang("en");
  invoke.mockImplementation(async (command, args) => {
    if (command === "dialog_directory") return "/home/test";
    if (command === "pick_and_analyze_audio") {
      args.onSelected.onmessage({ name: "雨.wav", directory: "/music" });
      return { caption: "Piano", bpm: 100 };
    }
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mount(selection: ModelSelection | null = null) {
  const analyzed = vi.fn();
  render(<QueryClientProvider client={new QueryClient()}><I18nProvider><AudioControls selection={selection} onAnalysis={analyzed} /></I18nProvider></QueryClientProvider>);
  return analyzed;
}
it.each(["click", "Enter", " "])("native audio selection via %s applies the analysis returned from Rust", async activation => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const analyzed = mount(); const user = userEvent.setup();
  const upload = screen.getByRole("button", { name: t("drop_aria") });
  if (activation === "click") await user.click(upload);
  else { upload.focus(); await user.keyboard(activation === "Enter" ? "{Enter}" : " "); }
  await waitFor(() => expect(analyzed).toHaveBeenCalledWith({ caption: "Piano", bpm: 100 }, false));
  expect(invoke.mock.calls.map(([command]) => command)).toEqual(["dialog_directory", "pick_and_analyze_audio"]);
  expect(invoke).toHaveBeenCalledWith("pick_and_analyze_audio", { directory: "/home/test", title: t("dialog_audio_import"), filterName: t("dialog_audio_filter"), selection: null, onSelected: expect.any(Object) });
  expect(fetch).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem("dialog-folders:v1")!).audio_import).toBe("/music");
});
it("leaves analysis and folder history untouched on cancellation and reports native read errors", async () => {
  const analyzed = mount(); const user = userEvent.setup();
  const upload = screen.getByRole("button", { name: t("drop_aria") });
  let finish!: (value: null) => void;
  invoke.mockImplementation(async command => command === "dialog_directory" ? "/home/test" : new Promise(resolve => { finish = resolve; }));
  await user.click(upload); await user.click(upload);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("pick_and_analyze_audio", expect.any(Object)));
  expect(invoke.mock.calls.filter(([name]) => name === "pick_and_analyze_audio")).toHaveLength(1);
  await act(async () => finish(null));
  expect(analyzed).not.toHaveBeenCalled(); expect(localStorage.getItem("dialog-folders:v1")).toBeNull();
  invoke.mockImplementation(async command => { if (command === "dialog_directory") return "/home/test"; throw new Error("audio_size"); });
  await user.click(upload);
  await screen.findByText(`${t("error")}: ${t("audio_size")}`);
  expect(analyzed).not.toHaveBeenCalled();
});

it("serializes the 8 MiB drop as raw fetch bytes and applies the analysis", async () => {
  const selection = { provider: "local", synthesis: "dit", language: "lm" };
  const bytes = new Uint8Array(8 * 1024 * 1024);
  for (let index = 0; index < bytes.length; index++) bytes[index] = index % 256;
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const request = new Request(url, init);
    expect(request.method).toBe("POST");
    const query = new URL(request.url).searchParams;
    expect(query.get("filename")).toBe("雨 & Piano.wav");
    expect(JSON.parse(query.get("selection")!)).toEqual(selection);
    expect(request.headers.has("content-type")).toBe(false);
    const body = await request.arrayBuffer();
    expect(body.byteLength).toBe(8_388_608);
    expect(Buffer.compare(Buffer.from(body), Buffer.from(bytes))).toBe(0);
    return Response.json({ caption: "Piano", bpm: 100 });
  });
  vi.stubGlobal("fetch", fetch);
  const analyzed = mount(selection);
  fireEvent.drop(screen.getByRole("button", { name: t("drop_aria") }), {
    dataTransfer: { files: [new File([bytes], "雨 & Piano.wav")] },
  });
  await waitFor(() => expect(analyzed).toHaveBeenCalledWith({ caption: "Piano", bpm: 100 }, false));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(invoke).not.toHaveBeenCalled();
});

it("rejects an oversized upload before reading the file or sending a request", async () => {
  const fetch = vi.fn();
  const arrayBuffer = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const file = new File([], "large.wav");
  Object.defineProperties(file, { size: { value: 60 * 1024 * 1024 + 1 }, arrayBuffer: { value: arrayBuffer } });
  await expect(backend.analyze(file)).rejects.toThrow("audio_size");
  expect(arrayBuffer).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
