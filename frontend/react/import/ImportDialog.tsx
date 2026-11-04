import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { backend } from "../../backend";
import { pickFolder, pathErrorText, type FolderPurpose } from "../../path-dialogs";
import type { ImportProgress, ImportRequest, ImportResult } from "../../types";
import { useI18n } from "../i18n";

export interface ImportDialogProps {
  open: boolean; mode: "import" | "move"; songsDirectory: string; platform: string;
  onClose: () => void; onImported?: (songsDir: string) => void;
}
const platformKeys = ["choose_target", "choose_songs", "source_access", "songs_access", "target_access"];

export function ImportDialog(props: ImportDialogProps) {
  return props.open ? <ImportSession {...props} /> : null;
}

/** Each mounted session owns its preview so completed work cannot reuse an old request. */
function ImportSession({ mode, songsDirectory, platform, onClose, onImported }: ImportDialogProps) {
  const { t, language } = useI18n();
  const client = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(false);
  const running = useRef(false);
  const choosing = useRef(false);
  const suggested = useRef("");
  const [request, setRequest] = useState<ImportRequest>({ root: "", songs_source: null, songs_dir: songsDirectory, allow_partial: false });
  const [failure, setFailure] = useState<unknown>();
  const [result, setResult] = useState<ImportResult>();
  const [selecting, setSelecting] = useState(false);
  const preview = useQuery({
    queryKey: ["import", "preview", mode, request],
    queryFn: () => mode === "import" ? backend.previewImport(request) : backend.previewMove(request.songs_dir),
    enabled: !result && (mode === "move" || Boolean(request.root)), retry: false, networkMode: "always", staleTime: 0,
  });
  const progress = useQuery<ImportProgress | null>({ queryKey: ["import", "progress"], queryFn: () => null, initialData: null, enabled: false });
  const operation = useMutation({
    mutationKey: ["import", "run"], retry: false, networkMode: "always",
    mutationFn: async () => {
      if (mode === "import") return backend.importLibrary({ ...request });
      await backend.saveSettings({ songs_dir: request.songs_dir });
      return { songs: preview.data!.songs, files: preview.data!.files, songs_dir: request.songs_dir, missing: preview.data!.missing };
    },
  });
  const translate = (key: string) => t(platform !== "macos" && platformKeys.some(value => key === `import_${value}`) ? `${key}_plain` : key);
  const errorText = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    return message === "Operation cancelled" ? t("import_cancelled") : message.startsWith("import_") ? translate(message) : pathErrorText(error);
  };
  useEffect(() => {
    mounted.current = true; dialog.current?.showModal();
    return () => { mounted.current = false; };
  }, []);

  async function choose(purpose: FolderPurpose, current: string, persist = false) {
    if (choosing.current || running.current) return;
    choosing.current = true; setSelecting(true); setFailure(undefined);
    try {
      const path = await pickFolder(purpose, current, persist);
      if (!path || !mounted.current) return;
      if (purpose === "import_root") setRequest(value => ({ ...value, root: path, songs_source: null, allow_partial: false }));
      else if (purpose === "songs") setRequest(value => ({ ...value, songs_dir: path }));
      else if (mode === "import") setRequest(value => ({ ...value, songs_source: path }));
      else await preview.refetch();
    } catch (error) { if (mounted.current) setFailure(error); }
    finally { choosing.current = false; if (mounted.current) setSelecting(false); }
  }

  useEffect(() => {
    if (preview.data?.issues.some(issue => issue.code === "select_project") && suggested.current !== request.root) {
      suggested.current = request.root;
      void choose("import_root", request.root.replace(/[/\\]songs[/\\]?$/, ""));
    }
    // A select-project reply requests one explicit native grant for its suggested parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview.data, request.root]);

  async function run() {
    if (running.current || selecting || preview.isFetching || !preview.data?.can_import || result) return;
    running.current = true; setFailure(undefined); client.setQueryData(["import", "progress"], null);
    try {
      const transferred = await operation.mutateAsync();
      await Promise.all([["settings"], ["models", "catalog"], ["generation-policy"], ["health"], ["songs"], ["folders"], ["queue"]].map(queryKey => client.invalidateQueries({ queryKey })));
      if (mounted.current) { setResult(transferred); onImported?.(transferred.songs_dir); }
    } catch (error) {
      if (mounted.current) { setFailure(error); await preview.refetch(); }
    } finally { running.current = false; }
  }
  const busy = operation.isPending;
  const disabled = busy || selecting || preview.isFetching || Boolean(result);
  const shown = result || preview.data;
  const missing = shown?.missing || [];
  const bytes = (value: number) => {
    const units = ["B", "KiB", "MiB", "GiB", "TiB"];
    const unit = value > 0 ? Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1) : 0;
    return `${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value / 1024 ** unit)} ${units[unit]}`;
  };
  const close = () => { if (busy) void backend.cancelSetup().catch(setFailure); else onClose(); };
  const currentError = failure ?? preview.error;
  return <dialog ref={dialog} id="importWizard" aria-labelledby="importHeading" onCancel={event => { event.preventDefault(); close(); }}>
    <h2 id="importHeading">{t(mode === "import" ? "import_title" : "import_move_title")}</h2>
    <p className="small">{t(mode === "import" ? "import_hint" : "import_move_hint")}</p>
    {mode === "import" && <section><h3>{t("import_step_source")}</h3><button type="button" className="sek" disabled={disabled} onClick={() => void choose("import_root", request.root)}>{t("import_choose_source")}</button><p className="small">{request.root}</p></section>}
    <section><h3>{mode === "move" ? t("import_step_target").replace(/^2/, "1") : t("import_step_target")}</h3><p className="small">{request.songs_dir}</p>
      <button type="button" className="sek" disabled={disabled} onClick={() => void choose("songs", request.songs_dir, true)}>{translate("import_choose_target")}</button>
      {preview.data?.songs_source && (mode === "import" || preview.data.issues.some(issue => issue.code === "songs_access")) && <button type="button" className="sek" disabled={disabled} onClick={() => void choose("import_songs", request.songs_source || preview.data!.songs_source, mode === "move")}>{translate("import_choose_songs")}</button>}
      {!result && preview.data?.songs_source && <p className="small">{t("import_source_folder")}: {preview.data.songs_source}</p>}
      {platform === "macos" && <p className="small">{t("import_sandbox")}</p>}
    </section>
    <section aria-live="polite" aria-atomic="true"><h3>{mode === "move" ? t("import_step_review").replace(/^3/, "2") : t("import_step_review")}</h3>
      {preview.isFetching ? <p>{t("import_checking")}</p> : result ? <p>{t("import_done")}: {result.songs} · {t("import_audio")}: {result.files}<br />{result.songs_dir}</p> : preview.data && <p>{t("import_songs")}: {preview.data.songs} · {t("import_folders")}: {preview.data.folders} · {t("import_audio")}: {preview.data.files} · {bytes(preview.data.bytes)} / {preview.data.free_bytes === null ? "—" : bytes(preview.data.free_bytes)} {t("import_free")}</p>}
      {!result && <ul>{preview.data?.issues.map((issue, index) => <li key={`${issue.code}:${issue.path}:${index}`}>{translate(`import_${issue.code}`)} · {issue.path}</li>)}</ul>}
      {!result && mode === "import" && missing.length > 0 && <label className="check-row"><input type="checkbox" checked={request.allow_partial} disabled={disabled} onChange={event => setRequest(value => ({ ...value, allow_partial: event.target.checked }))} />{t("import_allow_partial")}</label>}
      {missing.length > 0 && <details><summary>{t("import_missing_list")}: {missing.length}</summary><ul>{missing.map(item => <li key={item.id}>{item.title} · {item.file || item.id}</li>)}</ul></details>}
    </section>
    {busy && <><progress max="1" value={progress.data?.phase === "copying" ? Math.min(progress.data.copied_bytes / Math.max(progress.data.total_bytes, 1), 1) : undefined} aria-label={t(mode === "import" ? "import_copying" : "import_moving")} /><p role="status">{progress.data?.phase === "copying" ? `${progress.data.files} / ${progress.data.total_files} · ${bytes(progress.data.copied_bytes)} / ${bytes(progress.data.total_bytes)}` : t(progress.data?.phase === "committing" ? "import_committing" : "import_checking")}</p></>}
    {currentError && <p role="alert" className="setup-error">{errorText(currentError)}</p>}
    <div className="submit"><button type="button" className="sek" onClick={close}>{t(result ? "desktop_close" : "cancel")}</button><button type="button" className="aktion" disabled={disabled || !preview.data?.can_import} onClick={() => void run()}>{t(mode === "import" ? "import_start" : "import_move_start")}</button></div>
  </dialog>;
}
