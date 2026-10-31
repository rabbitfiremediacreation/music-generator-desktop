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
afterEach(cleanup);
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
