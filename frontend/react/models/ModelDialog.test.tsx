// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { setLang } from "../../i18n.js";
import { profileKey } from "../../creator-models";
import type { ModelCatalog } from "../../types";
import { standard } from "../setup/fixtures";
import { handlers, ipc, mountControls, resetDesktop, saved, catalogFixture, turbo, xl } from "./test-support";
import { catalogWithNativeProfiles, catalogWithAudioCraft, catalogWithDiffRhythm2, catalogWithHeartMuLa, catalogWithMagenta, catalogWithMimetic, catalogWithMiniMax, catalogWithMuLaCover, catalogWithStableAudio, catalogWithText2midi } from "./model-fixtures";

beforeEach(() => { resetDesktop(); setLang("de"); });
afterEach(cleanup);
async function open() {
  await waitFor(() => expect((screen.getByRole("combobox", { name: "Modelle" }) as HTMLSelectElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Modelle wählen" }));
  return screen.findByRole("dialog", { name: "Modelle" });
}

it.each([false, true])("shows DiffRhythm terms before download (evaluation runner available: %s)", async available => {
  const catalog = catalogWithDiffRhythm2();
  const diffrhythm = catalog.profiles![0];
  diffrhythm.available = available;
  catalog.hardware = { ...catalog.hardware, platform: "linux", ram_bytes: 32 * 1024 ** 3, vram_bytes: 24 * 1024 ** 3 };
  const invoke = ipc.invoke.getMockImplementation()!;
  ipc.invoke.mockImplementation(async (name, args) => {
    if (name === "model_catalog") return catalog;
    if (name === "get_settings") return saved();
    return invoke(name, args);
  });
  mountControls();
  const dialog = within(await open());
  fireEvent.click(await dialog.findByRole("button", { name: diffrhythm.name }));
  expandSources(dialog);
  expect(dialog.getByRole("heading", { name: diffrhythm.name })).toBeTruthy();
  expect(dialog.getByRole("link", { name: "ASLP-lab/DiffRhythm2" })).toBeTruthy();
  expect(dialog.getByRole("link", { name: "OpenMuQ/MuQ-MuLan-large" })).toBeTruthy();
  expect(dialog.getAllByRole("link", { name: "Apache-2.0" }).length).toBeGreaterThan(1);
  expect(dialog.getByText("Hardware-Abnahme steht aus")).toBeTruthy();
  expect(dialog.getAllByRole("link", { name: "CC BY-NC 4.0" })).toHaveLength(2);
  expect(dialog.getByText(/Mono-WAV/)).toBeTruthy();
  expect(dialog.queryByRole("combobox", { name: "Sprachmodell" })).toBeNull();
  expect(dialog.queryByRole("button", { name: "Herunterladen und verwenden" })).toBeNull();
  const optIn = dialog.queryByRole("button", { name: "Für nichtkommerzielle Evaluation herunterladen" });
  expect(Boolean(optIn)).toBe(available);
  expect(ipc.invoke.mock.calls.some(([command]) => command === "use_models")).toBe(false);
  if (optIn) {
    fireEvent.click(optIn);
    await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith("use_models", { selection: diffrhythm.selection }));
    return;
  }
  fireEvent.click(dialog.getByRole("button", { name: "SFT" }));
  expect(dialog.getByRole("heading", { name: "SFT" })).toBeTruthy();
});

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
  const quantizations = within(dialog.getByRole("group", { name: "Quantisierung" }));
  expect(quantizations.getByRole("radio", { name: /^F32/ })).toBeTruthy();
  expect(quantizations.getByRole("radio", { name: /^Q8_0/ })).toBeTruthy();
  expect(quantizations.queryByRole("radio", { name: /^F16/ })).toBeNull();
  expandSources(dialog);
  expect(dialog.getByRole("heading", { name: heartmula.name })).toBeTruthy();
  expect(dialog.getByRole("link", { name: "HeartMuLa/HeartMuLa-oss-3B-happy-new-year" })).toBeTruthy();
  expect(dialog.getByRole("link", { name: "HeartMuLa/HeartCodec-oss-20260123" })).toBeTruthy();
  expect(dialog.getAllByRole("link", { name: "Apache-2.0" }).length).toBeGreaterThan(1);
  expect(dialog.getByRole("link", { name: "Nutzungsbedingungen" }).getAttribute("href")).toBe(heartmula.usage.policy_url);
  expect(dialog.getByText("Hardware-Abnahme steht aus")).toBeTruthy();
  expect(dialog.queryByRole("combobox", { name: "Sprachmodell" })).toBeNull();
  expect(dialog.queryByRole("button", { name: "Herunterladen und verwenden" })).toBeNull();
  fireEvent.click(dialog.getByRole("button", { name: "HeartMuLa 3B" }));
  const baseQuantizations = within(dialog.getByRole("group", { name: "Quantisierung" }));
  expect(baseQuantizations.getByRole("radio", { name: /^Q8_0/ })).toBeTruthy();
  expect(baseQuantizations.getByRole("radio", { name: /^F16/ })).toBeTruthy();
  expect(baseQuantizations.queryByRole("radio", { name: /^F32/ })).toBeNull();
  fireEvent.click(dialog.getByRole("button", { name: "SFT" }));
  expect(dialog.getByRole("heading", { name: "SFT" })).toBeTruthy();
  expect(ipc.invoke.mock.calls.some(([command]) => command === "use_models")).toBe(false);
});

