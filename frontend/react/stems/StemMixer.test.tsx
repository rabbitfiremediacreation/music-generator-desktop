// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setLang, t } from "../../i18n.js";
import { defaultMix, type MixVersion, type StemJob, type StemGenerationProgress, type StemLayer } from "../../stems";
import "../i18n";
import { catalogFixture } from "../models/model-fixtures";
import { StemMixer } from "./StemMixer";
import { StemExports } from "./StemExports";
import { repairToolLabel, repairTools } from "./repair-tools";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  convertFileSrc: (path: string) => path,
  Channel: class { constructor(readonly onmessage: (message: unknown) => void) {} },
}));
afterEach(cleanup);

// Multi-step flows through the full mixer can exceed Vitest's default on macOS Intel CI.
const mixerFlowTimeout = 15_000;
const roles = ["drums", "bass", "other", "vocals", "guitar", "piano", "layer_1", "layer_2"];
const job: StemJob = {
  id: "console", status: "done", phase: "done", error: null, created_at: "", finished_at: "",
  project: { rate: 44100, channels: 2, frames: 44100, source_start_frame: 0, source_frames: 44100,
    roles, engine: "Demucs", engine_version: "4.0.1", backend: "cpu", original_peak: .5, track_peaks: [] },
  request: { source_id: "source", pin: { model: "htdemucs", repository: "test", revision: "rev" }, start: 0, end: null,
    name: "Console", quality: "standard", overlap: .25, outputs: roles, preview: false },
  source: { id: "source", song_id: null, name: "Console", hash: "hash", audio: { rate: 44100, channels: 2, frames: 44100, peaks: [] } },
};

const findings = [
  { first: 11025, end: 22050, low_hz: 4900, high_hz: 5100, reduction_db: 9 },
  { first: 30000, end: 41000, low_hz: 8100, high_hz: 8250, reduction_db: 9 },
  { first: 25 * 44100, end: 25 * 44100 + 11025, low_hz: 2900, high_hz: 3100, reduction_db: 9 },
];

function mount(versions: MixVersion[], currentJob = job) {
  invoke.mockReset();
  invoke.mockImplementation(async (name, args) => {
    if (name === "stem_mixes") return versions;
    if (name === "stem_exports") return [];
    if (name === "queue") return { running: [], queued: 0, active: false, progress: null, library: { count: 0, bytes: 0 } };
    if (name === "get_settings") return { export_formats: ["wav"] };
    if (name === "stem_save_mix") {
      const result = { id: "saved", name: args.name, mix: args.mix, updated_at: "" };
      versions.unshift(result);
      return result;
    }
    if (name === "stem_start_export") return "export";
    if (name === "stem_spectral_preview") return {
      width: 2, height: 2, levels: [0, 32, 96, 255], min_hz: 20, max_hz: 22050, bin_hz: 22,
    };
    if (name === "stem_spectral_scan") return findings;
    if (name === "stem_repair_spectrum") return { role: "layer_repaired", name: "Console" };
    if (name === "model_catalog") return catalogFixture;
    if (name === "stem_generate_track") return { role: "layer_generated", name: args.request.name };
  });
  const client = new QueryClient();
  const view = (project: StemJob) => <QueryClientProvider client={client}>
    <StemMixer key={project.id} job={project} onBack={vi.fn()} onClose={vi.fn()} onNewSeparation={vi.fn()} />
  </QueryClientProvider>;
  const { rerender } = render(view(currentJob));
  return (project: StemJob) => rerender(view(project));
}

function deferTrackGeneration() {
  const local = invoke.getMockImplementation()!;
  let report!: (progress: StemGenerationProgress) => void;
  let finish!: (layer: StemLayer) => void;
  let reject!: (reason: string) => void;
  invoke.mockImplementation(async (name, args) => {
    if (name !== "stem_generate_track") return local(name, args);
    report = args.progress.onmessage;
    return new Promise<StemLayer>((resolve, fail) => { finish = resolve; reject = fail; });
  });
  return {
    report: (progress: Omit<StemGenerationProgress, "job_id">) => act(() => report({ ...progress, job_id: "live-job" })),
    finish: () => act(async () => finish({ role: "layer_generated", name: "Generated track" })),
    fail: (reason: string) => act(async () => reject(reason)),
  };
}

async function startTrackGeneration() {
  const title = t("stem_layer_generate");
  fireEvent.click(await screen.findByRole("button", { name: title }));
  const dialog = within(await screen.findByRole("dialog", { name: title }));
  const submit = dialog.getByRole<HTMLButtonElement>("button", { name: title });
  await waitFor(() => expect(submit.disabled).toBe(false));
  fireEvent.click(submit);
  return dialog;
}

