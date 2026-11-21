import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { audibleTracks, defaultMix, defaultTrack, stemApi, stemError, upgradeMix, type MixVersion, type StemJob, type StemMix, type Track } from "../../stems";
import { useI18n } from "../i18n";
import { StemChannel } from "./StemChannel";
import { MixerMaster } from "./MixerMaster";
import { MixerTransportPanel } from "./MixerTransport";
import { StemExports } from "./StemExports";
import { useStemJobs } from "./data";
import { useMixerHistory } from "./useMixerHistory";
import { useStemTransport } from "./useStemTransport";
import "./mixer.css";

export function StemMixer({ job, onBack, onClose, onOpenProject, onNewSeparation }: {
  job: StemJob; onBack: () => void; onClose: () => void; onOpenProject?: (project: StemJob) => void; onNewSeparation?: () => void;
}) {
  const { t } = useI18n();
  const versions = useQuery({ queryKey: ["stem-mixes", job.id], queryFn: () => stemApi.mixes(job.id), networkMode: "always", retry: false });
  if (!job.project || versions.isPending) return <p role="status">{t("desktop_checking")}</p>;
  return <MixerEditor job={job} versions={versions.data ?? []} key={job.id} onBack={onBack} onClose={onClose} onOpenProject={onOpenProject} onNewSeparation={onNewSeparation}
    readError={versions.error ? stemError(versions.error, t) : undefined} />;
}

function resetTrack(track: Track): Track {
  return { ...defaultTrack(track.role), name: track.name, replacement: track.replacement };
}

