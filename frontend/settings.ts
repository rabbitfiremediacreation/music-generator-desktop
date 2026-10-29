import { backend } from "./backend";
import { element } from "./dom";
import { t } from "./i18n.js";
import type { Settings } from "./types";
import { modelErrorText, settingsChanges } from "./expert-mode";
import { createSettingsDialog } from "./settings-dialog";

export function initializeSettings(onSaved: () => void | Promise<void> = () => {}) {
  const dialog = element<HTMLDialogElement>("#settingsDlg");
  const form = element<HTMLFormElement>("#settingsForm");
  const fields = element<HTMLFieldSetElement>("#settingsFields");
  const save = element<HTMLButtonElement>("#saveBtn");
  const status = element("#settingsStatus");
  const retry = element<HTMLButtonElement>("#settingsRetry");
  let revision = 0;
  let before: Settings | undefined;
  let pendingSave: Promise<Settings> | undefined;
  let statusKey = "";
  const setStatus = (key: string) => { statusKey = key; status.textContent = key ? t(key) : ""; };
  document.addEventListener("langchange", () => setStatus(statusKey));
  const field = <T extends HTMLInputElement | HTMLSelectElement>(name: string) => form.elements.namedItem(name) as T;
  // Discard save attempts while loading or writing the device; never queue a second write.
  form.addEventListener("submit", event => {
    if ((event.submitter as HTMLButtonElement | null)?.value !== "cancel" && (!before || pendingSave || fields.disabled)) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  });
  const controller = createSettingsDialog(dialog, async () => {
    if (!before) return;
    const values = settingsChanges(before, {
      expert_mode: field<HTMLInputElement>("expert_mode").checked,
      cpu_iteration_behavior: field<HTMLSelectElement>("cpu_iteration_behavior").value as Settings["cpu_iteration_behavior"],
      lm_device: field<HTMLSelectElement>("lm_device").value as Settings["lm_device"],
      timeout_minutes: Number(field("timeout_minutes").value),
      songs_dir: field("songs_dir").value.trim(),
      export_format: field<HTMLSelectElement>("export_format").value as Settings["export_format"],
    });
    setStatus("");
    const operation = Object.keys(values).length ? backend.saveSettings(values) : undefined;
    if (operation) pendingSave = operation;
    try { await operation; await onSaved(); }
    finally { if (pendingSave === operation) pendingSave = undefined; }
  }, error => error instanceof Error && error.message === "mp3_failed" ? t("mp3_failed") : modelErrorText(error, t));
  async function load(): Promise<void> {
    const request = ++revision;
    fields.disabled = true; save.disabled = true; retry.hidden = true;
    before = undefined;
    setStatus("settings_loading");
    try {
      if (pendingSave) await pendingSave.catch(() => undefined);
      if (request !== revision || !dialog.open) return;
      const settings: Settings = await backend.settings();
      if (request !== revision || !dialog.open) return;
      before = settings;
      field<HTMLInputElement>("expert_mode").checked = settings.expert_mode;
      for (const key of ["timeout_minutes", "songs_dir", "lm_device", "export_format", "cpu_iteration_behavior"] as const) field(key).value = String(settings[key]);
      field<HTMLInputElement>("songs_dir").placeholder = settings.songs_dir_default || "";
      field<HTMLSelectElement>("export_format").querySelector<HTMLOptionElement>('option[value="mp3"]')!.disabled = !settings.mp3_available;
      element("#expHint").hidden = Boolean(settings.mp3_available);
      element("#settingsIntelHint").hidden = !settings.cpu_only;
      field<HTMLSelectElement>("lm_device").disabled = false;
      fields.disabled = false; save.disabled = false; setStatus("");
    } catch {
      if (request !== revision || !dialog.open) return;
      setStatus("settings_load_failed"); retry.hidden = false;
    }
  }
  element<HTMLButtonElement>("#btnSettings").onclick = () => {
    if (dialog.open || controller.isSaving()) return;
    dialog.returnValue = "";
    controller.resetStatus();
    dialog.showModal();
    void load();
  };
  retry.onclick = () => { void load(); };
  element<HTMLButtonElement>("#settingsOpenSongs").onclick = async () => {
    try { await backend.openSongsFolder(); setStatus(""); } catch { setStatus("settings_open_folder_failed"); }
  };
  field<HTMLSelectElement>("lm_device").onchange = async () => {
    if (!before || pendingSave || fields.disabled || !dialog.open) return;
    const request = revision;
    const device = field<HTMLSelectElement>("lm_device");
    const value = device.value as Settings["lm_device"];
    device.disabled = true; save.disabled = true;
    setStatus("settings_device_saving");
    const operation = backend.saveSettings({ lm_device: value });
    pendingSave = operation;
    try {
      const settings = await operation;
      if (request !== revision || !dialog.open) return;
      before.lm_device = settings.lm_device;
      setStatus("settings_device_saved");
    } catch {
      if (request !== revision || !dialog.open) return;
      device.value = before.lm_device;
      setStatus("settings_device_failed");
    } finally {
      if (pendingSave === operation) pendingSave = undefined;
      if (request === revision && dialog.open) { device.disabled = false; save.disabled = false; }
    }
  };
  dialog.addEventListener("close", () => { revision++; });
  document.addEventListener("open-settings", () => element<HTMLButtonElement>("#btnSettings").click());
  return {
    ...controller,
    isSaving: () => controller.isSaving() || Boolean(pendingSave),
    blocksGeneration: () => controller.blocksGeneration() || Boolean(pendingSave),
  };
}
