// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { setLang } from "../../i18n.js";
import { profileKey } from "../../creator-models";
import type { ModelCatalog } from "../../types";
import { handlers, ipc, mountControls, resetDesktop, saved, catalogFixture, turbo, xl } from "./test-support";

beforeEach(() => { resetDesktop(); setLang("de"); });
afterEach(cleanup);
async function open() {
  await waitFor(() => expect((screen.getByRole("combobox", { name: "Modelle" }) as HTMLSelectElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Modelle wählen" }));
  return screen.findByRole("dialog", { name: "Modelle" });
}

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
  fireEvent.change(within(dialog).getByRole("combobox", { name: "Klangmodell" }), { target: { value: xl.synthesis } });
  fireEvent.click(button);
  expect(await within(dialog).findByText("Bitte diese Auswahl zuerst verwenden.")).toBeTruthy();
  expect(recommended).toHaveBeenCalledOnce();
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
  fireEvent.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
  expect(await within(dialog).findByRole("alert")).toBeTruthy();
  expect(screen.getByLabelText("selection").textContent).toBe("acestep-v15-sft-Q8_0.gguf");
});