it("offers only Base models, adds the result to the mix and supports undo", async () => {
  setLang("en");
  mount([]);
  const title = t("stem_layer_generate");
  fireEvent.click(await screen.findByRole("button", { name: title }));
  const dialog = within(await screen.findByRole("dialog", { name: title }));
  const models = dialog.getByRole<HTMLSelectElement>("combobox", { name: t("picker_title") });
  await waitFor(() => expect(models.disabled).toBe(false));
  expect([...models.options].every(option => /acestep-v15-(xl-)?base-/.test(option.value))).toBe(true);
  const selection = [...models.options].find(option => option.value.includes("acestep-v15-xl-base-Q4_K_M"))!;
  fireEvent.change(models, { target: { value: selection.value } });
  fireEvent.change(dialog.getByLabelText(t("stem_layer_instrument")), { target: { value: "strings" } });
  fireEvent.change(dialog.getByLabelText(t("stem_layer_prompt")), { target: { value: "Quiet sustained notes" } });
  fireEvent.click(dialog.getByRole("button", { name: title }));
  await screen.findByRole("region", { name: /Strings/ });
  expect(invoke).toHaveBeenCalledWith("stem_generate_track", {
    id: job.id,
    request: {
      selection: expect.objectContaining({ provider: "ace-step", synthesis: "acestep-v15-xl-base-Q4_K_M.gguf" }),
      track: "strings", name: "Strings", prompt: "Quiet sustained notes", mix: defaultMix(job.project!),
    },
    progress: expect.anything(),
  });
  fireEvent.click(screen.getByRole("button", { name: t("stem_undo") }));
  expect(screen.queryByRole("region", { name: /Strings/ })).toBeNull();
});

it("keeps AI generation and progress running while the user edits the mixer", async () => {
  setLang("en");
  mount([]);
  const generation = deferTrackGeneration();
  const dialog = await startTrackGeneration();
  const bar = await dialog.findByRole("progressbar", { name: t("stem_layer_progress") });
  expect(bar.hasAttribute("value")).toBe(false);
  generation.report({ phase: "dit", step: 25, total_steps: 50, overall_percent: 48 });
  await waitFor(() => expect(bar.getAttribute("value")).toBe("48"));
  expect(dialog.getByText(/25\/50 · 48%/)).toBeTruthy();

  fireEvent.click(dialog.getByRole("button", { name: t("stem_layer_background") }));
  expect(screen.queryByRole("dialog", { name: t("stem_layer_generate") })).toBeNull();
  const mute = screen.getByRole("button", { name: "Drums · MUTE" });
  fireEvent.click(mute);
  expect(mute.getAttribute("aria-pressed")).toBe("true");
  generation.report({ phase: "saving", step: null, total_steps: null, overall_percent: 95 });
  await waitFor(() => expect(screen.getByRole("progressbar", { name: t("stem_layer_progress") }).getAttribute("value")).toBe("95"));

  await generation.finish();
  await screen.findByRole("region", { name: /Generated track/ });
  expect(screen.queryByRole("progressbar", { name: t("stem_layer_progress") })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: t("stem_undo") }));
  expect(screen.queryByRole("region", { name: /Generated track/ })).toBeNull();
  expect(mute.getAttribute("aria-pressed")).toBe("true");
});

it("adds a background result only to its original project after switching projects", async () => {
  setLang("en");
  const switchProject = mount([]);
  const generation = deferTrackGeneration();
  const dialog = await startTrackGeneration();
  fireEvent.click(await dialog.findByRole("button", { name: t("stem_layer_background") }));
  switchProject({ ...job, id: "other-console", request: { ...job.request, name: "Other Console" } });
  await screen.findByText("Other Console");
  await generation.finish();
  expect(screen.queryByRole("region", { name: /Generated track/ })).toBeNull();

  switchProject(job);
  const generated = await screen.findAllByRole("region", { name: /Generated track/ });
  expect(generated).toHaveLength(1);
});

it("cancels the matching background job from the mixer", async () => {
  setLang("en");
  mount([]);
  const generation = deferTrackGeneration();
  const dialog = await startTrackGeneration();
  fireEvent.click(await dialog.findByRole("button", { name: t("stem_layer_background") }));
  generation.report({ phase: "context", step: null, total_steps: null, overall_percent: 5 });
  const cancel = screen.getByRole<HTMLButtonElement>("button", { name: t("cancel") });
  await waitFor(() => expect(cancel.disabled).toBe(false));
  fireEvent.click(cancel);
  expect(invoke).toHaveBeenCalledWith("stem_cancel_track_generation", { id: "live-job" });
  await generation.fail("Operation cancelled");
  await screen.findByRole("button", { name: t("stem_layer_generate") });
  expect(screen.queryByRole("progressbar", { name: t("stem_layer_progress") })).toBeNull();
});

