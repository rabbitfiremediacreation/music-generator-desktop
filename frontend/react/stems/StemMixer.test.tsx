// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setLang, t } from "../../i18n.js";
import { defaultMix, type MixVersion, type StemJob } from "../../stems";
import "../i18n";
import { StemMixer } from "./StemMixer";
import { StemExports } from "./StemExports";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, convertFileSrc: (path: string) => path }));
afterEach(cleanup);

const roles = ["drums", "bass", "other", "vocals", "guitar", "piano", "layer_1", "layer_2"];
const job: StemJob = {
  id: "console", status: "done", phase: "done", error: null, created_at: "", finished_at: "",
  project: { rate: 44100, channels: 2, frames: 44100, source_start_frame: 0, source_frames: 44100,
    roles, engine: "Demucs", engine_version: "4.0.1", backend: "cpu", original_peak: .5, track_peaks: [] },
  request: { source_id: "source", pin: { model: "htdemucs", repository: "test", revision: "rev" }, start: 0, end: null,
    name: "Console", quality: "standard", overlap: .25, outputs: roles, preview: false },
  source: { id: "source", song_id: null, name: "Console", hash: "hash", audio: { rate: 44100, channels: 2, frames: 44100, peaks: [] } },
};

function mount(versions: MixVersion[]) {
  invoke.mockReset();
  invoke.mockImplementation(async (name, args) => {
    if (name === "stem_mixes") return versions;
    if (name === "stem_exports") return [];
    if (name === "get_settings") return { export_formats: ["wav"] };
    if (name === "stem_save_mix") {
      const result = { id: "saved", name: args.name, mix: args.mix, updated_at: "" };
      versions.unshift(result);
      return result;
    }
    if (name === "stem_start_export") return "export";
  });
  render(<QueryClientProvider client={new QueryClient()}><StemMixer job={job} onBack={vi.fn()} onClose={vi.fn()} onNewSeparation={vi.fn()} /></QueryClientProvider>);
}

it("defaults both individual stem exports to the mixer region and checks package assets separately", async () => {
  setLang("en");
  invoke.mockReset().mockImplementation(async name => name === "get_settings" ? { export_formats: ["wav"] } : []);
  const mix = { ...defaultMix(job.project!), first: 500, end: 1200 };
  render(<QueryClientProvider client={new QueryClient()}>
    <StemExports job={job} mix={mix} selected={["vocals"]} controls={null} missing={{ original: new Error("stem_asset_missing") }} />
  </QueryClientProvider>);
  const tracks = screen.getByRole("button", { name: t("stem_export_tracks") });
  fireEvent.click(tracks);
  expect(screen.getByRole<HTMLInputElement>("checkbox", { name: t("stem_export_region") }).checked).toBe(true);
  fireEvent.click(screen.getAllByRole("button", { name: t("stem_export_tracks") }).at(-1)!);
  await waitFor(() => expect(tracks.getAttribute("aria-expanded")).toBe("false"));
  fireEvent.click(tracks);
  fireEvent.change(screen.getByLabelText(t("stem_selected")), { target: { value: "processed" } });
  fireEvent.click(screen.getAllByRole("button", { name: t("stem_export_tracks") }).at(-1)!);
  await waitFor(() => expect(tracks.getAttribute("aria-expanded")).toBe("false"));
  fireEvent.click(screen.getByRole("button", { name: t("stem_export_package") }));
  fireEvent.click(screen.getByRole("checkbox", { name: t("stem_export_original") }));
  fireEvent.click(screen.getAllByRole("button", { name: t("stem_export_package") }).at(-1)!);
  for (const kind of ["raw", "processed", "package"]) {
    expect(invoke).toHaveBeenCalledWith("stem_start_export", expect.objectContaining({
      request: expect.objectContaining({ kind, mix: expect.objectContaining({ first: 500, end: 1200 }), include_original: kind === "package" }),
    }));
  }
});

it("groups one drag into one undo, keeps legacy gain, and saves the processed track selection", async () => {
  setLang("en");
  mount([{ id: "legacy", name: "Legacy mix", updated_at: "", mix: {
    tracks: roles.map(role => ({ role, name: role, gain_db: role === "drums" ? 9 : 0, pan: 0, mute: false, solo: false, fade_in: 0, fade_out: 0 })),
    master_db: 0, first: 0, end: 44100, looping: false,
  } }]);
  const board = within(await screen.findByLabelText(t("stem_tracks_bank")));
  expect(board.getAllByRole("slider")).toHaveLength(72);
  const drums = within(board.getByRole("region", { name: /Drums/ }));
  expect(drums.getByRole("slider", { name: /Gain/ }).getAttribute("aria-valuetext")).toBe("+9.0 dB");
  const low = drums.getByRole("slider", { name: /LOW/ });
  fireEvent.pointerDown(low, { pointerId: 4, button: 0, clientY: 100 });
  fireEvent.pointerMove(low, { pointerId: 4, clientY: 85 });
  fireEvent.pointerMove(low, { pointerId: 4, clientY: 62 });
  fireEvent.pointerUp(low, { pointerId: 4, clientY: 62 });
  const changed = low.getAttribute("aria-valuenow");
  expect(Number(changed)).toBeGreaterThan(0);
  const undo = screen.getByRole("button", { name: t("stem_undo") });
  fireEvent.click(undo);
  expect(low.getAttribute("aria-valuenow")).toBe("0");
  expect((undo as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: t("stem_redo") }));
  expect(low.getAttribute("aria-valuenow")).toBe(changed);
  fireEvent.click(drums.getByRole("checkbox"));
  fireEvent.click(drums.getByRole("button", { name: /SOLO/ }));
  fireEvent.click(screen.getByRole("button", { name: t("save") }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("stem_save_mix", expect.objectContaining({
    name: "Legacy mix", mix: expect.objectContaining({
      version: 2, tracks: expect.arrayContaining([expect.objectContaining({ role: "drums", gain_db: 9, export: false, solo: true,
        fx: expect.objectContaining({ low_db: Number(changed) }) })]),
    }),
  })));
  fireEvent.click(screen.getByRole("button", { name: t("stem_export_mix") }));
  expect(screen.getByText(t("stem_export_solo"))).toBeTruthy();
  fireEvent.click(screen.getAllByRole("button", { name: t("stem_export_mix") }).at(-1)!);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("stem_start_export", expect.objectContaining({
    request: expect.objectContaining({ kind: "mix", mix: expect.objectContaining({ version: 2 }) }),
  })));
  const [, { request }] = invoke.mock.calls.find(([operation]) => operation === "stem_start_export")!;
  expect(request.selected).not.toContain("drums");
  expect(request.mix.tracks[0].solo).toBe(true);
});
