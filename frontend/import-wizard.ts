import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { backend } from "./backend";
import { t } from "./i18n.js";
import type { ImportPreview, ImportProgress, ImportRequest, ImportResult } from "./types";

type Mode = "import" | "move";

/// Keep the native folder grant attached to every selected path; text alone grants no access.
async function pick(path?: string): Promise<string | null> {
  const chosen = await open({ directory: true, defaultPath: path || undefined });
  return typeof chosen === "string" ? chosen : null;
}

/// A fresh dialog owns its listeners and state, so reopening never reuses a stale preview.
export async function openLibraryAssistant(mode: Mode, target: string, onImported?: (songsDir: string) => void): Promise<void> {
  if (document.querySelector("#importWizard")) return;
  const dialog = document.createElement("dialog");
  dialog.id = "importWizard";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "importHeading");
  dialog.innerHTML = `
    <h2 id="importHeading"></h2>
    <p id="importHint" class="small"></p>
    <section id="importSourceStep">
      <h3></h3><button type="button" class="sek" id="importSourcePick"></button><p id="importSourcePath" class="small"></p>
    </section>
    <section>
      <h3 id="importTargetHeading"></h3><p id="importTargetPath" class="small"></p>
      <button type="button" class="sek" id="importTargetPick"></button>
      <button type="button" class="sek" id="importSongsPick" hidden></button><p id="importSongsPath" class="small" hidden></p>
      <p id="importSandbox" class="small"></p>
    </section>
    <section aria-live="polite" aria-atomic="true">
      <h3 id="importReviewHeading"></h3><p id="importSummary"></p><ul id="importIssues"></ul>
      <label class="check-row" id="importPartialRow" hidden><input type="checkbox" id="importPartial"><span></span></label>
      <details id="importMissingDetails" hidden><summary></summary><ul id="importMissing"></ul></details>
    </section>
    <progress id="importProgress" max="1" hidden></progress><p id="importProgressText" role="status"></p>
    <p id="importError" role="alert" class="setup-error"></p>
    <div class="submit"><button type="button" class="sek" id="importClose"></button><button type="button" class="aktion" id="importRun" disabled></button></div>`;
  document.body.append(dialog);
  const get = <T extends HTMLElement = HTMLElement>(selector: string): T => dialog.querySelector<T>(selector)!;
  const text = (selector: string, key: string) => { get(selector).textContent = t(key); };
  text("#importHeading", mode === "import" ? "import_title" : "import_move_title");
  text("#importHint", mode === "import" ? "import_hint" : "import_move_hint");
  text("#importSourceStep h3", "import_step_source");
  text("#importSourcePick", "import_choose_source");
  text("#importTargetHeading", "import_step_target");
  text("#importTargetPick", "import_choose_target");
  text("#importSongsPick", "import_choose_songs");
  text("#importSandbox", "import_sandbox");
  text("#importReviewHeading", "import_step_review");
  text("#importPartialRow span", "import_allow_partial");
  text("#importMissingDetails summary", "import_missing_list");
  text("#importRun", mode === "import" ? "import_start" : "import_move_start");
  text("#importClose", "cancel");
  get("#importSourceStep").hidden = mode === "move";
  if (mode === "move") {
    get("#importTargetHeading").textContent = t("import_step_target").replace(/^2/, "1");
    get("#importReviewHeading").textContent = t("import_step_review").replace(/^3/, "2");
  }
  get("#importProgress").setAttribute("aria-label", t(mode === "import" ? "import_copying" : "import_moving"));
  const request: ImportRequest = { root: "", songs_source: null, songs_dir: target, allow_partial: false };
  let busy = false;
  let done = false;
  let sequence = 0;
  let checked: ImportPreview | null = null;
  let reopenAt: string | undefined;
  get("#importTargetPath").textContent = target;
  const unlisten = await listen<ImportProgress>("import-progress", ({ payload }) => {
    if (!busy) return;
    const progress = get<HTMLProgressElement>("#importProgress");
    if (payload.phase !== "copying") {
      progress.removeAttribute("value");
      get("#importProgressText").textContent = t(payload.phase === "checking" ? "import_checking" : "import_committing");
      return;
    }
    progress.value = Math.min(payload.copied_bytes / Math.max(payload.total_bytes, 1), 1);
    get("#importProgressText").textContent = `${payload.files} / ${payload.total_files} · ${bytes(payload.copied_bytes)} / ${bytes(payload.total_bytes)}`;
  });
  dialog.addEventListener("close", () => { sequence++; unlisten(); dialog.remove(); });
  dialog.addEventListener("cancel", event => { if (busy) { event.preventDefault(); void backend.cancelSetup(); } });

  function working(value: boolean): void {
    busy = value;
    for (const control of dialog.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input")) control.disabled = value;
    get<HTMLButtonElement>("#importClose").disabled = false;
    get<HTMLButtonElement>("#importRun").disabled = value || done || !checked?.can_import;
    get("#importProgress").hidden = !value;
    if (!value && !done) { checked = null; get<HTMLButtonElement>("#importRun").disabled = true; }
    if (value) get<HTMLProgressElement>("#importProgress").removeAttribute("value");
    document.body.dataset.settingUp = String(value);
  }

  function missing(items: ImportResult["missing"]): void {
    get("#importMissingDetails").hidden = !items.length;
    get("#importMissingDetails summary").textContent = `${t("import_missing_list")}: ${items.length}`;
    get("#importMissing").replaceChildren(...items.map(item => {
      const li = document.createElement("li"); li.textContent = `${item.title} · ${item.file || item.id}`; return li;
    }));
  }

  async function check(): Promise<void> {
    const current = ++sequence;
    checked = null;
    get<HTMLButtonElement>("#importRun").disabled = true;
    get("#importError").textContent = "";
    get("#importSummary").textContent = t("import_checking");
    get("#importIssues").replaceChildren();
    if (mode === "import" && !request.root) { get("#importSummary").textContent = ""; return; }
    get("#importProgress").hidden = false;
    get<HTMLProgressElement>("#importProgress").removeAttribute("value");
    get("#importProgressText").textContent = t("import_checking");
    for (const control of dialog.querySelectorAll<HTMLButtonElement | HTMLInputElement>("section button, input")) control.disabled = true;
    try {
      const result = mode === "import" ? await backend.previewImport({ ...request }) : await backend.previewMove(request.songs_dir);
      if (current !== sequence || !dialog.isConnected) return;
      checked = result;
      get("#importSummary").textContent = `${t("import_songs")}: ${result.songs} · ${t("import_folders")}: ${result.folders} · ${t("import_audio")}: ${result.files} · ${bytes(result.bytes)} / ${result.free_bytes === null ? "—" : bytes(result.free_bytes)} ${t("import_free")}\n${request.songs_dir}`;
      get("#importIssues").replaceChildren(...result.issues.map(issue => {
        const li = document.createElement("li"); li.textContent = `${t(`import_${issue.code}`)} · ${issue.path}`; return li;
      }));
      get("#importSongsPick").hidden = !result.songs_source || (mode === "move" && !result.issues.some(issue => issue.code === "songs_access"));
      get("#importSongsPath").hidden = !result.songs_source;
      get("#importSongsPath").textContent = `${t("import_source_folder")}: ${result.songs_source}`;
      get("#importPartialRow").hidden = mode !== "import" || !result.missing.length;
      missing(result.missing);
      if (result.issues.some(issue => issue.code === "select_project")) {
        reopenAt = request.root.replace(/[/\\]songs[/\\]?$/, "");
        // Only suggest the parent; a new native selection must authorize it.
        const path = await pick(reopenAt);
        if (path && current === sequence) { request.root = path; request.songs_source = null; get("#importSourcePath").textContent = path; await check(); }
      }
      get<HTMLButtonElement>("#importRun").disabled = busy || !checked?.can_import;
    } catch (error) { if (current === sequence) get("#importError").textContent = errorText(error); }
    finally {
      if (current === sequence && !busy) {
        get("#importProgress").hidden = true;
        get("#importProgressText").textContent = "";
        for (const control of dialog.querySelectorAll<HTMLButtonElement | HTMLInputElement>("section button, input")) control.disabled = done;
      }
    }
  }

  get("#importSourcePick").onclick = () => { void (async () => {
    const path = await pick(reopenAt || request.root);
    if (!path) return;
    request.root = path; request.songs_source = null; request.allow_partial = false;
    get<HTMLInputElement>("#importPartial").checked = false;
    get("#importSourcePath").textContent = path;
    await check();
  })().catch(showError); };
  get("#importTargetPick").onclick = () => { void (async () => {
    const path = await pick(request.songs_dir);
    if (!path) return;
    await backend.rememberFolder(path);
    request.songs_dir = path;
    get("#importTargetPath").textContent = path;
    await check();
  })().catch(showError); };
  get("#importSongsPick").onclick = () => { void (async () => {
    const path = await pick(request.songs_source || checked?.songs_source);
    if (!path) return;
    if (mode === "move") await backend.rememberFolder(path);
    else request.songs_source = path;
    await check();
  })().catch(showError); };
  get<HTMLInputElement>("#importPartial").onchange = () => {
    request.allow_partial = get<HTMLInputElement>("#importPartial").checked;
    void check();
  };
  function showError(error: unknown): void { get("#importError").textContent = errorText(error); }
  get("#importClose").onclick = () => { if (busy) void backend.cancelSetup(); else dialog.close(); };
  get("#importRun").onclick = () => { void (async () => {
    if (!checked?.can_import || busy) return;
    sequence++;
    working(true);
    get("#importProgressText").textContent = t(mode === "import" ? "import_copying" : "import_moving");
    get("#importError").textContent = "";
    try {
      let result: ImportResult;
      if (mode === "import") result = await backend.importLibrary({ ...request });
      else {
        await backend.saveSettings({ songs_dir: request.songs_dir });
        result = { songs: checked.songs, files: checked.files, songs_dir: request.songs_dir, missing: checked.missing };
      }
      done = true;
      get("#importSummary").textContent = `${t("import_done")}: ${result.songs} · ${t("import_audio")}: ${result.files}\n${result.songs_dir}`;
      get("#importIssues").replaceChildren();
      get("#importSongsPath").hidden = true;
      get("#importPartialRow").hidden = true;
      missing(result.missing);
      onImported?.(result.songs_dir);
      document.dispatchEvent(new Event("studio-ready"));
      text("#importClose", "desktop_close");
    } catch (error) { showError(error); }
    finally {
      working(false);
      get("#importProgressText").textContent = "";
      if (!done) {
        const error = get("#importError").textContent;
        await check();
        get("#importError").textContent = error;
      }
      if (done) for (const button of dialog.querySelectorAll<HTMLButtonElement>("section button")) button.disabled = true;
    }
  })().catch(showError); };
  dialog.showModal();
  if (mode === "move") await check();
}

function errorText(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  if (value === "Operation cancelled") return t("import_cancelled");
  return value.startsWith("import_") ? t(value) : value;
}

function bytes(value: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const unit = value > 0 ? Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1) : 0;
  return `${new Intl.NumberFormat(document.documentElement.lang, { maximumFractionDigits: 1 }).format(value / 1024 ** unit)} ${units[unit]}`;
}
