import { modelErrorText, modelLabel } from "./expert-mode";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { backend } from "./backend";
import { openLibraryAssistant } from "./import-wizard";
import { bytes, element } from "./dom";
import { LANG, LANGS, applyI18n, setLang, t } from "./i18n.js";
import type { Bootstrap, DownloadProgress, SetupRequest } from "./types";

const languageSizes = ["0.6B", "1.7B", "4B"];
let initialized = false;
let configuration: Bootstrap;
let onReady: (resetSelection?: boolean) => Promise<void>;

function request(): SetupRequest {
  return { lm: element<HTMLSelectElement>("#setupLm").value, xl: element<HTMLInputElement>("#setupXl").checked, models_dir: element<HTMLInputElement>("#setupModels").value.trim(), songs_dir: element<HTMLInputElement>("#setupSongs").value.trim() };
}

export async function showSetup(data: Bootstrap, ready: (resetSelection?: boolean) => Promise<void>): Promise<void> {
  configuration = data; onReady = ready;
  element("#studio").hidden = true; element("#setupScreen").hidden = false;
  element("#bootStatus").textContent = data.error || t(data.needs_setup ? "desktop_setup_hint" : "desktop_manage_hint");
  element("#setupContent").hidden = false;
  if (!initialized) {
    element("#setupContent").innerHTML = `
      <form id="setupForm"><fieldset id="setupFields">
        <label class="field"><span class="lbl" data-i18n="language"></span><select id="setupLanguage"></select></label>
        <section class="hardware-card"><h2 data-i18n="desktop_hardware"></h2><p id="hardwareInfo"></p><p id="intelCpuHint" class="small" data-i18n="desktop_intel_cpu_hint" hidden></p></section>
        <section class="import-card"><button type="button" class="sek" id="importLibrary" data-i18n="desktop_import"></button><p class="small" data-i18n="desktop_import_hint"></p><p id="importStatus" role="status"></p></section>
        <label class="field"><span class="lbl" data-i18n="desktop_models_folder"></span><div class="path-picker"><input id="setupModels" required><button type="button" class="sek" data-setup-pick="setupModels" data-i18n="desktop_browse"></button></div></label>
        <label class="field"><span class="lbl" data-i18n="songs_dir"></span><div class="path-picker"><input id="setupSongs" required><button type="button" class="sek" data-setup-pick="setupSongs" data-i18n="desktop_browse"></button></div></label>
        <label class="field"><span class="lbl" data-i18n="desktop_language_model"></span><select id="setupLm"></select><span class="small" id="lmRecommendation"></span></label>
        <label class="check-row" id="setupXlField"><input type="checkbox" id="setupXl"><span data-i18n="desktop_xl"></span></label>
        <div id="modelList" class="model-list"></div>
        <p id="spaceEstimate" class="small" aria-live="polite"></p>
        <button class="aktion big" id="setupStart" type="submit" data-i18n="desktop_start"></button>
      </fieldset></form>
      <div id="setupProgressArea" hidden><progress id="setupProgress" max="1" aria-label="Download"></progress><p id="setupProgressText" role="status" aria-live="polite"></p><button class="sek" id="cancelSetup" data-i18n="cancel"></button></div>
      <p id="setupError" role="alert" class="setup-error"></p>
      <button class="sek" id="setupBack" data-i18n="desktop_back"></button>`;
    const language = element<HTMLSelectElement>("#setupLanguage");
    for (const [code, name] of Object.entries(LANGS)) language.add(new Option(name, code));
    language.onchange = () => { setLang(language.value); void updateEstimate(); };
    element("#setupForm").addEventListener("change", () => { void updateEstimate(); });
    element("#setupForm").addEventListener("submit", (e) => { e.preventDefault(); void configure(); });
    element("#setupForm").addEventListener("keydown", (e) => { if(e.key==="Enter" && e.target instanceof HTMLSelectElement)e.preventDefault(); });
    element("#setupBack").onclick = () => { void onReady(); };
    element("#cancelSetup").onclick = () => { void backend.cancelSetup(); };
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-setup-pick]")) button.onclick = async () => {
      const field = element<HTMLInputElement>(`#${button.dataset.setupPick}`);
      const path = await open({ directory: true, defaultPath: field.value || undefined });
      if (typeof path === "string") { await backend.rememberFolder(path); field.value = path; await updateEstimate(); }
    };
    element("#importLibrary").onclick = async () => {
      await openLibraryAssistant("import", element<HTMLInputElement>("#setupSongs").value.trim(), (songsDir) => {
        element<HTMLInputElement>("#setupSongs").value = songsDir;
        configuration.settings.songs_dir = songsDir;
        element("#importStatus").textContent = t("desktop_import_done");
        element<HTMLButtonElement>("#importLibrary").hidden = true;
      });
    };
    await listen<DownloadProgress>("setup-progress", ({ payload }) => {
      const progress = element<HTMLProgressElement>("#setupProgress");
      progress.value = payload.downloaded / Math.max(payload.total, 1);
      element("#setupProgressText").textContent = `${t(`desktop_${payload.phase}`)} ${payload.file} · ${bytes(payload.downloaded)} / ${bytes(payload.total)}${payload.bytes_per_second ? ` · ${(payload.bytes_per_second / 1024 ** 2).toFixed(1)} MiB/s` : ""}`;
    });
    await listen<string>("setup-stage", ({ payload }) => { element<HTMLProgressElement>("#setupProgress").removeAttribute("value"); element("#setupProgressText").textContent = t(payload === "starting" ? "desktop_starting" : payload === "testing" ? "desktop_testing" : "desktop_cpu_fallback"); });
    initialized = true;
  }
  element<HTMLSelectElement>("#setupLanguage").value = LANG;
  element<HTMLInputElement>("#setupModels").value = data.settings.models_dir;
  element<HTMLInputElement>("#setupSongs").value = data.settings.songs_dir;
  const canUseXl = data.settings.expert_mode || data.recommended_profiles.some(p => p.synthesis.includes("-xl-"));
  element("#setupXlField").hidden = !canUseXl;
  element<HTMLInputElement>("#setupXl").checked = canUseXl && (data.settings.dit === "xl" || Boolean(data.settings.dit_xl_available));
  element("#setupBack").hidden = data.needs_setup;
  element("#hardwareInfo").textContent = `${bytes(data.hardware.ram_bytes)} RAM · ${data.hardware.gpu}${data.hardware.vram_bytes ? ` · ${bytes(data.hardware.vram_bytes)} VRAM` : ""}`;
  element("#intelCpuHint").hidden = !data.hardware.cpu_only;
  element("#setupError").textContent = "";
  applyI18n();
  await updateEstimate(languageSizes.find(size => data.settings.lm_model.includes(`-${size}-`)) || data.hardware.recommended_lm);
}

