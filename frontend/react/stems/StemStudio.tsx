import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { confirm } from "@tauri-apps/plugin-dialog";
import { stemApi, stemError, type StemJob, type StemSource } from "../../stems";
import type { Song } from "../../types";
import { invalidateLibrary } from "../data";
import { useI18n } from "../i18n";
import { usePlayer } from "../player";
import { Dialog } from "../ui";
import { useStemJob, useStemJobs } from "./data";
import { StemWizard } from "./StemWizard";
import "./stems.css";

const tabs = ["new", "projects"] as const;
type Tab = typeof tabs[number];
export interface StemStudioRequest { song?: Song; source?: StemSource; projects?: boolean; folder?: string; openLatest?: boolean }

export function StemStudio({ request, open, close, onMixer, onOpenEngines, onOpenModels, openQueuedResult = true }: {
  request: StemStudioRequest; open: boolean; close: () => void; onMixer: (job: StemJob) => void;
  onOpenEngines: () => void; onOpenModels: () => void; openQueuedResult?: boolean;
}) {
  const { t } = useI18n();
  const client = useQueryClient();
  const player = usePlayer();
  const [tab, setTab] = useState<Tab>(request.projects ? "projects" : "new");
  const [openingLatest, setOpeningLatest] = useState(Boolean(request.openLatest && request.song));
  const [pending, setPending] = useState<string>();
  const [wizardKey, setWizardKey] = useState(0);
  const job = useStemJob(pending);
  const latest = useQuery({
    queryKey: ["stem-latest-project", request.song?.id], queryFn: () => stemApi.latestProject(request.song!.id),
    enabled: open && openingLatest, refetchOnMount: "always", networkMode: "always", retry: false,
  });
  const { engine, setPlaying } = player;

  useEffect(() => {
    engine.current?.pause();
    setPlaying(false);
  }, [engine, setPlaying]);

  useEffect(() => {
    if (open && job.data?.project && job.data.status === "done") {
      setPending(undefined);
      onMixer(job.data);
    }
  }, [open, job.data, onMixer]);

  useEffect(() => {
    if (!open || !openingLatest || !latest.isFetchedAfterMount || latest.isFetching) return;
    setOpeningLatest(false);
    if (!latest.error && latest.data) onMixer(latest.data);
  }, [open, openingLatest, latest.isFetchedAfterMount, latest.isFetching, latest.error, latest.data, onMixer]);

  function switchTab(next: Tab) {
    setPending(undefined);
    if (next === "new" && tab === "projects") setWizardKey(value => value + 1);
    setTab(next);
  }

  return <Dialog open={open && !openingLatest} title={t("stem_title")} onClose={close} className="stem-studio">
    <div className="stem-head">
      <div>
        <h2>{t("stem_title")}</h2>
        {request.song && <p className="small">{request.song.title || request.song.caption}</p>}
      </div>
      <button type="button" className="sek" onClick={close}>{t("close")}</button>
    </div>
    <nav className="stem-row stem-nav" aria-label={t("stem_title")}>
      {tabs.map(value => <button type="button" className="sek"
        key={value} aria-pressed={value === tab} onClick={() => switchTab(value)}>{t(`stem_${value}`)}</button>)}
    </nav>
    <div hidden={tab !== "new"}>
      {tab === "new" && <StemWizard key={wizardKey} song={request.song} initialSource={request.source} folderId={request.folder} active={open}
        onOpenEngines={onOpenEngines} onOpenModels={onOpenModels} onPreview={setPending} onQueued={ids => {
          if (openQueuedResult) setPending(ids[0]);
          setTab("projects");
          void client.invalidateQueries({ queryKey: ["stem-jobs"] });
        }} />}
    </div>
    {tab === "projects" && !openingLatest && <ProjectList song={request.song} folder={request.source ? undefined : request.folder}
      choose={project => { setPending(undefined); onMixer(project); }} />}
    {latest.error && <p role="alert" className="err">{stemError(latest.error, t)}</p>}
    {job.error && <p role="alert" className="err">{stemError(job.error, t)}</p>}
  </Dialog>;
}

function ProjectList({ song, folder, choose }: { song?: Song; folder?: string; choose: (job: StemJob) => void }) {
  const { t } = useI18n();
  const client = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const projects = useStemJobs(song?.id, undefined, offset, folder);
  const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError("");
    try { await action(); await client.invalidateQueries({ queryKey: ["stem-jobs"] }); }
    catch (cause) { setError(stemError(cause, t)); }
    finally { setBusy(false); }
  }
  async function remove(item: StemJob) {
    if (!await confirm(`${t("stem_remove_project_confirm")}\n\n${item.request.name}`, {
      kind: "warning", title: t("stem_remove_project"), okLabel: t("stem_remove_project"), cancelLabel: t("cancel"),
    })) return;
    await stemApi.removeProject(item.id);
    if (projects.data?.length === 1 && offset > 0) setOffset(offset - 40);
    await invalidateLibrary(client);
  }
  return <section className="stem-projects" aria-label={t("stem_jobs")}>
    {projects.isPending && <p role="status">{t("desktop_checking")}</p>}
    {(projects.error || error) && <p className="err" role="alert">{error || stemError(projects.error, t)}</p>}
    {projects.data?.length === 0 && <p>{t("stem_empty_projects")}</p>}
    {projects.data?.map(item => {
      return <article className="stem-block stem-row stem-spread" key={item.id}>
        <div>
          <strong>{item.request.name}</strong>
          <p className="small">{item.request.preview ? `${t("stem_preview")} · ` : ""}{item.request.pin.model} · {new Date(item.created_at).toLocaleString()}</p>
          {item.error && <p className="err small" role="alert">{t(item.error)}</p>}
        </div>
        <div className="stem-row">
          <span role="status">{t(`stem_${item.phase === "interrupted" ? "interrupted_status" : item.phase}`)}</span>
          {["queued", "running"].includes(item.status) && <button className="sek mini" disabled={busy} onClick={() => void run(() => stemApi.cancel(item.id))}>{t("cancel")}</button>}
          {["error", "cancelled"].includes(item.status) && <button className="sek mini" disabled={busy} onClick={() => void run(() => stemApi.retry(item.id))}>{t("retry")}</button>}
          {item.status === "done" && item.project && <button type="button" className="sek" disabled={busy} onClick={() => choose(item)}>{t("stem_mixer")}</button>}
          {["done", "error", "cancelled"].includes(item.status) &&
            <button type="button" className="sek danger" disabled={busy} aria-label={`${t("stem_remove_project")} · ${item.request.name}`}
              onClick={() => void run(() => remove(item))}>{t("stem_remove_project")}</button>}
        </div>
      </article>;
    })}
    <div className="stem-row">
      {offset > 0 && <button type="button" className="sek" onClick={() => setOffset(offset - 40)}>{t("lib_prev")}</button>}
      {projects.data?.length === 40 && <button type="button" className="sek" onClick={() => setOffset(offset + 40)}>{t("lib_next")}</button>}
    </div>
  </section>;
}
