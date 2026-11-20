// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { setLang } from "../../i18n.js";
import { profileKey } from "../../creator-models";
import type { ModelCatalog } from "../../types";
import { standard } from "../setup/fixtures";
import { handlers, ipc, mountControls, resetDesktop, saved, catalogFixture, turbo, xl } from "./test-support";
import { catalogWithHeartMuLa, catalogWithMiniMax, catalogWithStableAudio } from "./model-fixtures";

beforeEach(() => { resetDesktop(); setLang("de"); });
afterEach(cleanup);
async function open() {
  await waitFor(() => expect((screen.getByRole("combobox", { name: "Modelle" }) as HTMLSelectElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Modelle wählen" }));
  return screen.findByRole("dialog", { name: "Modelle" });
}

it("shows pinned HeartMuLa sources and terms before offering a download on supported builds", async () => {
  const catalog = catalogWithHeartMuLa();
  const heartmula = catalog.profiles![0];
  heartmula.usage.policy_url = "https://example.com/pinned-usage-policy";
  const invoke = ipc.invoke.getMockImplementation()!;
  ipc.invoke.mockImplementation(async (name, args) => {
    if (name === "model_catalog") return catalog;
    if (name === "get_settings") return { ...saved(), expert_mode: false };
    return invoke(name, args);
  });
  mountControls();
  const dialog = within(await open());
  fireEvent.click(await dialog.findByRole("button", { name: heartmula.name }));
  expect(dialog.getByRole("heading", { name: heartmula.name })).toBeTruthy();
  expect(dialog.getByRole("link", { name: "HeartMuLa/HeartMuLa-oss-3B-happy-new-year" })).toBeTruthy();
  expect(dialog.getByRole("link", { name: "HeartMuLa/HeartCodec-oss-20260123" })).toBeTruthy();
  expect(dialog.getAllByRole("link", { name: "Apache-2.0" }).length).toBeGreaterThan(1);
  expect(dialog.getByRole("link", { name: "Nutzungsbedingungen" }).getAttribute("href")).toBe(heartmula.usage.policy_url);
  expect(dialog.getByText("Hardware-Abnahme steht aus")).toBeTruthy();
  expect(dialog.queryByRole("combobox", { name: "Sprachmodell" })).toBeNull();
  expect(dialog.queryByRole("button", { name: "Herunterladen und verwenden" })).toBeNull();
  fireEvent.click(dialog.getByRole("button", { name: "SFT" }));
  expect(dialog.getByRole("heading", { name: "SFT" })).toBeTruthy();
  expect(ipc.invoke.mock.calls.some(([command]) => command === "use_models")).toBe(false);
});

it("shows the Stable Audio conditions and verifies imported files without activating an untested profile", async () => {
  const catalog = catalogWithStableAudio();
  const small = catalog.profiles!.find(profile => profile.name.endsWith("Small Music"))!;
  const invoke = ipc.invoke.getMockImplementation()!;
  ipc.invoke.mockImplementation(async (name, args) => {
    if (name === "model_catalog") return catalog;
    if (name === "get_settings") return { ...saved(), expert_mode: false };
    if (name === "verify_imported_models") {
      for (const file of catalog.models.filter(file => small.files.includes(file.file))) file.verified = true;
      return;
    }
    return invoke(name, args);
  });
  for (const file of catalog.models.filter(file => small.files.includes(file.file))) file.present = true;
  mountControls();
  const dialog = within(await open());
  fireEvent.click(await dialog.findByRole("button", { name: small.name }));
  expect(dialog.getByText(/Stimme den Bedingungen auf der offiziellen Hugging-Face-Modellseite zu/)).toBeTruthy();
  expect(dialog.getByText(/Powered by Stability AI/)).toBeTruthy();
  expect(dialog.getByRole("link", { name: "Bezugsbedingungen auf Hugging Face prüfen" }).getAttribute("href")).toBe("https://huggingface.co/stabilityai/stable-audio-3-small-music");
  expect(dialog.getByRole("link", { name: "Gemma Terms of Use" })).toBeTruthy();
  expect(dialog.getByRole("link", { name: "stabilityai/stable-audio-3-optimized" })).toBeTruthy();
  expect(dialog.getByText("Hardware-Abnahme steht aus")).toBeTruthy();
  fireEvent.click(dialog.getByRole("button", { name: "Importierte Dateien prüfen" }));
  await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith("verify_imported_models", { selection: small.selection }));
  expect(ipc.invoke.mock.calls.some(([command]) => command === "use_models")).toBe(false);
});

it("refreshes locally imported Stable Audio files and activates the supported profile in basic mode", async () => {
  const catalog = catalogWithStableAudio(true);
  const small = catalog.profiles!.find(profile => profile.name.endsWith("Small Music"))!;
  catalog.hardware.ram_bytes = small.platforms[0].minimum_ram_bytes;
  const recommended_profiles = [standard, small.selection];
  const invoke = ipc.invoke.getMockImplementation()!;
  ipc.invoke.mockImplementation(async (name, args) => {
    if (name === "model_catalog") return structuredClone(catalog);
    if (name === "get_settings") return { ...saved(), expert_mode: false, recommended_profiles };
    return invoke(name, args);
  });
  mountControls();
  const dialog = within(await open());
  fireEvent.click(await dialog.findByRole("button", { name: small.name }));
  const activate = dialog.getByRole("button", { name: "Importierte Dateien prüfen und verwenden" }) as HTMLButtonElement;
  expect(activate.disabled).toBe(true);
  for (const file of catalog.models.filter(file => small.files.includes(file.file))) file.present = true;
  fireEvent.click(dialog.getByRole("button", { name: "Modelldateien neu einlesen" }));
  await waitFor(() => expect(activate.disabled).toBe(false));
  fireEvent.click(activate);
  await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith("use_models", { selection: small.selection }));
  await waitFor(() => expect(screen.getByLabelText("selection").textContent).toBe(small.selection.synthesis));
});

it("verifies the pinned MiniMax import with the license visible and keeps the active model", async () => {
  let catalog = catalogWithMiniMax();
  const { selection } = catalog.profiles![0];
  const license = catalog.models.find(model => model.provider === selection.provider && model.role === "license")!;
  for (const file of catalog.models.filter(model => model.provider === selection.provider)) {
    file.present = file !== license;
  }
  const invoke = ipc.invoke.getMockImplementation()!;
  ipc.invoke.mockImplementation(async (name, args) => {
    if (name === "model_catalog") return catalog;
    if (name === "verify_imported_models") {
      expect(args.selection).toEqual(selection);
      catalog = { ...catalog, models: catalog.models.map(model => model.provider === selection.provider ? { ...model, verified: true } : model) };
      return;
    }
    return invoke(name, args);
  });
  mountControls();
  const dialog = within(await open());
  fireEvent.click(await dialog.findByRole("button", { name: "MiniMax-Music3" }));
  expect(dialog.getByRole("link", { name: "MiniMaxAI/MiniMax-Music3" }).getAttribute("href")).toContain("/tree/1b525ccb");
  expect(dialog.getByRole("link", { name: "audio-cpp/MiniMax-Music3-GGUF" }).getAttribute("href")).toContain("/tree/46fe77f8");
  expect(dialog.getByRole("link", { name: "MiniMax-Music3-GGUF/LICENSE" })).toBeTruthy();
  expect(dialog.getByRole("link", { name: "Nutzungsbedingungen" }).getAttribute("href")).toContain("/blob/1b525ccb");
  expect(dialog.getByText(/Die Freigabe wartet auf Schutzmaßnahmen/)).toBeTruthy();
  const verify = dialog.getByRole("button", { name: "Importierte Dateien prüfen" }) as HTMLButtonElement;
  expect(verify.disabled).toBe(true);
  catalog = { ...catalog, models: catalog.models.map(model => model === license ? { ...license, present: true } : model) };
  fireEvent.click(dialog.getByRole("button", { name: "Modelldateien neu einlesen" }));
  await waitFor(() => expect(verify.disabled).toBe(false));
  fireEvent.click(verify);
  await waitFor(() => expect(verify.textContent).toBe("Importierte Dateien geprüft"));
  expect(ipc.invoke).toHaveBeenCalledWith("verify_imported_models", { selection });
  expect(ipc.invoke.mock.calls.some(([name]) => name === "use_models")).toBe(false);
  expect(screen.getByLabelText("selection").textContent).toBe(standard.synthesis);
});

it("does not expose advanced models when an old catalog arrives after Expert Mode was disabled", async () => {
  let finish!: (catalog: ModelCatalog) => void;
  let settings = saved();
  const invoke = ipc.invoke.getMockImplementation()!;
  ipc.invoke.mockImplementation(async (name, args) => {
    if (name === "model_catalog") return new Promise<ModelCatalog>(resolve => { finish = resolve; });
    if (name === "get_settings") return settings;
    return invoke(name, args);
  });
  mountControls(); const dialog = await open();
  await waitFor(() => expect(typeof finish).toBe("function"));
  settings = { ...saved(), expert_mode: false };
  act(() => handlers.get("settings-changed")!({ payload: undefined }));
  await waitFor(() => expect(ipc.invoke.mock.calls.filter(([name]) => name === "get_settings").length).toBe(2));
  act(() => finish(structuredClone(catalogFixture)));
  const synthesis = await within(dialog).findByRole("combobox", { name: "Klangmodell" }) as HTMLSelectElement;
  expect(Array.from(synthesis.options).some(option => option.value === turbo.synthesis)).toBe(false);
  expect(within(dialog).queryByRole("combobox", { name: "Anbieter" })).toBeNull();
});

it("downloads the shared title model without replacing a restored song profile", async () => {
  const catalog = structuredClone(catalogFixture);
  catalog.title_model.verified = false; catalog.title_model.present = false;
  const invoke = ipc.invoke.getMockImplementation()!;
  ipc.invoke.mockImplementation(async (name, args) => name === "model_catalog" ? catalog : invoke(name, args));
  mountControls();
  await waitFor(() => expect(screen.queryByRole("button", { name: "Restore song" })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Restore song" }));
  const dialog = await open();
  const download = await within(dialog).findByRole("button", { name: /Titelmodell herunterladen/ });
  fireEvent.click(download);
  await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith("download_title_model", undefined));
  await within(dialog).findByText("Auswahl gespeichert");
  expect((screen.getByRole("combobox", { name: "Modelle" }) as HTMLSelectElement).value).toBe(profileKey(turbo));
});

it("only applies recommended iterations after an explicit click for the active model", async () => {
  const recommended = vi.fn(); mountControls(recommended);
  const dialog = await open();
  const button = await within(dialog).findByRole("button", { name: "Empfohlene Iterationen übernehmen" });
  expect(recommended).not.toHaveBeenCalled();
  fireEvent.click(button);
  await waitFor(() => expect(recommended).toHaveBeenCalledWith(30));
  fireEvent.click(within(dialog).getByRole("button", { name: "XL SFT" }));
  fireEvent.click(button);
  expect(await within(dialog).findByText("Bitte diese Auswahl zuerst verwenden.")).toBeTruthy();
  expect(recommended).toHaveBeenCalledOnce();
});

it("preserves a later original-profile intent after a closed dialog installs another profile", async () => {
  let finish!: (value: unknown) => void;
  let settings = saved();
  const invoke = ipc.invoke.getMockImplementation()!;
  ipc.invoke.mockImplementation((name, args) => name === "use_models" ? new Promise(resolve => { finish = resolve; }) : name === "get_settings" ? Promise.resolve(settings) : invoke(name, args));
  mountControls(); const dialog = await open();
  await within(dialog).findByRole("combobox", { name: "Klangmodell" });
  fireEvent.click(within(dialog).getByRole("button", { name: "XL SFT" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Auswahl verwenden" }));
  await waitFor(() => expect(typeof finish).toBe("function"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Schließen" }));
  fireEvent.click(screen.getByRole("button", { name: "Restore song" }));
  fireEvent.click(screen.getByRole("button", { name: "Restore original song" }));
  settings = saved(xl); finish(xl);
  await waitFor(() => expect((screen.getByRole("combobox", { name: "Modelle" }) as HTMLSelectElement).disabled).toBe(false));
  expect((screen.getByRole("combobox", { name: "Modelle" }) as HTMLSelectElement).value).toBe(profileKey(standard));
});

it.each(["draft","song","close"] as const)("ignores a delayed recommendation after changing %s",async change=>{
  let finish!:(value:unknown)=>void;const recommended=vi.fn(),invoke=ipc.invoke.getMockImplementation()!;
  ipc.invoke.mockImplementation((name,args)=>name==="generation_policy"?new Promise(resolve=>{finish=resolve;}):invoke(name,args));
  const view=mountControls(recommended);const dialog=await open();
  fireEvent.click(await within(dialog).findByRole("button",{name:"Empfohlene Iterationen übernehmen"}));
  await waitFor(()=>expect(finish).toBeTypeOf("function"));
  if(change==="draft")fireEvent.click(within(dialog).getByRole("button",{name:"XL SFT"}));
  else if(change==="song")fireEvent.click(screen.getByRole("button",{name:"Restore song"}));
  else fireEvent.click(within(dialog).getByRole("button",{name:"Schließen"}));
  await act(async()=>finish({recommended_steps:80}));
  expect(recommended).not.toHaveBeenCalled();view.unmount();
});

it("shows download progress and allows cancellation without changing the durable profile", async () => {
  const catalog = structuredClone(catalogFixture);
  catalog.models = catalog.models.map(model => ({ ...model, verified: false, present: false }));
  let fail!: (error: Error) => void;
  const invoke = ipc.invoke.getMockImplementation()!;
  ipc.invoke.mockImplementation(async (name, args) => {
    if (name === "model_catalog") return catalog;
    if (name === "use_models") return new Promise((_, reject) => { fail = reject; });
    if (name === "cancel_model_download") { fail(new Error("Operation cancelled")); return; }
    return invoke(name, args);
  });
  mountControls(); const dialog = await open();
  fireEvent.click(await within(dialog).findByRole("button", { name: "Herunterladen und verwenden" }));
  await waitFor(() => expect(typeof fail).toBe("function"));
  act(() => handlers.get("model-download-progress")!({ payload: { file: "weights.gguf", phase: "downloading", downloaded: 1, total: 2, bytes_per_second: 0 } }));
  expect(await within(dialog).findByText(/weights.gguf/)).toBeTruthy();
  expect((within(dialog).getByRole("button", { name: "Hardwaretest im Einrichtungsassistenten …" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(within(dialog).getByRole("button", { name: "Download abbrechen" }));
  expect(await within(dialog).findByRole("alert")).toBeTruthy();
  expect(screen.getByLabelText("selection").textContent).toBe("acestep-v15-sft-Q8_0.gguf");
});
