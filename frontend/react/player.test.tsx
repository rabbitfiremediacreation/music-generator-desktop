// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PlayerProvider, Player, usePlayer } from "./player";
import { I18nProvider } from "./i18n";
import type { Song } from "../types";
const engine = { load: vi.fn(), play: vi.fn(), pause: vi.fn(), playPause: vi.fn(), destroy: vi.fn(), on: vi.fn(), setVolume: vi.fn(), getDuration: vi.fn(), getCurrentTime: vi.fn() };
const handlers = new Map<string,()=>void>();
const song = (id: string) => ({id,title:id,url:`asset:${id}`,caption:id,seed:1} as Song);
function Choices() { const player = usePlayer(); return <><button onClick={() => player.play(song("first"))}>first</button><button onClick={() => player.play(song("second"))}>second</button></>; }
beforeEach(() => {
  vi.resetAllMocks(); handlers.clear();engine.getDuration.mockReturnValue(10);engine.getCurrentTime.mockReturnValue(0);
  engine.load.mockResolvedValue(undefined); engine.on.mockImplementation((name,callback)=>{handlers.set(name,callback);return()=>{};});
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
  await waitFor(()=>expect(engine.load).toHaveBeenCalled());
  expect((document.getElementById("volRange") as HTMLInputElement).value).toBe("100");
});
it("only plays the latest requested song and releases audio resources", async () => {
  let finish!: () => void;
  engine.load.mockImplementationOnce(() => new Promise<void>(resolve => {finish = resolve;}));
  const view = render(<I18nProvider><PlayerProvider><Choices /><Player /></PlayerProvider></I18nProvider>);
  fireEvent.click(screen.getByText("first"));
  await waitFor(() => expect(engine.load).toHaveBeenCalledWith("asset:first"));
  fireEvent.click(screen.getByText("second"));
  await waitFor(() => expect(engine.load).toHaveBeenCalledWith("asset:second"));
  await waitFor(() => expect(engine.play).toHaveBeenCalledOnce());
  await act(async () => {finish();});
  expect(engine.play).toHaveBeenCalledOnce();
  expect(engine.pause).toHaveBeenCalled();
  view.unmount(); expect(engine.destroy).toHaveBeenCalledOnce();
});