it("can prepare the smallest compatible Base model and use a verified language model while staying in the mixer", async () => {
  setLang("en");
  mount([]);
  const catalog = structuredClone(catalogFixture);
  const base = "acestep-v15-base-Q4_K_M.gguf";
  const language = catalog.models.find(model => model.role === "language" && model.file !== catalog.selection.language)!.file;
  for (const model of catalog.models) {
    if (model.family.endsWith("-base") || (model.role === "language" && model.file !== language)) {
      model.present = model.verified = false;
    }
  }
  const local = invoke.getMockImplementation()!;
  invoke.mockImplementation(async (name, args) => {
    if (name === "model_catalog") return structuredClone(catalog);
    if (name === "stem_prepare_track_model") {
      const model = catalog.models.find(model => model.file === base)!;
      model.present = model.verified = true;
      return;
    }
    return local(name, args);
  });
  const title = t("stem_layer_generate");
  fireEvent.click(await screen.findByRole("button", { name: title }));
  const dialog = within(await screen.findByRole("dialog", { name: title }));
  const submit = dialog.getByRole<HTMLButtonElement>("button", { name: title });
  expect(submit.disabled).toBe(true);
  const download = await dialog.findByRole("button", { name: /Download model.*Base.*Q4_K_M/ });
  fireEvent.click(download);
  await waitFor(() => expect(submit.disabled).toBe(false));
  expect(invoke).toHaveBeenCalledWith("stem_prepare_track_model", {
    selection: { provider: "ace-step", synthesis: base, language },
  });
  fireEvent.click(submit);
  expect(invoke).toHaveBeenCalledWith("stem_generate_track", expect.objectContaining({
    request: expect.objectContaining({ selection: { provider: "ace-step", synthesis: base, language } }),
  }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: title })).toBeNull());
});

it("deletes a separated track from the mixer and waveform lanes, then saves the edited track list", async () => {
  setLang("en");
  mount([]);
  const drums = await screen.findByRole("region", { name: /Drums/ });
  const lanes = within(screen.getByRole("list", { name: t("stem_waveform_lanes") }));
  function removeDrums() {
    const menu = screen.getByRole("region", { name: /Drums/ }).querySelector("details")!;
    menu.open = true;
    fireEvent.click(within(menu).getByRole("button", { name: t("stem_remove_track") }));
  }
  const button = (key: string) => screen.getByRole("button", { name: t(key) });
  removeDrums();
  expect(drums.isConnected).toBe(false);
  expect(lanes.queryByText(t("stem_role_drums"))).toBeNull();
  fireEvent.click(button("stem_undo"));
  expect(lanes.getByText(t("stem_role_drums"))).toBeTruthy();
  fireEvent.click(button("stem_redo"));
  expect(lanes.queryByText(t("stem_role_drums"))).toBeNull();

  const saveMenu = screen.getByText(t("stem_save_menu"), { selector: "summary" }).closest("details")!;
  saveMenu.open = true;
  fireEvent.click(within(saveMenu).getByRole("button", { name: t("save") }));
  const expected = defaultMix(job.project!);
  expected.tracks.shift();
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("stem_save_mix", expect.objectContaining({ mix: expected })));
});