it("shows pinned Text2midi sources and permits local import in Simple Mode", async () => {
  const catalog = catalogWithText2midi(true);
  const profile = catalog.profiles![0];
  const invoke = ipc.invoke.getMockImplementation()!;
  ipc.invoke.mockImplementation((name, args) => {
    if (name === "model_catalog") return Promise.resolve(structuredClone(catalog));
    if (name === "get_settings") return Promise.resolve({ ...saved(), expert_mode: false });
    return invoke(name, args);
  });
  mountControls();
  const dialog = within(await open());
  fireEvent.click(await dialog.findByRole("button", { name: profile.name }));
  expandSources(dialog);
  for (const source of profile.upstream_sources) {
    expect(dialog.getByRole("link", { name: source.repository }).getAttribute("href")).toBe(`https://huggingface.co/${source.repository}/tree/${source.revision}`);
  }
  expect(dialog.getByText("MIDI (.mid)")).toBeTruthy();
  expect(dialog.queryByText("Länge")).toBeNull();
  expect(dialog.getByText(/Apache 2\.0 erlaubt die private und kommerzielle Nutzung/)).toBeTruthy();
  expect(dialog.getByText(/Lege für den Offline-Import/)).toBeTruthy();
  expect(dialog.getByRole("button", { name: "Herunterladen und verwenden" })).toHaveProperty("disabled", false);
  expect(ipc.invoke.mock.calls.some(([command]) => command === "use_models")).toBe(false);
  catalog.models = catalog.models.map(model => ({ ...model, present: true }));
  fireEvent.click(dialog.getByRole("button", { name: "Modelldateien neu einlesen" }));
  fireEvent.click(await dialog.findByRole("button", { name: "Prüfen und verwenden" }));
  await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith("use_models", { selection: profile.selection }));
});

it("shows the one-time Text2midi runtime command before enabling the download", async () => {
  const catalog = catalogWithText2midi();
  const profile = catalog.profiles![0];
  profile.unavailable_reason = "text2midi_runtime_required";
  profile.install_command = "/bin/bash '/Applications/Music Generator.app/Contents/Resources/text2midi/install.sh' '/Users/Test/Music Generator'";
  const invoke = ipc.invoke.getMockImplementation()!;
  ipc.invoke.mockImplementation((name, args) => name === "model_catalog" ? Promise.resolve(catalog) : invoke(name, args));
  mountControls();
  const dialog = within(await open());
  fireEvent.click(await dialog.findByRole("button", { name: profile.name }));
  expandSources(dialog);
  const command = dialog.getByRole("textbox", { name: "Einmaliger Terminalbefehl" }) as HTMLTextAreaElement;
  expect(command.readOnly).toBe(true);
  expect(command.value).toBe(profile.install_command);
  expect(dialog.getByText(/Installiere Python 3\.12 für arm64/)).toBeTruthy();
  expect(dialog.queryByRole("button", { name: "Herunterladen und verwenden" })).toBeNull();
});

