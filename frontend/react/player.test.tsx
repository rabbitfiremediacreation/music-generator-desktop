// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PlayerProvider, Player, usePlayer } from "./player";
import { I18nProvider } from "./i18n";
import type { Song } from "../types";
const ipc = vi.hoisted(() => ({ songAudio: vi.fn() }));
vi.mock("../backend", () => ({ backend: ipc }));
const engine = { loadBlob: vi.fn(), play: vi.fn(), pause: vi.fn(), playPause: vi.fn(), destroy: vi.fn(), on: vi.fn(), setVolume: vi.fn(), getDuration: vi.fn(), getCurrentTime: vi.fn() };
const handlers = new Map<string,(error?: Error)=>void>();
const song = (id: string) => ({id,title:id,url:`asset:${id}`,caption:id,seed:1} as Song);
function Choices() { const player = usePlayer(); return <><button onClick={() => player.play(song("first"))}>first</button><button onClick={() => player.play(song("second"))}>second</button><button onClick={() => player.clear("first")}>delete first</button></>; }
beforeEach(() => {
  vi.resetAllMocks(); handlers.clear(); ipc.songAudio.mockResolvedValue(new Uint8Array([82,73,70,70]).buffer);engine.getDuration.mockReturnValue(10);engine.getCurrentTime.mockReturnValue(0);
  engine.loadBlob.mockResolvedValue(undefined); engine.on.mockImplementation((name,callback)=>{handlers.set(name,callback);return()=>{};});
  Object.assign(window, { WaveSurfer: {create: () => engine} });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});

it.each([[5.6,"0:05"],[29.8,"0:29"]])("uses the whole-second audio clock for %s seconds through playback completion",async(seconds,clock)=>{
  engine.getDuration.mockReturnValue(seconds);
  render(<I18nProvider><PlayerProvider><Choices/><Player/></PlayerProvider></I18nProvider>);
  fireEvent.click(screen.getByText("first"));
  await waitFor(()=>expect(engine.play).toHaveBeenCalledOnce());
  act(()=>handlers.get("ready")?.());
  expect(screen.getByText(`0:00 / ${clock}`)).toBeTruthy();
  engine.getCurrentTime.mockReturnValue(seconds);
  act(()=>{handlers.get("timeupdate")?.();handlers.get("finish")?.();});
  expect(screen.getByText(`${clock} / ${clock}`)).toBeTruthy();
});
afterEach(() => { cleanup();localStorage.clear(); vi.unstubAllGlobals(); });
it.each(["{}","42",'"bad"'])("tolerates corrupted saved player preferences %s",async(value)=>{
  localStorage.setItem("played",value);localStorage.setItem("volume",value);
  render(<I18nProvider><PlayerProvider><Choices/><Player/></PlayerProvider></I18nProvider>);
  fireEvent.click(screen.getByText("first"));
  await waitFor(()=>expect(engine.loadBlob).toHaveBeenCalled());
  expect((document.getElementById("volRange") as HTMLInputElement).value).toBe("100");
});
it("only plays the latest requested song and releases audio resources", async () => {
  let finish!: () => void;
  engine.loadBlob.mockImplementationOnce(() => new Promise<void>(resolve => {finish = resolve;}));
  const view = render(<I18nProvider><PlayerProvider><Choices /><Player /></PlayerProvider></I18nProvider>);
  fireEvent.click(screen.getByText("first"));
  await waitFor(() => expect(ipc.songAudio).toHaveBeenCalledWith("first"));
  await waitFor(() => expect(engine.loadBlob).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByText("second"));
  await waitFor(() => expect(ipc.songAudio).toHaveBeenCalledWith("second"));
  await waitFor(() => expect(engine.play).toHaveBeenCalledOnce());
  await act(async () => {finish();});
  expect(engine.play).toHaveBeenCalledOnce();
  expect(engine.pause).toHaveBeenCalled();
  view.unmount(); expect(engine.destroy).toHaveBeenCalledTimes(2);
});

it("clears a deleted song, cancels its pending load and releases the waveform",async()=>{
  let finish!:()=>void;
  engine.loadBlob.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));
  render(<I18nProvider><PlayerProvider><Choices/><Player/></PlayerProvider></I18nProvider>);
  fireEvent.click(screen.getByText("first"));
  await waitFor(()=>expect(ipc.songAudio).toHaveBeenCalledWith("first"));
  fireEvent.click(screen.getByText("delete first"));
  expect(document.querySelector<HTMLElement>("#player")!.hidden).toBe(true);
  expect(document.querySelector("#pTitle")!.textContent).toBe("");
  expect(engine.pause).toHaveBeenCalled();expect(engine.destroy).toHaveBeenCalledOnce();
  await act(async()=>finish());expect(engine.play).not.toHaveBeenCalled();
});
it("keeps the current song when a different song is deleted",async()=>{
  render(<I18nProvider><PlayerProvider><Choices/><Player/></PlayerProvider></I18nProvider>);
  fireEvent.click(screen.getByText("second"));
  await waitFor(()=>expect(engine.play).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByText("delete first"));
  expect(document.querySelector<HTMLElement>("#player")!.hidden).toBe(false);
  expect(document.querySelector("#pTitle")!.textContent).toBe("second");
  expect(engine.destroy).not.toHaveBeenCalled();
});

