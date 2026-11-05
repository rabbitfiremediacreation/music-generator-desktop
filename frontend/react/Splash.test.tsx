// @vitest-environment happy-dom
import { afterEach,beforeEach,expect,it,vi } from "vitest";
import { act,cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { Splash } from "./Splash";
import { I18nProvider } from "./i18n";
import { setLang } from "../i18n.js";
import { LANGS } from "../locales";
import { startupText } from "../startup-text";
const mocks=vi.hoisted(()=>({invoke:vi.fn(),listen:vi.fn()}));
vi.mock("@tauri-apps/api/core",()=>({invoke:mocks.invoke}));
vi.mock("@tauri-apps/api/event",()=>({listen:mocks.listen}));
let update:(event:{payload:unknown})=>void;
beforeEach(()=>{
  mocks.invoke.mockReset().mockResolvedValue({attempt:1,sequence:0,phase:"starting",error:null});
  mocks.listen.mockReset().mockImplementation(async(_name,callback)=>{update=callback;return()=>{};});setLang("en");
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();});
it("keeps newer events over a delayed startup snapshot and releases pending listeners",async()=>{
  let resolve!:(value:unknown)=>void;const off=vi.fn();
  let snapshots=0;
  mocks.invoke.mockImplementation(name=>name==="startup_status"?(snapshots++===0?Promise.resolve({attempt:1,sequence:0,phase:"starting",error:null}):new Promise(done=>{resolve=done;})):Promise.resolve());
  mocks.listen.mockImplementation(async(_name,callback)=>{update=callback;return off;});
  const view=render(<I18nProvider><Splash/></I18nProvider>);
  await waitFor(()=>expect(resolve).toBeDefined());
  act(()=>update({payload:{attempt:1,sequence:7,phase:"hardware",error:null}}));
  await act(async()=>resolve({attempt:1,sequence:2,phase:"data",error:null}));
  expect(screen.getByRole("status").textContent).toBe("Detecting hardware…");
  view.unmount();expect(off).toHaveBeenCalledOnce();
});
it.each(Object.keys(LANGS) as (keyof typeof LANGS)[])("renders error and installation actions in %s",async language=>{
  setLang(language);render(<I18nProvider><Splash/></I18nProvider>);
  await waitFor(()=>expect(update).toBeTypeOf("function"));
  act(()=>update({payload:{attempt:1,sequence:5,phase:"error",error:"technical detail"}}));
  const text=startupText();
  expect(document.documentElement.lang).toBe(language);
  expect(screen.getByRole("alert").textContent).toBe(text.failure);
  expect(screen.getByText(text.details).closest("details")!.open).toBe(false);
  expect(screen.queryByRole("progressbar")).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:text.retry}));
  expect(mocks.invoke).toHaveBeenCalledWith("retry_startup",{attempt:1});
  act(()=>update({payload:{attempt:1,sequence:6,phase:"installation_required",error:null}}));
  expect(screen.getByText(text.installation_steps)).toBeTruthy();
  act(()=>update({payload:{attempt:1,sequence:99,phase:"ready",error:null}}));
  expect(screen.getByRole("status").textContent).toBe(text.installation_required);
});

it("ignores late readiness failures from an earlier attempt",async()=>{
  let rejectReady!:(error:unknown)=>void;
  mocks.invoke.mockImplementation(async name=>name==="startup_status"?{attempt:1,sequence:1,phase:"starting",error:null}:name==="splash_ready"?new Promise((_,reject)=>{rejectReady=reject;}):undefined);
  render(<I18nProvider><Splash/></I18nProvider>);
  await waitFor(()=>expect(rejectReady).toBeTypeOf("function"));
  act(()=>update({payload:{attempt:2,sequence:2,phase:"starting",error:null}}));
  await act(async()=>rejectReady("old failure"));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(mocks.invoke).not.toHaveBeenCalledWith("startup_error",{attempt:1,error:"old failure"});
});
it("preserves a replacement attempt when retry transport fails",async()=>{
  let rejectRetry!:(error:unknown)=>void;
  let status={attempt:1,sequence:1,phase:"error",error:"first failure" as string|null};
  mocks.invoke.mockImplementation(async name=>name==="startup_status"?status:name==="retry_startup"?new Promise((_,reject)=>{rejectRetry=reject;}):undefined);
  render(<I18nProvider><Splash/></I18nProvider>);
  fireEvent.click(await screen.findByRole("button",{name:"Try again"}));
  status={attempt:2,sequence:2,phase:"starting",error:null};
  await act(async()=>rejectRetry("old transport failure"));
  expect(screen.queryByRole("alert")).toBeNull();
});

it("acknowledges a connected splash after 500 ms without frames and records the fallback",async()=>{
  vi.useFakeTimers();vi.spyOn(window,"requestAnimationFrame").mockImplementation(()=>1);
  render(<I18nProvider><Splash/></I18nProvider>);
  await act(async()=>{await vi.advanceTimersByTimeAsync(499);});
  expect(mocks.invoke).not.toHaveBeenCalledWith("splash_ready",{attempt:1});
  await act(async()=>{await vi.advanceTimersByTimeAsync(1);});
  expect(mocks.invoke).toHaveBeenCalledWith("startup_splash_progress",{attempt:1,stage:"frame_timeout"});
  expect(mocks.invoke).toHaveBeenCalledWith("splash_ready",{attempt:1});
});
it("does not bypass a stalled event connection with the frame fallback",async()=>{
  vi.useFakeTimers();mocks.listen.mockImplementation(()=>new Promise(()=>{}));
  render(<I18nProvider><Splash/></I18nProvider>);
  await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});
  expect(mocks.invoke).toHaveBeenCalledWith("startup_splash_progress",{attempt:1,stage:"subscribing"});
  expect(mocks.invoke).not.toHaveBeenCalledWith("splash_ready",{attempt:1});
});
it("does not wait for diagnostic IPC before acknowledging frames",async()=>{
  vi.useFakeTimers();vi.spyOn(window,"requestAnimationFrame").mockImplementation(callback=>{callback(0);return 1;});
  mocks.invoke.mockImplementation(async name=>name==="startup_splash_progress"?new Promise(()=>{}):name==="startup_status"?{attempt:3,sequence:1,phase:"starting",error:null}:undefined);
  render(<I18nProvider><Splash/></I18nProvider>);
  await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
  expect(mocks.invoke).toHaveBeenCalledWith("splash_ready",{attempt:3});
});
it("contains diagnostic failures and suppresses a pending handshake after unmount",async()=>{
  vi.useFakeTimers();vi.spyOn(window,"requestAnimationFrame").mockImplementation(()=>1);
  mocks.invoke.mockImplementation(async name=>{if(name==="startup_splash_progress")throw new Error("diagnostics unavailable");if(name==="startup_status")return {attempt:1,sequence:1,phase:"starting",error:null};});
  const view=render(<I18nProvider><Splash/></I18nProvider>);
  await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
  expect(mocks.invoke).toHaveBeenCalledWith("startup_splash_progress",{attempt:1,stage:"waiting_for_frames"});
  view.unmount();await act(async()=>{await vi.advanceTimersByTimeAsync(500);});
  expect(mocks.invoke).not.toHaveBeenCalledWith("splash_ready",{attempt:1});
  expect(mocks.invoke).not.toHaveBeenCalledWith("startup_splash_progress",{attempt:1,stage:"frame_timeout"});
});
