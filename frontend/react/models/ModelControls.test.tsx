// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { setLang } from "../../i18n.js";
import { profileKey } from "../../creator-models";
import type { ModelSelection, Settings } from "../../types";
import { standard } from "../setup/fixtures";
import { handlers, ipc, mountControls, resetDesktop, saved, turbo, xl } from "./test-support";

beforeEach(() => { resetDesktop(); setLang("de"); });
afterEach(cleanup);
const modelSelect = () => screen.getByRole("combobox", { name: "Modelle" }) as HTMLSelectElement;
async function ready() { await waitFor(() => expect(modelSelect().disabled).toBe(false)); }
function emit(name: string) { act(() => handlers.get(name)!({ payload: undefined })); }

it("preserves a later historical song choice when an earlier activation completes", async () => {
  let finish!: (selection: ModelSelection) => void;
  const invoke = ipc.invoke.getMockImplementation()!;
  ipc.invoke.mockImplementation(async (name, args) => name === "select_models" ? new Promise<ModelSelection>(resolve => { finish = resolve; }) : invoke(name, args));
  mountControls(); await ready();
  fireEvent.change(modelSelect(), { target: { value: profileKey(xl) } });
  await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith("select_models", { selection: xl }));
  fireEvent.click(screen.getByRole("button", { name: "Restore song" })); finish(xl);
  await ready(); expect(modelSelect().value).toBe(profileKey(turbo));
});

it.each([true, false])("preserves a newer original-profile intent during activation, with round trip=%s", async roundTrip => {
  let finish!: (selection: ModelSelection) => void;
  const invoke = ipc.invoke.getMockImplementation()!;
  ipc.invoke.mockImplementation(async (name, args) => name === "select_models" ? new Promise<ModelSelection>(resolve => { finish = resolve; }) : invoke(name, args));
  mountControls(); await ready();
  fireEvent.change(modelSelect(), { target: { value: profileKey(xl) } });
  await waitFor(() => expect(typeof finish).toBe("function"));
  if (roundTrip) fireEvent.click(screen.getByRole("button", { name: "Restore song" }));
  fireEvent.click(screen.getByRole("button", { name: "Restore original song" }));
  finish(xl);
  await ready(); expect(modelSelect().value).toBe(profileKey(standard));
});

it("explains missing XL support in simple and Expert Mode", async () => {
  let current: Settings = { ...saved(), expert_mode: false, recommended_profiles: [standard] };
  const invoke = ipc.invoke.getMockImplementation()!;
  ipc.invoke.mockImplementation(async (name, args) => name === "get_settings" ? current : invoke(name, args));
  mountControls(); await ready();
  expect(screen.getByText(/XL benötigt mehr Arbeitsspeicher/)).toBeTruthy();
  expect(modelSelect().getAttribute("aria-describedby")).toContain("creatorXlRamHint");
  current = { ...current, expert_mode: true }; emit("settings-changed");
  await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith("get_settings", undefined));
  expect(screen.getByText(/XL benötigt mehr Arbeitsspeicher/)).toBeTruthy();
  current = saved(); emit("settings-changed");
  await waitFor(() => expect(screen.queryByText(/XL benötigt mehr Arbeitsspeicher/)).toBeNull());
  expect(modelSelect().getAttribute("aria-describedby")).toBe("currentModels");
});

it("keeps a restored profile when a shared title-model download changes the model cache", async () => {
  mountControls(); await ready(); fireEvent.click(screen.getByRole("button", { name: "Restore song" }));
  emit("models-changed"); await ready(); expect(modelSelect().value).toBe(profileKey(turbo));
});

it("ignores a delayed settings snapshot after a newer song restoration", async () => {
  let finish!: (settings: Settings) => void;
  mountControls(); await ready();
  const invoke = ipc.invoke.getMockImplementation()!;
  ipc.invoke.mockImplementation(async (name, args) => name === "get_settings" ? new Promise<Settings>(resolve => { finish = resolve; }) : invoke(name, args));
  emit("models-changed");
  await waitFor(() => expect(typeof finish).toBe("function"));
  fireEvent.click(screen.getByRole("button", { name: "Restore song" })); finish(saved(xl));
  await ready(); expect(modelSelect().value).toBe(profileKey(turbo));
});

it("adopts a changed durable default when no newer local song choice exists", async () => {
  mountControls(); await ready();
  const invoke = ipc.invoke.getMockImplementation()!;
  ipc.invoke.mockImplementation(async (name, args) => name === "get_settings" ? saved(xl) : invoke(name, args));
  emit("models-changed"); await waitFor(() => expect(modelSelect().value).toBe(profileKey(xl)));
});

it("retains a restored profile across screen changes and accepts an explicit completed setup", async () => {
  mountControls(); await ready(); fireEvent.click(screen.getByRole("button", { name: "Restore song" }));
  fireEvent.click(screen.getByRole("button", { name: "Switch screen" }));
  fireEvent.click(screen.getByRole("button", { name: "Switch screen" }));
  await ready(); expect(modelSelect().value).toBe(profileKey(turbo));
  fireEvent.click(screen.getByRole("button", { name: "Complete setup" })); expect(modelSelect().value).toBe(profileKey(xl));
});

it("discards an activation error superseded by a restored song", async () => {
  let fail!: (error: Error) => void;
  const invoke = ipc.invoke.getMockImplementation()!;
  ipc.invoke.mockImplementation(async (name, args) => name === "select_models" ? new Promise((_, reject) => { fail = reject; }) : invoke(name, args));
  mountControls(); await ready(); fireEvent.change(modelSelect(), { target: { value: profileKey(xl) } });
  await waitFor(() => expect(typeof fail).toBe("function"));
  fireEvent.click(screen.getByRole("button", { name: "Restore song" })); fail(new Error("model_setup_required"));
  await ready(); expect(screen.queryByRole("alert")).toBeNull(); expect(modelSelect().value).toBe(profileKey(turbo));
});

it("keeps newer Expert Mode metadata after activation finishes", async () => {
  let finish!: (settings: Settings) => void;
  mountControls(); await ready();
  const invoke = ipc.invoke.getMockImplementation()!;
  ipc.invoke.mockImplementation(async (name, args) => name === "get_settings" ? new Promise<Settings>(resolve => { finish = resolve; }) : invoke(name, args));
  emit("settings-changed"); await waitFor(() => expect(typeof finish).toBe("function"));
  fireEvent.change(modelSelect(), { target: { value: profileKey(xl) } });
  await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith("select_models", { selection: xl }));
  finish({ ...saved(xl), expert_mode: false });
  await ready(); fireEvent.click(screen.getByRole("button", { name: "Restore song" }));
  expect(screen.getByText(/Diese Modellauswahl benötigt den Expert Mode/)).toBeTruthy();
});