function MixerEditor({ job, versions, onBack, onClose, onOpenProject, onNewSeparation, readError }: {
  job: StemJob; versions: MixVersion[]; onBack: () => void; onClose: () => void;
  onOpenProject?: (project: StemJob) => void; onNewSeparation?: () => void; readError?: string;
}) {
  const { t, language } = useI18n();
  const client = useQueryClient();
  const project = job.project!;
  const console = useRef<HTMLElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => console.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);
  const related = useStemJobs(job.source.song_id ?? undefined, job.source.song_id ? undefined : job.source.id,
    0, undefined, !!onOpenProject && !job.request.preview);
  const projects = related.data?.filter(item => item.status === "done" && !item.request.preview) ?? [];
  const firstVersion = versions.find(value => (value.mix.version ?? 1) <= 2);
  const history = useMixerHistory(() => firstVersion ? upgradeMix(firstVersion.mix) : defaultMix(project));
  const [version, setVersion] = useState(firstVersion?.id ?? "");
  const [name, setName] = useState(firstVersion?.name ?? t("stem_default_mix"));
  const [baseline, setBaseline] = useState(() => ({ mix: JSON.stringify(history.mix), name }));
  const [originalSelected, setOriginal] = useState(false);
  const [mono, setMono] = useState(false);
  const [focused, setFocused] = useState<string>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const { mix, gesture, edit } = history;
  const transport = useStemTransport(job.id, project, mix);
  const audible = audibleTracks(mix);
  const solo = mix.tracks.some(track => track.solo);
  const selected = mix.tracks.filter(track => track.export !== false).map(track => track.role);
  const dirty = baseline.mix !== JSON.stringify(mix) || baseline.name !== name;
  const original = !transport.missing.original && (originalSelected || mix.tracks.every(track => transport.missing[track.replacement ?? track.role]));
  const missing = Object.keys(transport.missing).length > 0;
  const rate = new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(project.rate / 1000);

  function changeTrack(role: string, patch: Partial<Track>) {
    edit(current => ({ ...current, tracks: current.tracks.map(track => track.role === role ? { ...track, ...patch } : track) }));
  }

  function load(id: string) {
    const saved = versions.find(value => value.id === id);
    if ((saved?.mix.version ?? 1) > 2) { setError(t("stem_mix_invalid")); return; }
    const next = saved ? upgradeMix(saved.mix) : defaultMix(project);
    const nextName = saved?.name ?? t("stem_default_mix");
    setError(""); setVersion(id); setName(nextName);
    history.load(next);
    setBaseline({ mix: JSON.stringify(next), name: nextName });
  }

  async function addTrack(replace?: Track) {
    setImporting(true); setError("");
    try {
      const imported = await stemApi.addTrack(job.id, t(replace ? "stem_replace_track" : "stem_add_track"));
      if (!imported) return;
      if (replace) changeTrack(replace.role, { replacement: imported.role });
      else edit(current => ({ ...current, tracks: [...current.tracks, { ...defaultTrack(imported.role), name: imported.name.slice(0, 80) }] }));
    } catch (cause) { setError(stemError(cause, t)); }
    finally { setImporting(false); }
  }

  async function relink() {
    setImporting(true); setError("");
    try {
      if (await stemApi.relink(job.source.id, t("stem_relink_source"))) transport.retry();
    } catch (cause) { setError(stemError(cause, t)); }
    finally { setImporting(false); }
  }

  async function save(asNew: boolean) {
    gesture.end();
    setSaving(true); setError("");
    try {
      const result = await stemApi.saveMix(job.id, asNew ? null : version || null, name, mix);
      setVersion(result.id);
      setName(current => current === name ? result.name : current);
      setBaseline({ mix: JSON.stringify(mix), name: result.name });
      await client.invalidateQueries({ queryKey: ["stem-mixes", job.id] });
      await client.invalidateQueries({ queryKey: ["songs"] });
    } catch (cause) { setError(stemError(cause, t)); }
    finally { setSaving(false); }
  }

  function handleKey(event: KeyboardEvent) {
    if (!(event.target instanceof HTMLElement) || event.target.closest("input,textarea,select,button,summary,[contenteditable]")) return;
    if (event.code === "Space" && transport.ready) {
      event.preventDefault();
      transport.play(!transport.getPosition().playing);
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) history.redo(); else history.undo();
    }
  }

  const projectControls = <div className="mixer-save">
    <label className="field">{t("stem_mix_version")}<select value={version} onChange={event => load(event.target.value)}>
      <option value="">{t("stem_default_mix")}</option>
      {versions.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
    </select></label>
    <label className="field">{t("stem_mix_name")}<input maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label>
    <button className="sek" type="button" disabled={saving || !name.trim()} onClick={() => void save(false)}>{t("save")}</button>
    <button className="sek" type="button" disabled={saving || !name.trim()} onClick={() => void save(true)}>{t("stem_save_version")}</button>
  </div>;

  return <section className="stem-mixer mixer-console" ref={console} tabIndex={0} aria-label="Stem-Mixer" onKeyDown={handleKey}>
    <header className="mixer-header">
      <button type="button" className="sek" aria-label={t("stem_back")} title={t("stem_back")} onClick={onBack}>←</button>
      <h3>Stem-Mixer</h3>
      <div className="mixer-project">
        <strong title={job.request.name}>{job.request.name}</strong>
        <span>{mix.tracks.length} {t("stem_tracks_count")} · {rate} kHz{job.request.preview ? ` · ${t("stem_preview")}` : ""}</span>
      </div>
      {dirty && !job.request.preview && <span className="mixer-unsaved" role="status">{t("stem_unsaved")}</span>}
      {onOpenProject && projects.length > 1 && <label className="mixer-project-choice">
        {t("stem_version")}
        <select value={job.id} onChange={event => {
          const next = projects.find(item => item.id === event.target.value);
          if (next) onOpenProject(next);
        }}>
          {projects.map(item => <option key={item.id} value={item.id}>{item.request.name} · {item.request.pin.model}</option>)}
        </select>
      </label>}
      <div className="mixer-header-actions">
        {onNewSeparation && <button type="button" className="sek" onClick={() => { transport.play(false); onNewSeparation(); }}>{t("stem_new")}</button>}
        <button type="button" className="sek" onClick={onClose}>{t("library")}</button>
      </div>
    </header>
    <MixerTransportPanel job={job} mix={mix} transport={transport} original={original} compare={value => { setOriginal(value); transport.compare(value); }}
      change={patch => edit(current => ({ ...current, ...patch }))} />
    <div className="mixer-tools">
      <button type="button" className="sek mini" disabled={!history.past.length} onClick={history.undo}>{t("stem_undo")}</button>
      <button type="button" className="sek mini" disabled={!history.future.length} onClick={history.redo}>{t("stem_redo")}</button>
      <button type="button" className="sek mini" onClick={() => edit(current => ({
        ...current, master_db: 0, master_comp: 0, master_limit: 0, master_off: false, tracks: current.tracks.map(resetTrack),
      }))}>{t("stem_reset_mix")}</button>
      <button type="button" className="sek mini" disabled={!solo} onClick={() => edit(current => ({
        ...current, tracks: current.tracks.map(track => ({ ...track, solo: false })),
      }))}>{t("stem_clear_solos")}</button>
      {solo && <span className="mixer-solo-status" role="status">{t("stem_solo_active")}</span>}
      {!job.request.preview && <button type="button" className="sek mini" disabled={importing || mix.tracks.length >= 32}
        onClick={() => void addTrack()}>{t("stem_add_track")}</button>}
      <details><summary>{t("stem_sources")}</summary><div className="mixer-source-popover">
        <p>{job.source.name} · {(project.source_start_frame / job.source.audio.rate).toFixed(2)} s</p>
        <button type="button" className="sek mini" disabled={importing} onClick={() => void relink()}>{t("stem_relink_source")}</button>
      </div></details>
    </div>
    {!transport.ready && !transport.error && <p className="small" role="status">{t("stem_preparing")}</p>}
    {(missing || Boolean(transport.error)) && <div className="mixer-warning" role="alert">
      {missing ? t("stem_mix_incomplete") : stemError(transport.error, t)}
      {Boolean(transport.missing.original) && <span> · {t("stem_original")}: {stemError(transport.missing.original, t)}</span>}
      <button type="button" className="sek mini" onClick={transport.retry}>{t("settings_retry")}</button>
    </div>}
    {readError && <p className="err" role="alert">{readError}</p>}
    <div className="mixer-board">
      <div className="mixer-bank" tabIndex={0} aria-label={t("stem_tracks_bank")}>
        {mix.tracks.map((track, index) => {
          const failure = transport.missing[track.replacement ?? track.role];
          return <StemChannel key={track.role} track={track} index={index} rate={project.rate} duration={project.frames / project.rate}
            store={transport} gesture={gesture} focused={focused === track.role} focus={() => setFocused(track.role)} audible={audible.includes(track)}
            excluded={solo && !track.solo} error={failure ? stemError(failure, t) : undefined} change={patch => changeTrack(track.role, patch)}
            reset={() => changeTrack(track.role, resetTrack(track))} replace={!job.request.preview && !importing ? () => void addTrack(track) : undefined}
            remove={track.role.startsWith("layer_") ? () => edit(current => ({ ...current, tracks: current.tracks.filter(item => item.role !== track.role) })) : undefined} />;
        })}
      </div>
      <MixerMaster mix={mix} mono={mono} toggleMono={() => { setMono(!mono); transport.setMono(!mono); }}
        store={transport} gesture={gesture} change={patch => edit(current => ({ ...current, ...patch }))} />
    </div>
    {error && <p className="err" role="alert">{error}</p>}
    {!job.request.preview && <StemExports job={job} mix={mix} selected={selected} controls={projectControls} missing={transport.missing} />}
  </section>;
}
