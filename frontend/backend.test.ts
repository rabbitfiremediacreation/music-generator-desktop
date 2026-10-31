import { beforeEach, describe, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, convertFileSrc: (path: string) => `asset:${path}` }));
import { backend } from "./backend";

describe("desktop contracts", () => {
  beforeEach(() => { invoke.mockReset(); });
  it("binds bootstrap to the current startup attempt", async () => {
    await backend.bootstrap(3);
    expect(invoke).toHaveBeenLastCalledWith("bootstrap", { attempt: 3 });
  });
  it("reads and writes generation form preferences through their dedicated commands", async () => {
    const values = { duration: 90, bpm: 0, inference_steps: 80, lm_temperature: 1.2, variants: 2 };
    invoke.mockResolvedValue(values);
    expect(await backend.generationFormPreferences()).toEqual(values);
    expect(invoke).toHaveBeenLastCalledWith("get_generation_form_preferences", undefined);
    await backend.saveGenerationFormPreferences(values);
    expect(invoke).toHaveBeenLastCalledWith("save_generation_form_preferences", { values });
  });
  it("uses commands and converts song paths to local asset URLs", async () => {
    invoke.mockResolvedValue([{ id: "one", path: "/songs/one.wav" }]);
    const songs = await backend.songs({ q: "piano", favorites: true });
    expect(invoke).toHaveBeenCalledWith("list_songs", { filter: { q: "piano", favorites: true } });
    expect(songs[0].url).toBe("asset:/songs/one.wav");
  });
  it("preserves cancellation and generation payloads", async () => {
    invoke.mockResolvedValue({ ids: ["one"] });
    await backend.generate({ prompt: "piano", variants: 2, seed: 42 });
    expect(invoke).toHaveBeenCalledWith("generate", { request: { prompt: "piano", variants: 2, seed: 42 } });
    await backend.cancelSetup(); expect(invoke).toHaveBeenLastCalledWith("cancel_setup", undefined);
  });
  it("turns Rust errors into displayable errors", async () => {
    invoke.mockRejectedValue("Disk full");
    let failure: unknown;
    try { await backend.settings(); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("Disk full");
  });
  it("passes model selections through typed commands and preserves job snapshots", async () => {
    const selection = { provider: "ace-step", synthesis: "acestep-v15-turbo-Q8_0.gguf", language: "acestep-5Hz-lm-4B-Q6_K.gguf" };
    invoke.mockResolvedValue(selection);
    await backend.selectModels(selection);
    expect(invoke).toHaveBeenLastCalledWith("select_models", { selection });
    await backend.useModels(selection);
    expect(invoke).toHaveBeenLastCalledWith("use_models", { selection });
    await backend.generate({ prompt: "piano", model_selection: selection, inference_steps: 8 });
    expect(invoke).toHaveBeenLastCalledWith("generate", { request: { prompt: "piano", model_selection: selection, inference_steps: 8 } });
    await backend.downloadTitleModel();
    expect(invoke).toHaveBeenLastCalledWith("download_title_model", undefined);
    await backend.cancelModelDownload();
    expect(invoke).toHaveBeenLastCalledWith("cancel_model_download", undefined);
  });
});

it("requests a fresh synthesis-device policy for the selected model without altering LM settings", async () => {
  const selection = { provider: "ace-step", synthesis: "acestep-v15-sft-Q8_0.gguf", language: "acestep-5Hz-lm-0.6B-Q8_0.gguf" };
  await backend.generationPolicy(selection, true);
  expect(invoke).toHaveBeenLastCalledWith("generation_policy", { selection, refresh: true });
});