it("lists both AudioCraft NC profiles and downloads only the one explicitly confirmed", async () => {
  const catalog = catalogWithAudioCraft(true);
  const magnet = catalog.profiles!.find(profile => profile.selection.synthesis === "magnet-small-30secs")!;
  const invoke = ipc.invoke.getMockImplementation()!;
  ipc.invoke.mockImplementation((name, args) => name === "model_catalog" ? Promise.resolve(catalog) : invoke(name, args));
  mountControls();
  const dialog = within(await open());
  expect(await dialog.findByRole("button", { name: "MusicGen Small · CC BY-NC 4.0" })).toBeTruthy();
  fireEvent.click(dialog.getByRole("button", { name: "MAGNeT Small 30s · CC BY-NC 4.0" }));
  expect(dialog.getByRole("link", { name: "facebook/magnet-small-30secs" })).toBeTruthy();
  expect(dialog.getByRole("link", { name: "google-t5/t5-base" })).toBeTruthy();
  expect(dialog.getByRole("link", { name: "Nutzungsbedingungen" }).getAttribute("href")).toBe(magnet.usage.policy_url);
  expect(dialog.getByText(/nichtkommerzielle Nutzung mit Namensnennung/)).toBeTruthy();
  expect(dialog.getByText("/models")).toBeTruthy();
  expect(dialog.getByText(/Lege für den Offline-Import/)).toBeTruthy();
  expect(dialog.getByRole("button", { name: "Modelldateien neu einlesen" })).toBeTruthy();
  expect(dialog.queryByRole("link", { name: "facebook/musicgen-small" })).toBeNull();
  expect(ipc.invoke.mock.calls.some(([command]) => command === "use_models")).toBe(false);
  const download = dialog.getByRole("button", { name: /Herunterladen und verwenden/i }) as HTMLButtonElement;
  expect(download.disabled).toBe(false);
  fireEvent.click(download);
  await waitFor(() => expect(ipc.invoke).toHaveBeenCalledWith("use_models", {
    selection: { provider: "audiocraft", synthesis: "magnet-small-30secs", language: "" },
  }));
});