it("loads binary audio without depending on an asset URL", async () => {
  const bytes = new Uint8Array([0, 128, 255, 1]);
  ipc.songAudio.mockResolvedValue(bytes.buffer);
  render(<I18nProvider><PlayerProvider><Choices/><Player/></PlayerProvider></I18nProvider>);
  fireEvent.click(screen.getByText("first"));
  await waitFor(() => expect(engine.play).toHaveBeenCalledOnce());
  const blob = engine.loadBlob.mock.calls[0][0] as Blob;
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
  expect(ipc.songAudio).toHaveBeenCalledWith("first");
});

it("ignores audio reads that finish after another song is selected", async () => {
  let finish!: (bytes: ArrayBuffer) => void;
  ipc.songAudio.mockImplementationOnce(() => new Promise<ArrayBuffer>(resolve => {finish = resolve;}));
  render(<I18nProvider><PlayerProvider><Choices/><Player/></PlayerProvider></I18nProvider>);
  fireEvent.click(screen.getByText("first"));
  fireEvent.click(screen.getByText("second"));
  await waitFor(() => expect(engine.play).toHaveBeenCalledOnce());
  await act(async () => finish(new ArrayBuffer(4)));
  expect(engine.loadBlob).toHaveBeenCalledOnce();
  expect(engine.play).toHaveBeenCalledOnce();
});

it.each(["read", "decode", "play", "media"])("shows %s failures and retries the same song", async source => {
  if (source === "read") ipc.songAudio.mockRejectedValueOnce(new Error("Audio unavailable"));
  if (source === "decode") engine.loadBlob.mockRejectedValueOnce(new Error("Audio unavailable"));
  if (source === "play") engine.play.mockRejectedValueOnce(new Error("Audio unavailable"));
  let finish!: () => void;
  if (source === "media") engine.loadBlob.mockImplementationOnce(() => new Promise<void>(resolve => {finish = resolve;}));
  render(<I18nProvider><PlayerProvider><Choices/><Player/></PlayerProvider></I18nProvider>);
  fireEvent.click(screen.getByText("first"));
  if (source === "media") {
    await waitFor(() => expect(engine.loadBlob).toHaveBeenCalledOnce());
    act(() => {handlers.get("play")?.(); handlers.get("error")?.(new Error("Audio unavailable"));});
  }
  expect((await screen.findByRole("alert")).textContent).toContain("Audio unavailable");
  expect(document.querySelector("#playBtn")!.textContent).toBe("▶");
  expect(engine.pause).toHaveBeenCalled();
  fireEvent.click(document.querySelector("#playBtn")!);
  await waitFor(() => expect(ipc.songAudio).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(engine.play).toHaveBeenCalledTimes(source === "play" ? 2 : 1));
  expect(screen.queryByRole("alert")).toBeNull();
  if (source === "media") {
    await act(async () => finish());
    expect(engine.play).toHaveBeenCalledOnce();
  }
});

it("does not play an empty player while the selected song is still loading", async () => {
  ipc.songAudio.mockReturnValue(new Promise(() => {}));
  render(<I18nProvider><PlayerProvider><Choices/><Player/></PlayerProvider></I18nProvider>);
  fireEvent.click(screen.getByText("first"));
  fireEvent.click(document.querySelector("#playBtn")!);
  fireEvent.keyDown(document.body, {code: "Space"});
  expect(ipc.songAudio).toHaveBeenCalledOnce();
  expect(engine.playPause).not.toHaveBeenCalled();
  expect(engine.play).not.toHaveBeenCalled();
});

it("ignores an earlier song's error after a new song is selected", async () => {
  render(<I18nProvider><PlayerProvider><Choices/><Player/></PlayerProvider></I18nProvider>);
  fireEvent.click(screen.getByText("first"));
  await waitFor(() => expect(engine.play).toHaveBeenCalledOnce());
  const oldError = handlers.get("error")!;
  fireEvent.click(screen.getByText("second"));
  await waitFor(() => expect(engine.play).toHaveBeenCalledTimes(2));
  act(() => oldError(new Error("Stale failure")));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(document.querySelector("#pTitle")!.textContent).toBe("second");
});

it("retains volume when switching songs and retries after a toggle fails", async () => {
  engine.playPause.mockRejectedValueOnce(new Error("Playback unavailable"));
  render(<I18nProvider><PlayerProvider><Choices/><Player/></PlayerProvider></I18nProvider>);
  fireEvent.click(screen.getByText("first"));
  await waitFor(() => expect(engine.play).toHaveBeenCalledOnce());
  fireEvent.change(document.querySelector("#volRange")!, {target:{value:"25"}});
  fireEvent.click(screen.getByText("second"));
  await waitFor(() => expect(engine.play).toHaveBeenCalledTimes(2));
  expect(engine.setVolume).toHaveBeenLastCalledWith(.25);
  fireEvent.click(document.querySelector("#playBtn")!);
  expect((await screen.findByRole("alert")).textContent).toContain("Playback unavailable");
  fireEvent.click(document.querySelector("#playBtn")!);
  await waitFor(() => expect(ipc.songAudio).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(engine.play).toHaveBeenCalledTimes(3));
  expect(screen.queryByRole("alert")).toBeNull();
});
