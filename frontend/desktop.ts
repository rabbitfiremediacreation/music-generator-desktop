import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { confirm, open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { backend } from "./backend";
import { element } from "./dom";
import { t } from "./i18n.js";
import { flushGenerationFormPreferences } from "./form-preferences";

let closing = false;
export async function requestClose(): Promise<void> {
  if (closing) return;
  closing = true;
  try {
    const queue = await backend.queue().catch(() => null);
    if ((queue?.running.length || queue?.queued || queue?.active || document.body.dataset.settingUp === "true" || document.body.dataset.modelDownload === "true") && !await confirm(t("desktop_close_busy"), { title: "Music Generator", kind: "warning" })) return;
    const form = document.querySelector<HTMLFormElement>("#genForm");
    if (form) form.inert = true;
    try {
      await flushGenerationFormPreferences();
      await backend.exit();
    } finally { if (form) form.inert = false; }
  } finally { closing = false; }
}

export async function initializeDesktop(): Promise<void> {
  if (navigator.userAgent.includes("Macintosh")) document.documentElement.dataset.platform = "macos";
  const window = getCurrentWindow();
  element("#windowMinimize").onclick = () => { void window.minimize(); };
  element("#windowMaximize").onclick = () => { void window.toggleMaximize(); };
  element("#windowClose").onclick = () => { void requestClose(); };
  await window.onCloseRequested(async (event) => { event.preventDefault(); await requestClose(); });
  await listen("request-exit", () => { void requestClose(); });
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="https:"]') : null;
    if (target) { event.preventDefault(); void openUrl(target.href).catch((e) => alert(String(e))); }
  });
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-pick-folder]")) {
    button.onclick = async () => {
      const field = element<HTMLInputElement>(button.dataset.pickFolder!);
      const folder = await open({ directory: true, defaultPath: field.value || undefined });
      if (typeof folder === "string") { await backend.rememberFolder(folder); field.value = folder; field.dispatchEvent(new Event("change", { bubbles: true })); }
    };
  }
}
