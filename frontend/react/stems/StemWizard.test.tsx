// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setLang, t } from "../../i18n.js";
import "../i18n";
import { StemWizard } from "./StemWizard";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, convertFileSrc: (path: string) => path, Channel: class {} }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

afterEach(cleanup);

it("directs the user to Engines when the Demucs runtime is missing", async () => {
  setLang("en");
  invoke.mockReset();
  invoke.mockImplementation(async (name: string) => {
    if (name === "stem_models") return { engine_ready: false, platform_supported: true, models: [] };
    if (name === "list_folders") return { folders: [] };
  });
  const onOpenEngines = vi.fn();
  render(<QueryClientProvider client={new QueryClient()}>
    <StemWizard onQueued={vi.fn()} onPreview={vi.fn()} onOpenEngines={onOpenEngines} onOpenModels={vi.fn()} />
  </QueryClientProvider>);
  fireEvent.click(await screen.findByRole("button", { name: t("settings_page_engines") }));
  expect(onOpenEngines).toHaveBeenCalledOnce();
  expect(invoke).not.toHaveBeenCalledWith("stem_install_engine");
});

it("opens model settings when no installed model is ready", async () => {
  setLang("en");
  invoke.mockReset();
  invoke.mockImplementation(async (name: string) => {
    if (name === "stem_models") return { engine_ready: true, platform_supported: true, models: [{ status: "available" }] };
    if (name === "list_folders") return { folders: [] };
  });
  const onOpenModels = vi.fn();
  render(<QueryClientProvider client={new QueryClient()}>
    <StemWizard onQueued={vi.fn()} onPreview={vi.fn()} onOpenEngines={vi.fn()} onOpenModels={onOpenModels} />
  </QueryClientProvider>);
  fireEvent.click(await screen.findByRole("button", { name: t("settings_page_stems") }));
  expect(onOpenModels).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: t("stem_install") })).toBeNull();
});

it("queues independent imported sources with the confirmed revision and actual requested roles", async () => {
  setLang("en");
  const pin = { model: "htdemucs", repository: "adefossez/HTDemucs", revision: "1".repeat(40) };
  const artifact = { file: "model.safetensors", sha256: "f".repeat(64), bytes: 1024 };
  const profile = {
    id: "htdemucs", name: "HTDemucs", author: "Meta", repository: pin.repository, revision: pin.revision,
    roles: ["drums", "bass", "other", "vocals"], active: { ...pin, artifact }, installed: [],
    status: "ready", artifact, configuration: { ...artifact, file: "model.yaml" }, downloaded: 0,
  };
  const sources = ["First.wav", "Second.wav"].map((name, index) => ({
    id: `source-${index}`, song_id: null, name, hash: "b".repeat(64),
    audio: { rate: 48000, frames: 48000, channels: 2, peaks: [] },
  }));
  invoke.mockImplementation(async (command: string, args) => {
    switch (command) {
      case "stem_models": return { engine_ready: true, platform_supported: true, models: [profile] };
      case "stem_pick_sources": return sources.map(source => ({ name: source.name, source, error: null }));
      case "stem_source_audio": return "source.wav";
      case "stem_preflight": return { frames: 44100, bytes: 4 * 1024 ** 2, seconds: 1 };
      case "stem_start": return `job-${args.request.source_id}`;
      case "stem_job": return { id: args.id, status: "done", phase: "done" };
      case "list_folders": return { folders: [{ id: "demo", name: "Demos", count: 0 }] };
    }
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onQueued = vi.fn();
  render(<QueryClientProvider client={client}>
    <StemWizard onQueued={onQueued} onPreview={vi.fn()} onOpenEngines={vi.fn()} onOpenModels={vi.fn()} />
  </QueryClientProvider>);
  fireEvent.click(await screen.findByRole("button", { name: t("stem_import") }));
  await screen.findByText("First.wav");
  await screen.findByText("Second.wav");
  fireEvent.change(screen.getAllByLabelText(t("stem_range_start"))[0], { target: { value: "0.25" } });
  fireEvent.click(screen.getByRole("button", { name: t("stem_continue") }));
  fireEvent.change(screen.getByLabelText(t("stem_goal")), { target: { value: "vocal_pair" } });
  expect(screen.getByText(t("stem_derived"))).toBeTruthy();
  expect(screen.getByRole("checkbox", { name: t("stem_role_vocals") })).toBeTruthy();
  expect(screen.queryByRole("checkbox", { name: t("stem_role_piano") })).toBeNull();
  const preview = screen.getByText(t("stem_preview"), { selector: "summary" }).closest("details")!;
  preview.open = true;
  expect(within(preview).getByLabelText<HTMLInputElement>(t("stem_preview_position")).value).toBe("0.25");
  fireEvent.click(within(preview).getByRole("button", { name: t("stem_preview") }));
  await within(preview).findByRole("button", { name: t("stem_preview_result") });
  expect(invoke).toHaveBeenCalledWith("stem_start", {
    request: expect.objectContaining({ source_id: sources[0].id, start: 0.25, end: 1, preview: true }),
  });
  fireEvent.click(screen.getByRole("button", { name: t("stem_continue") }));
  fireEvent.change(screen.getByLabelText(t("stem_project_folder")), { target: { value: "demo" } });
  expect(await screen.findByText("8 MiB")).toBeTruthy();
  expect(screen.queryByRole("button", { name: t("stem_continue") })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: t("stem_start") }));
  await waitFor(() => expect(onQueued).toHaveBeenCalledWith(["job-source-0", "job-source-1"]));
  const enqueued = invoke.mock.calls.filter(([command, args]) => command === "stem_start" && !args.request.preview);
  expect(enqueued.map(([, { request }]) => request)).toEqual(sources.map(source => expect.objectContaining({
    source_id: source.id, pin: expect.objectContaining(pin), outputs: ["vocals", "instrumental"], preview: false, folder_id: "demo",
  })));
});