let estimateSequence = 0;
async function updateEstimate(preferredLanguage?: string): Promise<void> {
  const sequence = ++estimateSequence;
  const lm = element<HTMLSelectElement>("#setupLm");
  if (!configuration.settings.expert_mode) {
    const xl = element<HTMLInputElement>("#setupXl").checked;
    const recommendation = configuration.recommended_profiles.find(p => p.synthesis.includes("-xl-") === xl);
    const size = recommendation ? modelLabel(recommendation.language, false) : configuration.hardware.recommended_lm;
    lm.replaceChildren(new Option(size, size));
    lm.disabled = true;
  } else {
    const previous = preferredLanguage || lm.value;
    lm.replaceChildren(...languageSizes.map(size => new Option(size, size)));
    lm.value = languageSizes.includes(previous) ? previous : configuration.hardware.recommended_lm;
    lm.disabled = false;
  }
  const selection = request();
  const unsupported = !configuration.settings.expert_mode && !configuration.recommended_profiles.length;
  element<HTMLButtonElement>("#setupStart").disabled = unsupported;
  element("#lmRecommendation").textContent = `${t("desktop_recommended")}: ${configuration.hardware.recommended_lm}`;
  const models: {file:string;estimated_bytes:number}[] = configuration.manifest.models.filter((m) => m.kind === "required" || m.kind === selection.lm || (m.kind === "xl" && selection.xl));
  models.push(configuration.title_model);
  element("#modelList").replaceChildren(...models.map((model) => { const row = document.createElement("div"); row.textContent = `${model.file} · ~${bytes(model.estimated_bytes)}`; return row; }));
  if (unsupported) { element("#spaceEstimate").textContent = t("expert_no_recommendation"); return; }
  try {
    const estimate = await backend.estimate(selection); if (sequence !== estimateSequence) return;
    element("#spaceEstimate").textContent = `${t("desktop_space")}: ~${bytes(estimate.missing_bytes)} / ${bytes(estimate.free_bytes)}`;
  } catch (error) { if (sequence === estimateSequence) element("#spaceEstimate").textContent = modelErrorText(error, t); }
}

function setBusy(busy: boolean): void {
  element<HTMLFieldSetElement>("#setupFields").disabled = busy;
  element<HTMLButtonElement>("#setupBack").disabled = busy;
  element("#setupProgressArea").hidden = !busy;
  document.body.dataset.settingUp = String(busy);
}

function showError(error: unknown): void { element("#setupError").textContent = modelErrorText(error, t); }

async function configure(): Promise<void> {
  setBusy(true); element("#setupError").textContent = "";
  element<HTMLProgressElement>("#setupProgress").removeAttribute("value"); element("#setupProgressText").textContent = t("desktop_checking");
  try {
    await backend.setup(request());
    element("#bootStatus").textContent = t("desktop_ready");
    await onReady(true);
  } catch (error) { showError(error); }
  finally { setBusy(false); await updateEstimate(); }
}