it("discloses the Magenta weight license, attribution, output terms and import path before acquisition", async () => {
  const catalog = catalogWithMagenta(true);
  const profile = catalog.profiles![0];
  const invoke = ipc.invoke.getMockImplementation()!;
  ipc.invoke.mockImplementation(async (name, args) => {
    if (name === "model_catalog") return catalog;
    if (name === "get_settings") return { ...saved(), expert_mode: false, recommended_profiles: catalog.recommended_profiles };
    return invoke(name, args);
  });
  mountControls();
  const dialog = within(await open());
  fireEvent.click(await dialog.findByRole("button", { name: profile.name }));
  expandSources(dialog);
  expect(dialog.getByRole("link", { name: "google/magenta-realtime-2" }).getAttribute("href")).toContain(profile.upstream_sources[0].revision);
  expect(dialog.getByRole("link", { name: "CC BY 4.0" })).toBeTruthy();
  expect(dialog.getByText(/Bei Weitergabe der Gewichte oder Änderungen Google LLC nennen/)).toBeTruthy();
  expect(dialog.getByText(/Google beansprucht keine Rechte an erzeugter Musik/)).toBeTruthy();
  expect(dialog.getByRole("link", { name: "Nutzungsbedingungen" }).getAttribute("href")).toBe(profile.usage.policy_url);
  expect(dialog.getByText(/Lege für den Offline-Import/)).toBeTruthy();
  expect(dialog.getByRole("note").textContent).toMatch(/Lücken in der Aufnahme/);
  expect((dialog.getByRole("button", { name: /Herunterladen und verwenden/i }) as HTMLButtonElement).disabled).toBe(false);
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
  expandSources(dialog);
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
  expandSources(dialog);
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
  expandSources(dialog);
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

it("shows Mimetic sources and terms, then refreshes locally imported files for verification", async () => {
  const initial = catalogWithMimetic();
  const profile = initial.profiles![0];
  let catalog = initial;
  const invoke = ipc.invoke.getMockImplementation()!;
  ipc.invoke.mockImplementation(async (name, args) => {
    if (name === "model_catalog") return catalog;
    if (name === "get_settings") return { ...saved(), expert_mode: false, recommended_profiles: catalog.recommended_profiles };
    return invoke(name, args);
  });
  mountControls();
  const dialog = within(await open());
  fireEvent.click(await dialog.findByRole("button", { name: profile.name }));
  expandSources(dialog);
  expect(dialog.getByText("1 / 2 / 4 Takte im 4/4-Takt, bis zu 16 Sekunden")).toBeTruthy();
  for (const { repository, revision } of profile.upstream_sources) {
    expect(dialog.getByRole("link", { name: repository }).getAttribute("href")).toBe(`https://huggingface.co/${repository}/tree/${revision}`);
  }
  expect(dialog.getByRole("link", { name: "Nutzungsbedingungen" }).getAttribute("href")).toBe(profile.usage.policy_url);
  expect(dialog.getByText("/models")).toBeTruthy();
  expect(dialog.getByText(/Lege für den Offline-Import/)).toBeTruthy();
  expect(dialog.getByRole("button", { name: "Herunterladen und verwenden" })).toBeTruthy();
  catalog = { ...catalog, models: catalog.models.map(model => ({ ...model, present: true })) };
  fireEvent.click(dialog.getByRole("button", { name: "Modelldateien neu einlesen" }));
  expect(await dialog.findByRole("button", { name: "Prüfen und verwenden" })).toBeTruthy();
  expect(ipc.invoke.mock.calls.some(([command]) => command === "use_models")).toBe(false);
});

it("discloses MuLaCover source pins and noncommercial output terms before acquisition", async () => {
  const catalog = catalogWithMuLaCover();
  const invoke = ipc.invoke.getMockImplementation()!;
  ipc.invoke.mockImplementation((name, args) => name === "model_catalog" ? Promise.resolve(catalog) : invoke(name, args));
  mountControls();
  const dialog = within(await open());
  expect(dialog.queryByText(/Erzeugte Musik darf nur nichtkommerziell/)).toBeNull();
  fireEvent.click(await dialog.findByRole("button", { name: "MuLaCover" }));
  expandSources(dialog);
  expect(dialog.getByText(/Erzeugte Musik darf nur nichtkommerziell/)).toBeTruthy();
  for (const source of ["HeartMuLa/MuLaCover", "HeartMuLa/HeartCodec-oss-20260123", "Qwen/Qwen3-Embedding-0.6B"]) {
    expect(dialog.getByRole("link", { name: source })).toBeTruthy();
  }
  expect(dialog.getByRole("link", { name: "mimbres/YourMT3" }).getAttribute("href")).toContain("/spaces/mimbres/YourMT3/");
  expect(dialog.getByRole("link", { name: "music-x-lab/ISMIR2019-Large-Vocabulary-Chord-Recognition" }).getAttribute("href")).toContain("https://github.com/");
  expect((dialog.getByRole("button", { name: "Herunterladen und verwenden" }) as HTMLButtonElement).disabled).toBe(false);
  expect(ipc.invoke.mock.calls.some(([command]) => command === "use_models")).toBe(false);
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
  const synthesis = await within(dialog).findByRole("group", { name: "Quantisierung" }) ;
  expect(within(synthesis).getAllByRole<HTMLInputElement>("radio").some(option => option.value === turbo.synthesis)).toBe(false);
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
  await within(dialog).findByRole("group", { name: "Quantisierung" });
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
  expect(within(dialog).queryByRole("button", { name: "Hardwaretest im Einrichtungsassistenten …" })).toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: "Download abbrechen" }));
  expect(await within(dialog).findByRole("alert")).toBeTruthy();
  expect(screen.getByLabelText("selection").textContent).toBe("acestep-v15-sft-Q8_0.gguf");
});

async function openUnavailableProfile(catalog: ModelCatalog, name: string) {
  const invoke = ipc.invoke.getMockImplementation()!;
  ipc.invoke.mockImplementation(async (name, args) => {
    if (name === "model_catalog") return catalog;
    if (name === "get_settings") return { ...saved(), expert_mode: false };
    return invoke(name, args);
  });
  mountControls();
  const dialog = within(await open());
  fireEvent.click(await dialog.findByRole("button", { name }));
  expect(dialog.getByRole("heading", { name })).toBeTruthy();
  expect(dialog.queryByRole("combobox", { name: "Sprachmodell" })).toBeNull();
  expect(dialog.queryByRole("button", { name: "Herunterladen und verwenden" })).toBeNull();
  return dialog;
}

