import { invoke } from "@tauri-apps/api/core";
import "./desktop-i18n";
import "./model-i18n";
import "./expert-i18n";
import "./title-i18n";
import "./form-preferences-i18n";
import { applyI18n } from "./i18n.js";
import { backend } from "./backend";
import { initializeDesktop } from "./desktop";
import { element } from "./dom";
import { showSetup } from "./setup";
import type { Bootstrap } from "./types";
import { initializeModelPicker } from "./model-picker";

let bootstrap: Bootstrap;
async function showStudio(resetSelection = false): Promise<void> {
  const studio = await import("./studio.js");
  await Promise.all([studio.studioReady, studio.initializeStudioFormPreferences()]);
  await initializeModelPicker(resetSelection);
  element("#setupScreen").hidden = true; element("#studio").hidden = false;
  document.dispatchEvent(new Event("studio-ready"));
  requestAnimationFrame(() => element<HTMLInputElement>('#genForm input[name="title"]').focus({preventScroll:true}));
}

export async function startApp(): Promise<void> {
  applyI18n();
  await initializeDesktop();
  bootstrap = await backend.bootstrap();
  if (bootstrap.needs_setup) await showSetup(bootstrap, showStudio); else await showStudio();
  await invoke("startup_complete");
}

document.addEventListener("manage-models", () => {
  void backend.settings().then((settings) => showSetup({ ...bootstrap, settings, needs_setup: false, error: null }, showStudio));
});
