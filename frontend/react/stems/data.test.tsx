// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useStemCatalog } from "./data";

const ipc = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: ipc.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: ipc.listen }));
afterEach(cleanup);

function TransferStatus() {
  const catalog = useStemCatalog();
  return <output>{catalog.data?.models[0].status ?? "loading"}</output>;
}

it("refreshes when a transfer finishes during the first catalog request", async () => {
  let onChange!: () => void;
  ipc.listen.mockImplementation(async (_name, callback) => { onChange = callback; return () => {}; });
  let finishStale!: (value: unknown) => void;
  ipc.invoke.mockImplementationOnce(() => new Promise(resolve => { finishStale = resolve; }))
    .mockResolvedValue({ models: [{ status: "ready" }] });
  render(<QueryClientProvider client={new QueryClient()}><TransferStatus/></QueryClientProvider>);
  await waitFor(() => expect(ipc.invoke).toHaveBeenCalledOnce());
  act(() => onChange());
  await act(async () => finishStale({ models: [{ status: "installing" }] }));
  expect(await screen.findByText("ready")).toBeTruthy();
  expect(ipc.invoke).toHaveBeenCalledTimes(2);
});
