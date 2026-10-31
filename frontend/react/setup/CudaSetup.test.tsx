// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { createAppQueryClient } from "../data";
import { EventBridge } from "../events";
import { SetupScreen } from "./SetupScreen";
import { setupFixture } from "./fixtures";
import { setLang } from "../../i18n.js";
import type { CudaStatus } from "../../types";
const mocks=vi.hoisted(()=>({invoke:vi.fn(),listen:vi.fn(),openUrl:vi.fn()}));
vi.mock("@tauri-apps/api/core",()=>({invoke:mocks.invoke,convertFileSrc:(path:string)=>path}));
vi.mock("@tauri-apps/api/event",()=>({listen:mocks.listen}));
vi.mock("@tauri-apps/plugin-opener",()=>({openUrl:mocks.openUrl}));
const hardware={...setupFixture.hardware,platform:"windows",gpu:"NVIDIA RTX 4060",cpu_only:false,cuda:{minimum_compute_capability:"7.5",architecture_supported:true}};
const status=(state:CudaStatus["state"],details:string|null=null):CudaStatus=>({state,details,download_bytes:402682743});
const handlers=new Map<string,(event:{payload:unknown})=>void>();
let current=status("runtime_missing");
beforeEach(()=>{
  vi.resetAllMocks();handlers.clear();setLang("de");current=status("runtime_missing");
  mocks.listen.mockImplementation(async(name,handler)=>{handlers.set(name,handler);return()=>{handlers.delete(name);};});
  mocks.invoke.mockImplementation(async(name,args)=>{
    if(name==="cuda_status")return current;
    if(name==="install_cuda_runtime"){current=status("ready");return current;}
    if(name==="setup_estimate")return {missing_bytes:0,free_bytes:1e12};
    if(name==="generation_policy")return {backend:current.state==="ready"?"gpu":"cpu"};
  });
});
afterEach(cleanup);
function mount(hw=hardware){
  const client=createAppQueryClient();
  const view=render(<QueryClientProvider client={client}><I18nProvider><EventBridge><SetupScreen bootstrap={{...setupFixture,hardware:hw}} onComplete={()=>{}}/></EventBridge></I18nProvider></QueryClientProvider>);
  return {client,...view};
}
it.each(["macos","linux"])("does not query CUDA or offer downloads on %s",async platform=>{
  mount({...hardware,platform});await screen.findByRole("button",{name:"Modelle laden und testen"});
  expect(mocks.invoke).not.toHaveBeenCalledWith("cuda_status",undefined);
  expect(document.querySelector("#cudaSetup")).toBeNull();
});
it.each([{...hardware,gpu:"AMD Radeon"},{...hardware,cuda:{...hardware.cuda,architecture_supported:false}}])("hides unsupported hardware %j",async hw=>{
  mount(hw);await screen.findByRole("button",{name:"Modelle laden und testen"});
  expect(mocks.invoke).not.toHaveBeenCalledWith("cuda_status",undefined);
  expect(document.querySelector("#cudaSetup")).toBeNull();
});
it.each(["driver_error","cuda_failed","ready","unsupported_build","check_failed","unsupported_gpu","not_applicable"] as const)("renders %s without offering installation",async state=>{
  current=status(state,"<img src=x onerror=alert(1)>");mount();
  await screen.findByText("<img src=x onerror=alert(1)>");
  expect(screen.queryByRole("button",{name:"CUDA-Unterstützung herunterladen"})).toBeNull();
  expect(document.querySelector("#cudaSetup img")).toBeNull();
  expect(Boolean(screen.queryByRole("button",{name:"NVIDIA-Treiber herunterladen"}))).toBe(["driver_error","cuda_failed"].includes(state));
});
it("downloads only on request, blocks competing setup and refreshes policy after installation",async()=>{
  let finish!:(value:CudaStatus)=>void;
  const original=mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((name,args)=>name==="install_cuda_runtime"?new Promise(resolve=>{finish=resolve;}):original(name,args));
  const {client}=mount();
  client.setQueryData(["generation-policy", {synthesis:"other.gguf"}], {backend:"cpu"});
  const download=await screen.findByRole("button",{name:"CUDA-Unterstützung herunterladen"});
  expect(screen.getByText(/0,4 GiB/)).toBeTruthy();
  expect(mocks.invoke.mock.calls.filter(([name])=>name==="install_cuda_runtime")).toHaveLength(0);
  fireEvent.click(download);fireEvent.click(download);fireEvent.click(screen.getByRole("button",{name:"Erneut prüfen"}));
  await waitFor(()=>expect(finish).toBeTypeOf("function"));
  expect(mocks.invoke.mock.calls.filter(([name])=>name==="install_cuda_runtime")).toHaveLength(1);
  await waitFor(()=>expect((screen.getByRole("button",{name:"Modelle laden und testen"}) as HTMLButtonElement).disabled).toBe(true));
  expect(client.isMutating({mutationKey:["setup"]})).toBe(1);
  fireEvent.submit(document.querySelector("#setupForm")!);
  expect(mocks.invoke.mock.calls.filter(([name])=>name==="setup_models")).toHaveLength(0);
  act(()=>handlers.get("cuda-progress")!({payload:{phase:"downloading",file:"cublas.dll",downloaded:50,total:100}}));
  await waitFor(()=>expect((document.querySelector("#setupProgress") as HTMLProgressElement).value).toBe(0.5));
  expect(document.querySelector("#setupProgressText")!.textContent).toContain("cublas.dll");
  act(()=>handlers.get("cuda-stage")!({payload:"installing"}));
  await waitFor(()=>expect(document.querySelector("#setupProgressText")!.textContent).toContain("entpackt"));
  current=status("ready");await act(async()=>finish(current));
  await screen.findByText(/CUDA ist verfügbar/);
  await waitFor(()=>expect(client.isMutating({mutationKey:["setup"]})).toBe(0));
  expect(mocks.invoke).toHaveBeenCalledWith("generation_policy",{selection:null,refresh:true});
  expect(screen.queryByText(/Klangerzeugung läuft auf der CPU/)).toBeNull();
  expect(client.getQueryState(["generation-policy", {synthesis:"other.gguf"}])?.isInvalidated).toBe(true);
});
it("cancels through the shared backend command, retains retry and translates the cancellation",async()=>{
  let reject!:(error:unknown)=>void;
  const original=mocks.invoke.getMockImplementation()!;
  mocks.invoke.mockImplementation((name,args)=>{
    if(name==="install_cuda_runtime")return new Promise((_,fail)=>{reject=fail;});
    if(name==="cancel_setup"){reject("Operation cancelled");return Promise.resolve();}
    return original(name,args);
  });
  mount();fireEvent.click(await screen.findByRole("button",{name:"CUDA-Unterstützung herunterladen"}));
  fireEvent.click(await screen.findByRole("button",{name:"Abbrechen"}));
  await screen.findByText(/CUDA-Download abgebrochen/);
  fireEvent.change(screen.getByRole("combobox",{name:"Sprache"}),{target:{value:"en"}});
  expect(screen.getByText(/CUDA download cancelled/)).toBeTruthy();
  expect((screen.getByRole("button",{name:"Download CUDA support"}) as HTMLButtonElement).disabled).toBe(false);
});
it("keeps diagnostics as text after failure and permits a retry",async()=>{
  const original=mocks.invoke.getMockImplementation()!;let attempts=0;
  mocks.invoke.mockImplementation((name,args)=>name==="install_cuda_runtime"&&attempts++===0?Promise.reject("Checksum mismatch"):original(name,args));
  mount();fireEvent.click(await screen.findByRole("button",{name:"CUDA-Unterstützung herunterladen"}));
  await screen.findByText(/Installation ist fehlgeschlagen/);
  expect(screen.getByText(/Checksum mismatch/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"CUDA-Unterstützung herunterladen"}));
  await screen.findByText(/CUDA ist verfügbar/);
});
it("opens NVIDIA driver help through the native opener",async()=>{
  current=status("driver_error");mocks.openUrl.mockResolvedValue(undefined);mount();
  fireEvent.click(await screen.findByRole("button",{name:"NVIDIA-Treiber herunterladen"}));
  expect(mocks.openUrl).toHaveBeenCalledWith("https://www.nvidia.com/Download/index.aspx");
});
it("cleans CUDA event subscriptions on unmount",async()=>{
  const view=mount();await screen.findByRole("button",{name:"CUDA-Unterstützung herunterladen"});
  expect(handlers.has("cuda-progress")).toBe(true);expect(handlers.has("cuda-stage")).toBe(true);
  view.unmount();expect(handlers.size).toBe(0);
});
