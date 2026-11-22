import { useEffect, useRef, useState } from "react";
import { I18N } from "../i18n.js";
import "../stems-i18n";
import { defaultMix, stemRole, upgradeMix, type MixVersion, type StemCatalog, type StemExport, type StemJob } from "../stems";
import { releaseMedia, type RemoteApi, type SongCard } from "./client";
import { StemOutputFields, StemInferenceFields } from "../react/stems/SeparationFields";
import { defaults, outputSelection, validInference, type OutputSelection } from "../react/stems/separation-options";

const url = (id: string) => encodeURIComponent(id);
type Translate = (key: string) => string;
const phase = (job: StemJob, t: Translate) => t(`stem_${job.phase === "interrupted" ? "interrupted_status" : job.phase}`);

export function MobileStems({ api, song, language, exit }: { api: RemoteApi; song?: SongCard; language: "de" | "en"; exit: () => void }) {
  const dictionary = I18N as unknown as Record<string, Record<string, unknown>>;
  const t: Translate = key => {
    const value = dictionary[language][key] ?? dictionary.en[key];
    return typeof value === "string" ? value : key;
  };
  const [models, setModels] = useState<StemCatalog>();
  const [jobs, setJobs] = useState<StemJob[]>();
  const [modelId, setModelId] = useState("");
  const [selection, setSelection] = useState<OutputSelection>({ goal: "multitrack" });
  const [options, setOptions] = useState(defaults);
  const [selected, setSelected] = useState<string>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const ready = models?.models.filter(model => model.status === "ready") ?? [];
  const current = ready.find(model => model.id === modelId) ?? ready[0];
  const { outputs } = outputSelection(current?.roles ?? [], selection);
  const open = jobs?.find(job => job.id === selected && Boolean(job.project));

  useEffect(() => {
    let active = true;
    void api.json<StemCatalog>("/api/stems/models").then(value => { if (active) setModels(value); }, cause => { if (active) setError(String(cause.message ?? cause)); });
    return () => { active = false; };
  }, [api]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const list = async () => {
      try {
        const value = await api.json<StemJob[]>(`/api/stems/jobs${song ? `?song_id=${url(song.id)}` : ""}`);
        if (!active) return;
        setJobs(value);
        timer = setTimeout(() => void list(), value.some(job => ["queued", "running"].includes(job.status)) ? 1200 : 5000);
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : String(cause)); }
    };
    void list();
    return () => { active = false; clearTimeout(timer); };
  }, [api, revision, song]);

  async function mutate(work: () => Promise<unknown>) {
    setBusy(true); setError("");
    try { await work(); setRevision(value => value + 1); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  return <section className="panel mobile-stems" aria-label={t("stem_projects")}>
    <div className="section-heading"><h1>{t("stem_projects")}</h1><button type="button" className="secondary" onClick={exit}>{t("stem_back")}</button></div>
    {song && <div className="stem-mobile-setup">
      <h2>{song.title}</h2>
      {ready.length > 0 && <>
        <label>{t("stem_model")} <select value={current?.id ?? ""} onChange={event => { setModelId(event.target.value); setSelection({ goal: selection.goal }); }}>
          {ready.map(model => <option value={model.id} key={model.id}>{model.name}</option>)}
        </select></label>
        <StemOutputFields native={current.roles} selection={selection} change={setSelection} t={t} />
        <StemInferenceFields options={options} change={setOptions} t={t} />
        <button type="button" className="primary" disabled={busy || !outputs.length || !validInference(options)} onClick={() => void mutate(async () => {
          const result = await api.write<{ id: string }>("/api/stems/jobs", "POST", { song_id: song.id, model_id: current.id, ...options, outputs });
          setSelected(result.id);
        })}>{t("stem_start")}</button>
      </>}
      {models && ready.length === 0 && <p className="muted">{t("stem_model_missing")}</p>}
    </div>}
    {error && <p className="notice danger" role="alert">{t(error)}</p>}
    {jobs?.length === 0 && <p className="muted">{t("stem_empty_projects")}</p>}
    {jobs?.map(job => <article className="stem-mobile-project" key={job.id}>
      <strong>{job.request.name}</strong><p className="fine">{job.request.pin.model} · {phase(job, t)}</p>
      {job.error && <p className="fine">{t(job.error)}</p>}
      {["queued", "running"].includes(job.status) && <button type="button" className="secondary" disabled={busy}
        onClick={() => void mutate(() => api.write(`/api/stems/jobs/${url(job.id)}/cancel`, "POST", {}))}>{t("cancel")}</button>}
      {["error", "cancelled"].includes(job.status) && <button type="button" className="secondary" disabled={busy}
        onClick={() => void mutate(() => api.write(`/api/stems/jobs/${url(job.id)}/retry`, "POST", {}))}>{t("retry")}</button>}
      {job.status === "done" && <button type="button" className="secondary" aria-expanded={open?.id === job.id} onClick={() => setSelected(open?.id === job.id ? undefined : job.id)}>{t("stem_mixer")}</button>}
      {open?.id === job.id && <MobileProject api={api} job={open} t={t} />}
    </article>)}
  </section>;
}

function MobileProject({ api, job, t }: { api: RemoteApi; job: StemJob; t: Translate }) {
  const [exports, setExports] = useState<StemExport[]>();
  const [versions, setVersions] = useState<MixVersion[]>([]);
  const [version, setVersion] = useState("");
  const [role, setRole] = useState(job.project!.roles[0]);
  const [current, setCurrent] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const player = useRef<HTMLAudioElement>(null);
  const objectUrl = useRef<string | null>(null);
  const base = `/api/stems/jobs/${url(job.id)}`;
  const selectedMix = versions.find(item => item.id === version)?.mix ?? defaultMix(job.project!);
  const mix = (selectedMix.version ?? 1) === 1 ? upgradeMix(selectedMix) : selectedMix;

  useEffect(() => {
    let active = true;
    void api.json<MixVersion[]>(`${base}/mixes`).then(value => {
      if (active) { setVersions(value); setVersion(value[0]?.id ?? ""); }
    }, cause => { if (active) setError(String(cause.message ?? cause)); });
    return () => { active = false; };
  }, [api, base]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const value = await api.json<StemExport[]>(`${base}/exports`);
        if (!active) return;
        setExports(value);
        if (value.some(item => ["queued", "running"].includes(item.status))) timer = setTimeout(() => void refresh(), 700);
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : String(cause)); }
    };
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [api, base, revision]);

  useEffect(() => () => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); }, []);

  async function run(work: () => Promise<void>) {
    setBusy(true); setError("");
    try { await work(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  async function play() {
    const { blob } = await api.blob(`${base}/audio/${url(role)}`);
    releaseMedia(player.current, objectUrl.current);
    const audio = player.current;
    if (!audio) return;
    objectUrl.current = URL.createObjectURL(blob);
    audio.src = objectUrl.current;
    setCurrent(role);
    await audio.play().catch(() => {});
  }

  async function start(kind: "raw" | "mix" | "package") {
    await api.write("/api/stems/exports", "POST", {
      project_id: job.id, kind, mix, selected: role === "original" ? [] : [role], format: "wav", wav_format: "float32",
      include_mix: kind === "package", include_original: kind === "package" && role === "original",
    });
    setRevision(value => value + 1);
  }

  async function download(id: string, index: number) {
    const { blob, filename } = await api.blob(`/api/stems/exports/${url(id)}/files/${index}`);
    const location = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = location; anchor.download = filename || "stems.wav";
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(location), 30000);
  }

  return <div className="stem-mobile-details">
    <label>{t("stem_track")} <select value={role} onChange={event => setRole(event.target.value)}>
      <option value="original">{t("stem_original")}</option>
      {job.project!.roles.map(value => <option value={value} key={value}>{stemRole(value, t)}</option>)}
    </select></label>
    <button type="button" className="secondary" disabled={busy} onClick={() => void run(play)}>{t("stem_play")}</button>
    <audio ref={player} hidden={!current} controls preload="metadata" aria-label={stemRole(current, t)} />
    {!job.request.preview && <>
      {versions.length > 0 && <label>{t("stem_mix_version")} <select value={version} onChange={event => setVersion(event.target.value)}>
        <option value="">{t("stem_default_mix")}</option>{versions.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
      </select></label>}
      <div className="stem-mobile-actions">
        <button type="button" className="secondary" disabled={busy || role === "original"} onClick={() => void run(() => start("raw"))}>{t("stem_export_tracks")}</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => void run(() => start("mix"))}>{t("stem_export_mix")}</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => void run(() => start("package"))}>{t("stem_export_package")}</button>
      </div>
      {exports?.map(item => <div className="stem-mobile-actions" key={item.id}>
        <span className="fine">{t(`stem_${item.status}`)}</span>
        {["queued", "running"].includes(item.status) && <>
          <progress max={100} value={item.progress} aria-label={t("stem_export_history")} />
          <button type="button" className="secondary" onClick={() => void run(async () => {
            await api.write(`/api/stems/exports/${url(item.id)}/cancel`, "POST", {}); setRevision(value => value + 1);
          })}>{t("cancel")}</button>
        </>}
        {item.outputs.map((output, index) => <button type="button" className="secondary" disabled={busy} key={output.file} onClick={() => void run(() => download(item.id, index))}>{output.file}</button>)}
        {item.error && <p className="notice danger">{t(item.error)}</p>}
      </div>)}
    </>}
    {error && <p className="notice danger" role="alert">{t(error)}</p>}
  </div>;
}
