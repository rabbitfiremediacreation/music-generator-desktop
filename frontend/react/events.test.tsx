// @vitest-environment happy-dom
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { createAppQueryClient } from "./data";
import { EventBridge } from "./events";

const mocks = vi.hoisted(() => ({ listen: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, convertFileSrc: (path: string) => path }));
const callbacks = new Map<string, (event: {payload: unknown}) => void>();
const stops: ReturnType<typeof vi.fn>[] = [];
beforeEach(() => {
  callbacks.clear(); stops.length = 0;
  mocks.listen.mockReset().mockImplementation(async (name, callback) => {
    callbacks.set(name, callback); const off = vi.fn(); stops.push(off); return off;
  });
});
afterEach(cleanup);

function Snapshot() {
  const songs = useQuery({ queryKey: ["songs", {}], queryFn: async () => (await mocks.invoke("list_songs")) as string[] });
  const progress = useQuery<Record<string, {sequence:number}>>({ queryKey: ["generation-progress"], queryFn: async () => ({}), enabled: false });
  return <><div>{songs.data?.join(",")}</div><output>{progress.data?.one?.sequence}</output></>;
}

it("registers before the snapshot and refreshes an event received during the initial read", async () => {
  let finish!: (value: string[]) => void;
  mocks.invoke.mockReset().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(["new song"]);
  const client = createAppQueryClient();
  render(<QueryClientProvider client={client}><EventBridge><Snapshot /></EventBridge></QueryClientProvider>);
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledOnce());
  expect(callbacks.has("library-changed")).toBe(true);
  act(() => { callbacks.get("library-changed")!({payload:null}); });
  await new Promise(resolve => setTimeout(resolve, 120));
  await act(async () => { finish(["old song"]); });
  await screen.findByText("new song");
});

it("ignores stale progress and cleans every subscription under StrictMode", async () => {
  mocks.invoke.mockResolvedValue([]);
  const client = createAppQueryClient();
  const view = render(<StrictMode><QueryClientProvider client={client}><EventBridge><Snapshot /></EventBridge></QueryClientProvider></StrictMode>);
  await waitFor(() => expect(callbacks.has("generation-progress")).toBe(true));
  await act(async () => {
    callbacks.get("generation-progress")!({payload:{job_id:"one",sequence:9}});
    callbacks.get("generation-progress")!({payload:{job_id:"one",sequence:2}});
  });
  await screen.findByText("9");
  view.unmount();
  await waitFor(() => expect(stops.every(off => off.mock.calls.length === 1)).toBe(true));
});
