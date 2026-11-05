// @vitest-environment happy-dom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { setLang } from "../../i18n.js";
import { GenerationAdmissionProvider, useGenerationAdmission } from "./admission";
import type { BackendStatus, Generation, GenerationPolicy, Health } from "../../types";

const ipc = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: ipc.invoke, convertFileSrc: (p: string) => p }));
const defaults = { duration: 90, bpm: 0, inference_steps: 30, lm_temperature: 1.2, variants: 2 };
let policy: GenerationPolicy, generated: Generation[], retried: string[];
const request: Generation = { prompt: "piano", inference_steps: 80, duration: 10, seed: 42, variants: 2, group_id: "old-group" };
beforeEach(() => {
  setLang("de"); generated = []; retried = [];
  policy = { backend: "cpu", cpu_iteration_behavior: "ask", recommended_steps: 30, defaults };
  ipc.invoke.mockImplementation(async (name: string, args: { request?: Generation; id?: string }) => {
    if (name === "generation_policy") return policy;
    if (name === "generate") { generated.push(args.request!); return { ids: ["new"] }; }
    if (name === "retry_song") { retried.push(args.id!); return { id: args.id }; }
    throw new Error(`Unexpected command: ${name}`);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function Harness({ values, retryId }: { values: Generation; retryId?: string }) {
  const admission = useGenerationAdmission(), [done, setDone] = useState(0);
  return <><button onClick={() => { void admission.start(values, retryId).then(() => setDone(value => value + 1)); }}>Start</button><span role="status">{done}</span></>;
}
function mount(values: Generation = request, retryId?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = (blocked = false) => <QueryClientProvider client={client}><I18nProvider><GenerationAdmissionProvider settingsBlocked={blocked}><Harness values={values} retryId={retryId} /></GenerationAdmissionProvider></I18nProvider></QueryClientProvider>;
  const rendered = render(view());
  return { ...rendered, client, block() { rendered.rerender(view(true)); } };
}
const start = () => fireEvent.click(screen.getByRole("button", { name: "Start" }));
const complete = () => waitFor(() => expect(screen.getByRole("status").textContent).toBe("1"));

it.each([["cpu",30,false],["cpu",31,true],["gpu",200,false],["unknown",31,true]] as const)("asks only above the CPU-safe threshold on %s with %s steps", async (device, steps, asks) => {
  policy = { ...policy, backend: device };
  mount({ ...request, inference_steps: steps }); start();
  if (asks) { await screen.findByRole("dialog"); fireEvent.click(screen.getByRole("button", { name: "Trotzdem starten" })); }
  await complete(); expect(generated[0].inference_steps).toBe(steps);
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("cancels cleanly and allows another admission", async () => {
  mount(); start(); await screen.findByRole("dialog");
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true, bubbles: false })); await complete(); expect(generated).toEqual([]);
  start(); await screen.findByRole("dialog");
  fireEvent.click(screen.getByRole("button", { name: "Mit 30 starten" }));
  await waitFor(() => expect(generated).toHaveLength(1)); expect(generated[0].inference_steps).toBe(30);
});
it.each(["cpu","unknown"] as const)("applies remembered limits on %s without changing source history", async device => {
  policy = { ...policy, backend: device, cpu_iteration_behavior: "limit_30" };
  const frozen = Object.freeze({ ...request }); mount(frozen, "old"); start(); await complete();
  expect(generated).toEqual([{ ...request, variants: 1, group_id: undefined, inference_steps: 30 }]); expect(retried).toEqual([]); expect(frozen.inference_steps).toBe(80);
});
it("retries the historical snapshot unchanged when no reduction is requested", async () => {
  policy = { ...policy, cpu_iteration_behavior: "continue" };
  mount(request, "old"); start(); await complete(); expect(retried).toEqual(["old"]); expect(generated).toEqual([]);
});
it("never applies remembered CPU limits to GPU synthesis", async () => {
  policy = { ...policy, backend: "gpu", cpu_iteration_behavior: "limit_30" };
  mount(); start(); await complete(); expect(generated).toEqual([request]);
});
it.each([[120,120],[200,200],[201,200]] as const)("preserves effective %s-step GPU sampling at %s", async (steps, expected) => {
  policy = { ...policy, backend: "gpu" };
  const values = Object.freeze({ ...request, inference_steps: steps }); mount(values); start(); await complete();
  expect(generated[0].inference_steps).toBe(expected); expect(values.inference_steps).toBe(steps);
});
it.each([["sft.gguf",50],["turbo.gguf",8]] as const)("resolves historical automatic steps for %s", async (synthesis, steps) => {
  policy = { ...policy, backend: "gpu" };
  mount({ ...request, inference_steps: 0, model_selection: { provider: "ace-step", synthesis, language: "lm" } }); start(); await complete(); expect(generated[0].inference_steps).toBe(steps);
});
it.each([[8,false],[50,true]] as const)("lets the backend's unprofiled %s-step retry determine the CPU check", async (steps, asks) => {
  policy = { ...policy, legacy_inference_steps: steps };
  mount({ ...request, inference_steps: 0 }, "old"); start();
  if (asks) { await screen.findByRole("dialog"); fireEvent.click(screen.getByRole("button", { name: "Trotzdem starten" })); }
  await complete(); expect(retried).toEqual(["old"]);
  expect(ipc.invoke.mock.calls.find(([command]) => command === "generation_policy")?.[1]).toMatchObject({ selection: null, refresh: true });
});
const observed = (device: BackendStatus["synthesis"]["backend"], state: BackendStatus["state"] = "running"): Health => ({ ok: true, backend_status: { state, synthesis: { state: state === "running" ? "confirmed" : "stopped", backend: device, device: null, reason: null }, language_model: { state: "confirmed", backend: "cpu", device: "CPU", reason: "cpu_requested" } } });
it.each(["metal","cuda","vulkan"] as const)("uses live confirmed %s synthesis independently from a CPU language model", async device => {
  policy = { ...policy, backend: "unknown" };
  const { client } = mount(); client.setQueryData(["health"], observed(device)); start(); await complete(); expect(generated).toEqual([request]);
});
it("freezes the request and rejects duplicate admissions throughout a hardware probe", async () => {
  let finish!: (value: GenerationPolicy) => void;
  ipc.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const mutable = { ...request }; mount(mutable); start(); start(); mutable.duration = 600;
  await act(async () => { finish({ ...policy, backend: "gpu" }); });
  await waitFor(() => expect(generated).toHaveLength(1)); expect(generated[0].duration).toBe(10);
});
it("does not admit after settings open during the hardware probe", async () => {
  let finish!: (value: GenerationPolicy) => void;
  ipc.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = mount(); start(); view.block();
  await act(async () => { finish({ ...policy, backend: "gpu" }); });
  await complete(); expect(generated).toEqual([]);
});
it.each([["metal","stopped","unknown",true],["metal","running","unknown",false],["cpu","running","gpu",true]] as const)("gives newer %s/%s evidence priority over a delayed %s policy", async (device, state, probed, asks) => {
  let finish!: (value: GenerationPolicy) => void;
  ipc.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { client } = mount(); client.setQueryData(["health"], observed("metal")); start();
  await act(async () => { client.setQueryData(["health"], observed(device, state)); finish({ ...policy, backend: "gpu", probed_backend: probed }); });
  if (asks) { await screen.findByRole("dialog"); fireEvent.click(screen.getByRole("button", { name: "Trotzdem starten" })); }
  await complete(); expect(generated).toEqual([request]);
});
it.each([["metal","cpu",true],["cpu","gpu",false]] as const)("lets a fresh %s to %s policy supersede older health evidence", async (previous, current, asks) => {
  policy = { ...policy, backend: current, probed_backend: "unknown" };
  const { client } = mount(); client.setQueryData(["health"], observed(previous)); start();
  if (asks) { await screen.findByRole("dialog"); fireEvent.click(screen.getByRole("button", { name: "Trotzdem starten" })); }
  await complete(); expect(generated).toEqual([request]);
});
it("disposes a pending confirmation when the application unmounts without admitting work", async () => {
  const view = mount(); start(); await screen.findByRole("dialog");
  view.unmount(); await act(async () => { await Promise.resolve(); });
  expect(generated).toEqual([]); expect(retried).toEqual([]);
});
it("does not treat retained GPU data from a failed health query as current execution evidence", async () => {
  policy = { ...policy, backend: "unknown" };
  const { client } = mount();
  client.setQueryData(["health"], observed("metal"));
  await client.fetchQuery({ queryKey: ["health"], queryFn: async () => { throw new Error("engine unavailable"); }, retry: false }).catch(() => {});
  start(); await screen.findByRole("dialog");
  expect(generated).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Mit 30 starten" }));
  await complete(); expect(generated[0].inference_steps).toBe(30);
});