function expandSources(dialog: ReturnType<typeof within>) {
  const summary = dialog.getByText("Quellen und Nutzung", { selector: "summary" });
  const disclosure = summary.closest("details")!;
  expect(disclosure.open).toBe(false);
  disclosure.open = true;
}

it("shows pinned HeartMuLa sources and terms on an unsupported computer", async () => {
  const catalog = catalogWithNativeProfiles();
  const heartmula = catalog.profiles!.find(profile => profile.selection.provider === "heartmula")!;
  heartmula.platforms = [];
  heartmula.usage.policy_url = "https://example.com/pinned-usage-policy";
  const dialog = await openUnavailableProfile(catalog, heartmula.name);
  const ram = dialog.getByText("Geschätzter RAM-Bedarf", { selector: "dt" });
  expect(ram.nextElementSibling?.textContent).toBe("28 GiB");
  expandSources(dialog);
  expect(dialog.getByText("Benötigte Dateien", { selector: "summary" }).closest("details")?.open).toBe(false);
  expect(dialog.getByRole("link", { name: "HeartMuLa/HeartMuLa-oss-3B-happy-new-year" })).toBeTruthy();
  expect(dialog.getByRole("link", { name: "HeartMuLa/HeartCodec-oss-20260123" })).toBeTruthy();
  expect(dialog.getAllByRole("link", { name: "Apache-2.0" }).length).toBeGreaterThan(1);
  expect(dialog.getByRole("link", { name: "Nutzungsbedingungen" }).getAttribute("href")).toBe(heartmula.usage.policy_url);
  expect(dialog.getByText("Hardware-Abnahme steht aus")).toBeTruthy();
});

it("shows the YuE2 terms on an unsupported computer without offering acquisition", async () => {
  const catalog = catalogWithNativeProfiles();
  const yue2 = catalog.profiles!.find(profile => profile.selection.provider === "yue2")!;
  const dialog = await openUnavailableProfile(catalog, yue2.name);
  expandSources(dialog);
  expect(dialog.getAllByRole("link", { name: "m-a-p/YuE2-3B" })).toHaveLength(2);
  expect(dialog.getByRole("link", { name: "m-a-p/YuE2-Vae" })).toBeTruthy();
  expect(dialog.getAllByRole("link", { name: "CC-BY-NC-4.0" })).toHaveLength(2);
  expect(dialog.getByRole("link", { name: "Apache-2.0" })).toBeTruthy();
  expect(dialog.getByText("Dieses Profil ist auf diesem Rechner nicht verfügbar.")).toBeTruthy();
  fireEvent.click(dialog.getByRole("button", { name: "SFT" }));
  expect(dialog.getByRole("heading", { name: "SFT" })).toBeTruthy();
  expect(ipc.invoke.mock.calls.some(([command]) => command === "use_models")).toBe(false);
});

it.each([false, true])("shows the YuE2 creator permission before acquisition (local files: %s)", async present => {
  const catalog = catalogWithNativeProfiles();
  const yue2 = catalog.profiles!.find(profile => profile.selection.provider === "yue2")!;
  catalog.profiles!.filter(profile => profile.selection.provider === "yue2").forEach(profile => { profile.available = true; });
  catalog.hardware.ram_bytes = 64 * 1024 ** 3;
  catalog.models.forEach(model => { if (model.provider === "yue2") model.present = present; });
  const invoke = ipc.invoke.getMockImplementation()!;
  ipc.invoke.mockImplementation((name, args) => name === "model_catalog" ? Promise.resolve(catalog) : invoke(name, args));
  mountControls();
  const dialog = within(await open());
  fireEvent.click(await dialog.findByRole("button", { name: yue2.name }));
  expect(dialog.getAllByRole("radio")).toHaveLength(4);
  const quantization = dialog.getByRole<HTMLInputElement>("radio", { name: /^Q5_K_M/ });
  fireEvent.click(quantization);
  expect(quantization.checked).toBe(true);
  expandSources(dialog);
  expect(dialog.getByRole("link", { name: "Vollständige Gewichtslizenz und Zusatzgenehmigung" }).getAttribute("href")).toBe(yue2.usage.policy_url);
  expect(dialog.getByText(/Unternehmen brauchen für die kommerzielle Modellnutzung eine separate Lizenz/)).toBeTruthy();
  expect(dialog.getByText(/Einzelkreative dürfen erzeugte Songs ohne Lizenzgebühren/)).toBeTruthy();
  expect(dialog.getByText(/Lege beim manuellen Import/)).toBeTruthy();
  expect(dialog.getByRole("button", { name: present ? "Prüfen und verwenden" : "Herunterladen und verwenden" })).toBeTruthy();
  expect(ipc.invoke.mock.calls.some(([command]) => command === "use_models")).toBe(false);
});