it("saves the effect and channel strip settings for a return independently of its send", { timeout: mixerFlowTimeout }, async () => {
  setLang("en");
  mount([]);
  const drums = within(await screen.findByRole("region", { name: /Drums/ }));
  expect(drums.queryByRole("group", { name: t("stem_fx_sends") })).toBeNull();
  const switches = within(screen.getByRole("group", { name: t("stem_fx_returns") }));
  const power = switches.getByRole("button", { name: "FX 3" });
  const thirdReturn = `FX 3 · ${t("stem_fx_return")}`;
  expect(screen.queryByRole("region", { name: thirdReturn })).toBeNull();
  fireEvent.click(power);
  const sends = drums.getByRole("group", { name: t("stem_fx_sends") });
  expect(sends.previousElementSibling).toBe(drums.getByRole("slider", { name: "Drums · HIGH" }).closest(".mixer-tone"));
  expect(within(sends).getAllByRole("slider")).toHaveLength(1);
  fireEvent.keyDown(within(sends).getByRole("slider", { name: /Send FX 3/ }), { key: "End" });
  const fx = within(screen.getByRole("region", { name: thirdReturn }));
  expect(screen.getAllByRole("region", { name: /Effect return$/ })).toHaveLength(1);
  fireEvent.change(fx.getByRole("combobox"), { target: { value: "chorus" } });
  const rateKnob = fx.getByRole("slider", { name: /Rate/ });
  const highKnob = fx.getByRole("slider", { name: "FX 3 · HIGH" });
  const fader = fx.getByRole("slider", { name: `FX 3 · ${t("stem_gain")}` });
  expect(rateKnob.closest(".mixer-effect-controls")?.nextElementSibling).toBe(fader.closest(".mixer-master-level"));
  fireEvent.keyDown(rateKnob, { key: "End" });
  fireEvent.keyDown(fader, { key: "ArrowDown" });
  fireEvent.keyDown(highKnob, { key: "End" });
  fireEvent.keyDown(fx.getByRole("slider", { name: "FX 3 · FILTER" }), { key: "Home" });
  fireEvent.keyDown(fx.getByRole("slider", { name: "FX 3 · COMP MIX" }), { key: "End" });
  expect(fx.getByRole("meter", { name: "FX 3 · L dBFS" })).toBeTruthy();
  expect(fx.getByRole("meter", { name: "FX 3 · R dBFS" })).toBeTruthy();
  expect(fx.getByRole("meter", { name: `FX 3 · ${t("stem_gain_reduction")}` })).toBeTruthy();
  fireEvent.click(fx.getByRole("button", { name: "FX 3 · MUTE" }));
  const secondPower = switches.getByRole("button", { name: "FX 2" });
  fireEvent.click(secondPower);
  fireEvent.click(power);
  expect(power.getAttribute("aria-pressed")).toBe("false");
  expect(screen.queryByRole("region", { name: thirdReturn })).toBeNull();
  expect(within(sends).queryByRole("slider", { name: /Send FX 3/ })).toBeNull();
  expect(within(sends).getByRole("slider", { name: /Send FX 2/ })).toBeTruthy();
  expect(secondPower.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(power);
  expect(within(sends).getByRole("slider", { name: /Send FX 3/ }).getAttribute("aria-valuenow")).toBe("100");
  const restored = within(screen.getByRole("region", { name: thirdReturn }));
  expect(restored.getByRole<HTMLSelectElement>("combobox").value).toBe("chorus");
  expect(restored.getByRole("slider", { name: /Rate/ }).getAttribute("aria-valuenow")).toBe("5");
  expect(restored.getByRole("button", { name: "FX 3 · MUTE" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(power);
  const delay = within(screen.getByRole("region", { name: `FX 2 · ${t("stem_fx_return")}` }));
  const solo = delay.getByRole("button", { name: "FX 2 · SOLO" });
  fireEvent.click(solo);
  expect(screen.getByRole("region", { name: /Drums/ }).dataset.excluded).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: t("stem_clear_solos") }));
  expect(solo.getAttribute("aria-pressed")).toBe("false");
  expect(screen.getByRole("region", { name: /Drums/ }).dataset.excluded).toBe("false");

  const saveMenu = screen.getByText(t("stem_save_menu"), { selector: "summary" }).closest("details")!;
  saveMenu.open = true;
  fireEvent.click(within(saveMenu).getByRole("button", { name: t("save") }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("stem_save_mix", expect.objectContaining({
    mix: expect.objectContaining({
      tracks: expect.arrayContaining([expect.objectContaining({ role: "drums", sends: [0, 0, 100, 0] })]),
      fx_returns: expect.arrayContaining([expect.objectContaining({
        effect: { kind: "chorus", rate_hz: 5, depth_ms: 5, stereo: 75 }, gain_db: -.5, gain_off: false,
        enabled: false, mute: true,
        fx: expect.objectContaining({ high_db: 12, filter: -100, dynamics: expect.objectContaining({ mix: 100 }) }),
      })]),
    }),
  })));
});

it("activates returns with sends when opening a legacy mix without return settings", async () => {
  setLang("en");
  const mix = defaultMix(job.project!);
  delete mix.fx_returns;
  mix.tracks[0].sends = [0, 35, 0, 0];
  mount([{ id: "before-switches", name: "Previous mix", updated_at: "", mix }]);
  await screen.findByRole("region", { name: `FX 2 · ${t("stem_fx_return")}` });
  expect(screen.getAllByRole("region", { name: /Effect return$/ })).toHaveLength(1);
});

it("defaults both individual stem exports to the mixer region and checks package assets separately", async () => {
  setLang("en");
  invoke.mockReset().mockImplementation(async name => name === "get_settings" ? { export_formats: ["wav"] } : []);
  const mix = { ...defaultMix(job.project!), first: 500, end: 1200 };
  render(<QueryClientProvider client={new QueryClient()}>
    <StemExports job={job} mix={mix} selected={["vocals"]} missing={{ original: new Error("stem_asset_missing") }} />
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

it("marks results across the whole track and repairs a selected band as an undoable replacement", { timeout: mixerFlowTimeout }, async () => {
  setLang("en");
  mount([], { ...job, project: { ...job.project!, frames: 30 * 44100 } });
  const drums = await screen.findByRole("region", { name: /Drums/ });
  const menu = drums.querySelector("details")!;
  function openRepair() {
    menu.open = true;
    fireEvent.click(within(menu).getByRole("button", { name: t("stem_spectral_repair") }));
  }
  openRepair();
  const dialog = within(await screen.findByRole("dialog", { name: t("stem_spectral_repair") }));
  await dialog.findByRole("img", { name: t("stem_spectral_image") });
  expect(invoke).toHaveBeenCalledWith("stem_spectral_preview", { id: job.id, role: "drums", first: 0, end: 8 * 44100 });
  const apply = dialog.getByRole<HTMLButtonElement>("button", { name: t("stem_spectral_apply") });
  expect(apply.disabled).toBe(true);
  fireEvent.click(dialog.getByRole("button", { name: t("stem_spectral_auto") }));
  const results = await dialog.findByRole("combobox", { name: t("stem_spectral_finding") });
  expect(invoke).toHaveBeenCalledWith("stem_spectral_scan", { id: job.id, role: "drums" });
  expect(dialog.getByText(t("stem_spectral_findings", 3))).toBeTruthy();
  expect(results.closest("dialog")?.querySelectorAll(".spectral-overview-mark")).toHaveLength(3);
  expect(results.closest("dialog")?.querySelectorAll(".spectral-hit")).toHaveLength(2);
  fireEvent.change(results, { target: { value: "2" } });
  const lateStart = Math.round((findings[2].first + findings[2].end - 8 * 44100) / 2);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("stem_spectral_preview", {
    id: job.id, role: "drums", first: lateStart, end: lateStart + 8 * 44100,
  }));
  expect(dialog.getByLabelText<HTMLInputElement>(t("stem_spectral_low")).valueAsNumber).toBe(2900);
  expect(invoke).not.toHaveBeenCalledWith("stem_repair_spectrum", expect.anything());
  fireEvent.change(results, { target: { value: "0" } });
  expect(dialog.getByLabelText<HTMLInputElement>(t("stem_spectral_low")).valueAsNumber).toBe(4900);
  expect(dialog.getByLabelText<HTMLInputElement>(t("stem_spectral_reduction")).valueAsNumber).toBe(9);
  expect(apply.disabled).toBe(false);
  expect(invoke).not.toHaveBeenCalledWith("stem_repair_spectrum", expect.anything());
  for (const [label, value] of [
    ["stem_spectral_low", "500"], ["stem_spectral_high", "1200"], ["stem_spectral_reduction", "12"],
  ]) fireEvent.change(dialog.getByLabelText(t(label)), { target: { value } });
  fireEvent.click(apply);
  await waitFor(() => expect(screen.queryByRole("dialog", { name: t("stem_spectral_repair") })).toBeNull());
  expect(invoke).toHaveBeenCalledWith("stem_repair_spectrum", {
    id: job.id, role: "drums", selection: { first: 11025, end: 22050, low_hz: 500, high_hz: 1200, reduction_db: 12 },
  });
  openRepair();
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("stem_spectral_preview", {
    id: job.id, role: "layer_repaired", first: 0, end: 8 * 44100,
  }));
  fireEvent.click(screen.getByRole("button", { name: t("cancel") }));
  const undo = screen.getByRole<HTMLButtonElement>("button", { name: t("stem_undo") });
  expect(undo.disabled).toBe(false);
  fireEvent.click(undo);
  expect(undo.disabled).toBe(true);
  menu.open = true;
  expect(within(menu).queryByRole("button", { name: t("stem_restore_track") })).toBeNull();
});

it.each([
  ["de_click", { sensitivity: 50 }],
  ["de_crackle", { sensitivity: 50 }],
] as const)("applies %s to the visible window with its independent settings", async (kind, settings) => {
  setLang("en");
  mount([]);
  const drums = await screen.findByRole("region", { name: /Drums/ });
  const menu = drums.querySelector("details")!;
  menu.open = true;
  const actions = within(menu);
  for (const tool of repairTools) expect(actions.getByRole("button", { name: t(repairToolLabel(tool)) })).toBeTruthy();
  const title = t(repairToolLabel(kind));
  fireEvent.click(actions.getByRole("button", { name: title }));
  const dialog = within(await screen.findByRole("dialog", { name: title }));
  expect(dialog.getByRole<HTMLButtonElement>("button", { name: t("stem_spectral_audition") }).disabled).toBe(false);
  fireEvent.click(dialog.getByRole("button", { name: t("stem_spectral_apply") }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("stem_repair_spectrum", {
    id: job.id, role: "drums", selection: { first: 0, end: 44100, effect: { kind, ...settings } },
  }));
});

it("edits independent live EQ points and saves them with the mix without replacing the audio", async () => {
  setLang("en");
  mount([], { ...job, project: { ...job.project!, frames: 33 * 44100 } });
  const drums = await screen.findByRole("region", { name: /Drums/ });
  const menu = drums.querySelector("details")!;
  menu.open = true;
  const title = t("stem_repair_dynamic_eq");
  fireEvent.click(within(menu).getByRole("button", { name: title }));
  const dialog = within(await screen.findByRole("dialog", { name: title }));
  const graph = dialog.getByRole("region", { name: t("stem_repair_eq_graph") });
  expect(within(graph).queryByRole("button", { name: t("stem_repair_eq_point", 1) })).toBeNull();
  fireEvent.click(within(graph).getByRole("button", { name: t("stem_repair_eq_add") }));
  const point = within(graph).getByRole("button", { name: t("stem_repair_eq_point", 1) });
  const plot = point.parentElement!;
  vi.spyOn(plot, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1000, 240));

  fireEvent.pointerDown(point, { button: 0, pointerId: 1, clientX: 400, clientY: 80 });
  fireEvent.pointerMove(point, { pointerId: 1, clientX: 500, clientY: 121 });
  fireEvent.lostPointerCapture(point, { pointerId: 1 });
  fireEvent.wheel(point, { deltaY: -100 });
  fireEvent.keyDown(point, { key: "ArrowDown" });
  const frequency = () => dialog.getByRole<HTMLInputElement>("spinbutton", { name: t("stem_repair_frequency") });
  const cut = dialog.getByRole<HTMLInputElement>("spinbutton", { name: t("stem_repair_max_cut") });
  const q = dialog.getByRole<HTMLInputElement>("spinbutton", { name: t("stem_repair_q") });
  expect(frequency().valueAsNumber).toBe(4988);
  expect(cut.valueAsNumber).toBe(11.5);
  expect(q.valueAsNumber).toBe(1.7);
  const previousTop = point.style.top;
  fireEvent.change(cut, { target: { value: "9" } });
  expect(point.style.top).not.toBe(previousTop);

  fireEvent.doubleClick(plot, { clientX: 500, clientY: 21.6 });
  const second = within(graph).getByRole("button", { name: t("stem_repair_eq_point", 2) });
  expect(second.getAttribute("aria-pressed")).toBe("true");
  expect(frequency().valueAsNumber).toBe(632);
  fireEvent.change(dialog.getByRole("spinbutton", { name: t("stem_repair_threshold") }), { target: { value: "-34" } });
  fireEvent.click(within(graph).getByRole("button", { name: t("stem_repair_eq_add") }));
  const third = within(graph).getByRole("button", { name: t("stem_repair_eq_point", 3) });
  fireEvent.keyDown(third, { key: "Delete" });
  expect(within(graph).queryByRole("button", { name: t("stem_repair_eq_point", 3) })).toBeNull();
  fireEvent.click(point);
  expect(frequency().valueAsNumber).toBe(4988);
  expect(dialog.getByRole<HTMLInputElement>("spinbutton", { name: t("stem_repair_q") }).valueAsNumber).toBe(1.7);
  const bypass = dialog.getByRole("button", { name: t("stem_repair_eq_bypass") });
  fireEvent.click(bypass);
  expect(bypass.getAttribute("aria-pressed")).toBe("true");
  expect(dialog.queryByRole("button", { name: t("stem_spectral_apply") })).toBeNull();
  fireEvent.click(dialog.getByRole("button", { name: t("desktop_close") }));
  const saveMenu = screen.getByText("Save mix", { selector: "summary" }).closest("details")!;
  saveMenu.open = true;
  fireEvent.click(within(saveMenu).getByRole("button", { name: t("save") }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("stem_save_mix", expect.objectContaining({
    mix: expect.objectContaining({ tracks: expect.arrayContaining([expect.objectContaining({
      role: "drums", dynamic_eq: { bypass: true, bands: [
        { frequency_hz: 4988, reduction_db: 9, q: 1.7, threshold_db: -24 },
        { frequency_hz: 632, reduction_db: 6, q: 1.5, threshold_db: -34 },
      ] },
    })]) }),
  })));
  expect(invoke).not.toHaveBeenCalledWith("stem_repair_spectrum", expect.anything());
});

it("groups one drag into one undo, keeps legacy gain, and saves the processed track selection", { timeout: mixerFlowTimeout }, async () => {
  setLang("en");
  mount([{ id: "legacy", name: "Legacy mix", updated_at: "", mix: {
    tracks: roles.map(role => ({ role, name: role, gain_db: role === "drums" ? 9 : 0, pan: 0, mute: false, solo: false, fade_in: 0, fade_out: 0 })),
    master_db: 0, master_dynamics: { optical: true }, first: 0, end: 44100, looping: false,
  } }]);
  const board = within(await screen.findByLabelText(t("stem_tracks_bank")));
  const titlebar = within(screen.getByRole("heading", { name: "Stem-Mixer" }).closest("header")!);
  const compare = within(titlebar.getByRole("group", { name: t("stem_comparing") }));
  expect(compare.getByRole("button", { name: t("stem_original") })).toBeTruthy();
  expect(compare.getByRole("button", { name: t("stem_mix") })).toBeTruthy();
  const lanes = within(screen.getByRole("list", { name: t("stem_waveform_lanes") })).getAllByRole("listitem");
  expect(lanes).toHaveLength(roles.length + 1);
  expect(lanes.slice(0, 3).map(lane => lane.textContent)).toEqual(["Original", "Drums", "Bass"]);
  expect(board.getAllByRole("slider", { name: / · COMP MIX$/ })).toHaveLength(8);
  const drums = within(board.getByRole("region", { name: /Drums/ }));
  expect(drums.getAllByRole("slider", { name: / · (HIGH|MID|LOW)$/ })
    .map(slider => slider.getAttribute("aria-label")?.split(" · ").at(-1))).toEqual(["HIGH", "MID", "LOW"]);
  const fader = drums.getByRole("slider", { name: /Gain/ });
  expect(fader.getAttribute("aria-valuetext")).toBe("+9.0 dB");
  const balance = drums.getByRole("slider", { name: "Drums · BALANCE" });
  const toggles = drums.getByRole("button", { name: "Drums · MUTE" }).closest(".mixer-toggles");
  expect(balance.closest(".mixer-level")).toBe(fader.closest(".mixer-level"));
  expect(balance.closest(".mixer-balance")?.previousElementSibling).toBe(toggles);
  expect(toggles?.contains(drums.getByRole("button", { name: "Drums · SOLO" }))).toBe(true);
  const low = drums.getByRole("slider", { name: /LOW/ });
  fireEvent.pointerDown(low, { pointerId: 4, button: 0, clientY: 100 });
  fireEvent.pointerMove(low, { pointerId: 4, clientY: 85 });
  fireEvent.pointerMove(low, { pointerId: 4, clientY: 62 });
  fireEvent.pointerUp(low, { pointerId: 4, clientY: 62 });
  const changed = low.getAttribute("aria-valuenow");
  expect(Number(changed)).toBeGreaterThan(0);
  const undo = titlebar.getByRole("button", { name: t("stem_undo") });
  fireEvent.click(undo);
  expect(low.getAttribute("aria-valuenow")).toBe("0");
  expect((undo as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(titlebar.getByRole("button", { name: t("stem_redo") }));
  expect(low.getAttribute("aria-valuenow")).toBe(changed);
  const ratio = drums.getByRole<HTMLButtonElement>("slider", { name: "Drums · Ratio" });
  fireEvent.keyDown(ratio, { key: "ArrowLeft" });
  expect(ratio.getAttribute("aria-valuetext")).toBe("1.5:1");
  fireEvent.keyDown(ratio, { key: "ArrowLeft" });
  expect(ratio.getAttribute("aria-valuetext")).toBe("1.2:1");
  fireEvent.keyDown(ratio, { key: "ArrowRight" });
  const limiter = drums.getByRole("button", { name: "Drums · Limiter" });
  fireEvent.click(limiter);
  const optical = drums.getByRole("button", { name: "Drums · Optical" });
  fireEvent.click(optical);
  expect(optical.getAttribute("aria-pressed")).toBe("true");
  expect(limiter.getAttribute("aria-pressed")).toBe("true");
  expect(ratio.getAttribute("aria-valuetext")).toBe("1.5:1");
  fireEvent.keyDown(ratio, { key: "ArrowRight" });
  expect(ratio.getAttribute("aria-valuetext")).toBe("2:1");
  fireEvent.keyDown(ratio, { key: "ArrowLeft" });
  fireEvent.click(limiter);
  expect(ratio.getAttribute("aria-valuetext")).toBe("1.5:1");
  const fet = drums.getByRole("button", { name: "Drums · FET" });
  fireEvent.click(fet);
  expect(fet.getAttribute("aria-pressed")).toBe("true");
  expect(optical.getAttribute("aria-pressed")).toBe("false");
  expect(ratio.getAttribute("aria-valuetext")).toBe("4:1");
  fireEvent.keyDown(ratio, { key: "ArrowRight" });
  expect(ratio.getAttribute("aria-valuetext")).toBe("8:1");
  fireEvent.keyDown(drums.getByRole("slider", { name: "Drums · ATTACK" }), { key: "End" });
  expect(drums.getByRole("slider", { name: "Drums · ATTACK" }).getAttribute("aria-valuetext")).toBe("800 µs");
  fireEvent.click(optical);
  expect(fet.getAttribute("aria-pressed")).toBe("false");
  expect(ratio.getAttribute("aria-valuetext")).toBe("1.5:1");
  expect(drums.getByRole("slider", { name: "Drums · ATTACK" }).getAttribute("aria-valuetext")).toBe("10 ms");
  expect(screen.getByRole("button", { name: "MASTER · Optical" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(limiter);
  expect(drums.getByRole("meter", { name: "Drums · Gain reduction" })).toBeTruthy();
  for (const name of ["Drums", "MASTER"]) {
    const panel = screen.getByRole("group", { name: `${name} · Dynamics` });
    const dynamics = within(panel);
    expect(panel.parentElement?.firstElementChild).toBe(panel);
    expect(panel.parentElement?.nextElementSibling?.contains(screen.getByRole("slider", { name: new RegExp(`^${name} · Gain`) }))).toBe(true);
    const switches = dynamics.getByRole("button", { name: `${name} · Limiter` }).parentElement;
    expect(switches).toBe(dynamics.getByRole("button", { name: `${name} · Auto Gain` }).parentElement);
    const modes = dynamics.getByRole("button", { name: `${name} · Optical` }).parentElement;
    expect(modes).toBe(dynamics.getByRole("button", { name: `${name} · FET` }).parentElement);
    expect(modes).toBe(dynamics.getByRole("button", { name: `${name} · VCA` }).parentElement);
    expect(switches?.previousElementSibling?.contains(dynamics.getByRole("slider", { name: `${name} · COMP MIX` }))).toBe(true);
    for (const control of ["ATTACK", "RELEASE", "MAKEUP", "KNEE", "Threshold", "Ratio", "COMP MIX"]) {
      expect(dynamics.getByRole("slider", { name: `${name} · ${control}` }).closest("details")).toBeNull();
    }
  }
  const trackMeter = drums.getByRole("meter", { name: "Drums · L dBFS" });
  const masterMeter = screen.getByRole("meter", { name: `${t("stem_master_meter")} · R dBFS` });
  expect(trackMeter.getAttribute("aria-description")).toBe("Compressor threshold · -18.0 dBFS");
  expect(trackMeter.closest<HTMLElement>(".mixer-stereo-meter")?.style.getPropertyValue("--threshold")).toBe("0.7");
  fireEvent.keyDown(drums.getByRole("slider", { name: "Drums · Threshold" }), { key: "Home" });
  expect(trackMeter.getAttribute("aria-description")).toBe("Compressor threshold · -60.0 dBFS");
  expect(trackMeter.closest<HTMLElement>(".mixer-stereo-meter")?.style.getPropertyValue("--threshold")).toBe("0");
  fireEvent.keyDown(screen.getByRole("slider", { name: "MASTER · Threshold" }), { key: "End" });
  expect(masterMeter.getAttribute("aria-description")).toBe("Compressor threshold · 0.0 dBFS");
  expect(masterMeter.closest<HTMLElement>(".mixer-stereo-meter")?.style.getPropertyValue("--threshold")).toBe("1");
  fireEvent.keyDown(drums.getByRole("slider", { name: "Drums · COMP MIX" }), { key: "End" });
  fireEvent.keyDown(drums.getByRole("slider", { name: "Drums · ATTACK" }), { key: "End" });
  const deEss = drums.getByRole("slider", { name: "Drums · DE-ESS" });
  expect(deEss.getAttribute("aria-valuetext")).toBe("0 %");
  fireEvent.keyDown(deEss, { key: "End" });
  expect(deEss.getAttribute("aria-valuetext")).toBe("100 %");
  fireEvent.click(drums.getByRole("checkbox"));
  fireEvent.click(drums.getByRole("button", { name: /SOLO/ }));
  const saveMenu = titlebar.getByText("Save mix", { selector: "summary" }).closest("details")!;
  saveMenu.open = true;
  fireEvent.click(within(saveMenu).getByRole("button", { name: t("save") }));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("stem_save_mix", expect.objectContaining({
    name: "Legacy mix", mix: expect.objectContaining({
      version: 2, tracks: expect.arrayContaining([expect.objectContaining({ role: "drums", gain_db: 9, export: false, solo: true,
        fx: expect.objectContaining({ low_db: Number(changed), de_ess: 100,
          dynamics: { brickwall: true, ratio: 1.5, mix: 100, threshold_db: -60, attack_ms: 200, mode: "optical",
            fet_attack_us: 800, fet_ratio: 8 } }) })]),
    }),
  })));
  saveMenu.open = false;
  const exportMenu = titlebar.getByText("Export", { selector: "summary" }).closest("details")!;
  exportMenu.open = true;
  fireEvent.click(within(exportMenu).getByRole("button", { name: t("stem_export_mix") }));
  expect(screen.getByText(t("stem_export_solo"))).toBeTruthy();
  fireEvent.click(screen.getAllByRole("button", { name: t("stem_export_mix") }).at(-1)!);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("stem_start_export", expect.objectContaining({
    request: expect.objectContaining({ kind: "mix", mix: expect.objectContaining({ version: 2 }) }),
  })));
  const [, { request }] = invoke.mock.calls.find(([operation]) => operation === "stem_start_export")!;
  expect(request.selected).not.toContain("drums");
  expect(request.mix.tracks[0].solo).toBe(true);
  fireEvent.click(titlebar.getByRole("button", { name: t("stem_reset_mix") }));
  expect(fader.getAttribute("aria-valuetext")).toBe("0.0 dB");
});

it("links the VCA makeup readout to threshold and ratio and restores the manual setting", async () => {
  setLang("en");
  const mix = defaultMix(job.project!);
  mix.master_dynamics = { threshold_db: -24, makeup_db: -2 };
  mount([{ id: "vca", name: "VCA mix", mix, updated_at: "" }]);
  const master = within(await screen.findByRole("group", { name: "MASTER · Dynamics" }));
  fireEvent.click(master.getByRole("button", { name: "MASTER · VCA" }));
  const attack = master.getByRole("slider", { name: "MASTER · ATTACK" });
  const release = master.getByRole("slider", { name: "MASTER · RELEASE" });
  expect(attack.getAttribute("aria-valuetext")).toBe("10 ms");
  expect(release.getAttribute("aria-valuetext")).toBe("AUTO");
  fireEvent.keyDown(attack, { key: "ArrowLeft" });
  expect(attack.getAttribute("aria-valuetext")).toBe("3 ms");
  fireEvent.keyDown(release, { key: "Home" });
  expect(release.getAttribute("aria-valuetext")).toBe("100 ms");
  const auto = master.getByRole("button", { name: "MASTER · Auto Gain" });
  const makeup = master.getByRole<HTMLButtonElement>("slider", { name: "MASTER · MAKEUP" });
  fireEvent.click(auto);
  expect(makeup.disabled).toBe(true);
  expect(makeup.getAttribute("aria-valuetext")).toBe("6 dB");
  fireEvent.keyDown(master.getByRole("slider", { name: "MASTER · Threshold" }), { key: "Home" });
  expect(makeup.getAttribute("aria-valuetext")).toBe("15 dB");
  fireEvent.keyDown(master.getByRole("slider", { name: "MASTER · Ratio" }), { key: "ArrowRight" });
  expect(makeup.getAttribute("aria-valuetext")).toBe("18 dB");
  fireEvent.click(auto);
  expect(makeup.disabled).toBe(false);
  expect(makeup.getAttribute("aria-valuetext")).toBe("-2 dB");
});