it("loads Hugging Face variants into their families and selects a pinned variant without activating it", async () => {
  const catalog = { ...catalogWithNativeProfiles(), expert_mode: true };
  const template = catalog.models.find(model => model.file === standard.synthesis)!;
  const file = "acestep-v15-sft-Q5_K_M.gguf";
  const installedFile = "acestep-v15-sft-Q5_K_M-hf-bbbbbbbbbbbbbbbb.gguf";
  const newSelection = { ...standard, synthesis: installedFile };
  const pin = {
    source: { repository: "Serveurperso/ACE-Step-1.5-GGUF", revision: "a".repeat(40), path: file },
    bytes: 1234567890, sha256: "b".repeat(64),
  };
  const yue = catalog.models.find(model => model.provider === "yue2" && model.role === "weights")!;
  catalog.models = catalog.models.filter(model => model.file !== file);
  const invoke = ipc.invoke.getMockImplementation()!;
  ipc.invoke.mockImplementation(async (name, args) => {
    if (name === "model_catalog") return structuredClone(catalog);
    if (name === "get_settings") return { ...saved(), expert_mode: true };
    if (name === "discover_hugging_face_models") return {
      candidates: [
        { pin, provider: template.provider, role: "synthesis", family: template.family, precision: "Q5_K_M", selection: null },
        { pin: { ...pin, source: yue.source }, provider: yue.provider, role: "weights", family: yue.family, precision: "Q8_0", selection: null },
        { pin: { ...pin, source: { ...pin.source, path: standard.synthesis } }, provider: template.provider, role: "synthesis", family: template.family, precision: "Q8_0", selection: standard },
      ],
      unavailable_repositories: ["audio-cpp/audio.cpp-gguf"],
    };
    if (name === "adopt_hugging_face_model") {
      catalog.models.push({ ...template, file: installedFile, hf_discovered: true, source: pin.source, sha256: pin.sha256, estimated_bytes: pin.bytes, precision: "Q5_K_M", verified: false, present: false });
      return newSelection;
    }
    return invoke(name, args);
  });
  mountControls();
  const dialog = within(await open());
  const quantizations = () => within(dialog.getByRole("group", { name: "Quantisierung" }));
  await dialog.findByRole("button", { name: "Prüfen und auswählen Q5_K_M" });
  expect(quantizations().getAllByRole("button")).toHaveLength(1);
  expect(dialog.getByText("Die Metadaten von Hugging Face sind gerade nicht erreichbar.")).toBeTruthy();
  fireEvent.click(dialog.getByRole("button", { name: "YuE2 3B" }));
  expect(quantizations().getByRole("button", { name: "Prüfen und auswählen Q8_0" })).toBeTruthy();
  expect(dialog.queryByRole("button", { name: "Prüfen und auswählen Q5_K_M" })).toBeNull();
  fireEvent.click(dialog.getByRole("button", { name: "SFT" }));
  const add = quantizations().getByRole("button", { name: "Prüfen und auswählen Q5_K_M" });
  fireEvent.click(add);
  await waitFor(() => expect(quantizations().queryByRole("button", { name: "Prüfen und auswählen Q5_K_M" })).toBeNull());
  expect(ipc.invoke.mock.calls.filter(([command]) => command === "discover_hugging_face_models")).toHaveLength(1);
  expect(ipc.invoke).toHaveBeenCalledWith("adopt_hugging_face_model", { pin, draft: standard });
  expect(ipc.invoke.mock.calls.some(([command]) => command === "use_models" || command === "select_models")).toBe(false);
  const chosen = dialog.getByRole("radio", { name: /^Q5_K_M.*Ungetestet/, checked: true }) as HTMLInputElement;
  expect(chosen.value).toBe(installedFile);
});
