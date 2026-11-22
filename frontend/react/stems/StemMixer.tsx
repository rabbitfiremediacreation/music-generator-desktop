import { useEffect, useEffectEvent, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { audibleTracks, defaultMix, defaultTrack, stemApi, stemError, upgradeMix, type MixVersion, type StemJob, type StemLayer, type StemMix, type StemProject, type StemSource, type Track } from "../../stems";
import { defaultFxReturns, fxSlots, initialFxReturns, mapFxSlots, returnEnabled, returnSoloActive, type FxReturn, type FxSlot } from "../../stem-returns";
import { useI18n } from "../i18n";
import { StemChannel } from "./StemChannel";
import { MixerMaster } from "./MixerMaster";
import { MixerEffectReturn } from "./MixerEffectReturn";
import { MixerTransportPanel } from "./MixerTransport";
import { LiveEqDialog } from "./LiveEqDialog";
import { GenerateStemTrack } from "./GenerateStemTrack";
import { StemGenerationStatus } from "./StemGenerationStatus";
import { SpectralRepair } from "./SpectralRepair";
import type { RepairTool } from "./repair-tools";
import { StemExports } from "./StemExports";
import { useStemJobs } from "./data";
import { useMixerHistory } from "./useMixerHistory";
import { useStemGeneration } from "./useStemGeneration";
import { useStemTransport } from "./useStemTransport";
import type { Pcm } from "./transport-core";
import "./mixer.css";

export function StemMixer({ job, onBack, onClose, onOpenProject, onNewSeparation, onOpenModels, active = true }: {
  job: StemJob; onBack: () => void; onClose: () => void; onOpenProject?: (project: StemJob) => void;
  onNewSeparation?: () => void; onOpenModels?: () => void; active?: boolean;
}) {
  const { t } = useI18n();
  const versions = useQuery({ queryKey: ["stem-mixes", job.id], queryFn: () => stemApi.mixes(job.id), networkMode: "always", retry: false });
  if (!job.project || versions.isPending) return <p role="status">{t("desktop_checking")}</p>;
  return <MixerEditor job={job} project={job.project} name={job.request.name} sourceAudio={job.source.audio}
    versions={versions.data ?? []} key={job.id} onBack={onBack} onClose={onClose} onOpenProject={onOpenProject}
    onNewSeparation={onNewSeparation} onOpenModels={onOpenModels} active={active}
    readError={versions.error ? stemError(versions.error, t) : undefined} />;
}

const noVersions: MixVersion[] = [];
type MixerProject = Pick<StemProject, "rate" | "frames" | "source_start_frame" | "source_frames" | "roles">;

export interface OriginalMixAudio {
  pcm: Pcm;
  rate: number;
  frames: number;
}

export function OriginalMixer({ audio, name, active, onBack, onClose, onNewSeparation }: {
  audio: OriginalMixAudio; name: string; active: boolean; onBack: () => void; onClose: () => void; onNewSeparation: () => void;
}) {
  const { rate, frames } = audio;
  const project = useMemo<MixerProject>(() => ({
    rate, frames, source_start_frame: 0, source_frames: frames, roles: ["original"],
  }), [rate, frames]);
  return <MixerEditor project={project} name={name} songAudio={audio.pcm} versions={noVersions}
    active={active} onBack={onBack} onClose={onClose} onNewSeparation={onNewSeparation} />;
}

function resetTrack(track: Track): Track {
  return { ...defaultTrack(track.role), name: track.name, replacement: track.replacement };
}

function MixerEditor({ job, project, name: projectName, sourceAudio, songAudio, versions, onBack, onClose, onOpenProject, onNewSeparation, onOpenModels, readError, active }: {
  job?: StemJob; project: MixerProject; name: string; sourceAudio?: StemSource["audio"]; songAudio?: Pcm;
  versions: MixVersion[]; onBack: () => void; onClose: () => void;
  onOpenProject?: (project: StemJob) => void; onNewSeparation?: () => void; onOpenModels?: () => void; readError?: string; active: boolean;
}) {
  const { t, language } = useI18n();
  const client = useQueryClient();
  const editableProject = Boolean(job && !job.request.preview);
  const console = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => console.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [active]);
  const related = useStemJobs(job?.source.song_id ?? undefined, job?.source.song_id ? undefined : job?.source.id,
    0, undefined, active && !!onOpenProject && editableProject);
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
  const [generating, setGenerating] = useState(false);
  const generation = useStemGeneration(editableProject ? job?.id : undefined);
  const returnToShow = useRef<FxSlot>(undefined);
  const [repairing, setRepairing] = useState<{ track: Track; tool: RepairTool; name: string; frame: number }>();
  const { mix, gesture, edit } = history;
  const returns = mix.fx_returns ?? defaultFxReturns;
  useEffect(() => {
    const slot = returnToShow.current;
    if (slot === undefined) return;
    returnToShow.current = undefined;
    console.current?.querySelector(`[data-fx-slot="${slot}"]`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [mix.fx_returns]);
  const editedTrack = repairing ? mix.tracks.find(track => track.role === repairing.track.role) : undefined;
  const transport = useStemTransport(job?.id ?? "original", project, mix, songAudio);
  const { play } = transport;
  useEffect(() => { if (!active) play(false); }, [active, play]);
  const audible = audibleTracks(mix);
  const soloTracks = mix.tracks.some(track => track.solo);
  const soloReturns = returnSoloActive(returns);
  const dryExcluded = soloReturns && !soloTracks;
  const selected = mix.tracks.filter(track => track.export !== false).map(track => track.role);
  const dirty = baseline.mix !== JSON.stringify(mix) || baseline.name !== name;
  const canMonitorMix = !mix.tracks.length || mix.tracks.some(track => !transport.missing[track.replacement ?? track.role]);
  const original = !transport.missing.original && (originalSelected || !canMonitorMix);
  const missing = Object.keys(transport.missing).length > 0;
  const rate = new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(project.rate / 1000);

  function changeTrack(role: string, patch: Partial<Track>) {
    edit(current => ({ ...current, tracks: current.tracks.map(track => track.role === role ? { ...track, ...patch } : track) }));
  }

  function changeReturn(slot: FxSlot, settings: FxReturn) {
    edit(current => ({
      ...current, fx_returns: mapFxSlots(index => index === slot ? settings : (current.fx_returns ?? defaultFxReturns)[index]),
    }));
  }

  function toggleReturn(slot: FxSlot) {
    gesture.end();
    const settings = returns[slot];
    const enabled = !returnEnabled(settings);
    if (enabled) returnToShow.current = slot;
    const effect = settings.effect.kind === "off" ? defaultFxReturns[slot].effect : settings.effect;
    changeReturn(slot, { ...settings, enabled, effect });
  }

  function compareOriginal(value: boolean) {
    setOriginal(value);
    transport.compare(value);
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

  function appendTrack(layer: StemLayer) {
    edit(current => ({ ...current, tracks: [...current.tracks, { ...defaultTrack(layer.role), name: layer.name.slice(0, 80) }] }));
  }

  function closeGeneration() {
    setGenerating(false);
    if (generation.running) requestAnimationFrame(() => console.current?.focus({ preventScroll: true }));
  }

  const addGeneratedTrack = useEffectEvent(() => {
    const layer = generation.takeResult();
    if (!layer || mix.tracks.some(track => track.role === layer.role)) return;
    gesture.end();
    appendTrack(layer);
    if (generating) {
      compareOriginal(false);
      setGenerating(false);
    }
  });
  const alreadyAdded = mix.tracks.some(track => track.role === generation.result?.role);
  const canAppendGenerated = !importing && (alreadyAdded || mix.tracks.length < 32);
  useEffect(() => {
    if (generation.result && canAppendGenerated) addGeneratedTrack();
  }, [generation.result, canAppendGenerated]);

  function removeTrack(role: string) {
    gesture.end();
    edit(current => ({ ...current, tracks: current.tracks.filter(track => track.role !== role) }));
    setFocused(current => current === role ? undefined : current);
    console.current?.focus({ preventScroll: true });
  }

  async function addTrack(replace?: Track) {
    if (!job) return;
    setImporting(true); setError("");
    try {
      const imported = await stemApi.addTrack(job.id, t(replace ? "stem_replace_track" : "stem_add_track"));
      if (!imported) return;
      if (replace) changeTrack(replace.role, { replacement: imported.role });
      else appendTrack(imported);
    } catch (cause) { setError(stemError(cause, t)); }
    finally { setImporting(false); }
  }

  async function relink() {
    if (!job) return;
    setImporting(true); setError("");
    try {
      if (await stemApi.relink(job.source.id, t("stem_relink_source"))) transport.retry();
    } catch (cause) { setError(stemError(cause, t)); }
    finally { setImporting(false); }
  }

  async function save(asNew: boolean) {
    if (!job) return;
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
    if (repairing && repairing.tool !== "dynamic_eq") return;
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
        <strong title={projectName}>{projectName}</strong>
        <span>{mix.tracks.length} {t(mix.tracks.length === 1 ? "mix_single_track" : "stem_tracks_count")} · {rate} kHz{job?.request.preview ? ` · ${t("stem_preview")}` : ""}</span>
      </div>
      {dirty && editableProject && <span className="mixer-unsaved" role="status">{t("stem_unsaved")}</span>}
      {job && onOpenProject && projects.length > 1 && <label className="mixer-project-choice">
        {t("stem_version")}
        <select value={job.id} onChange={event => {
          const next = projects.find(item => item.id === event.target.value);
          if (next) onOpenProject(next);
        }}>
          {projects.map(item => <option key={item.id} value={item.id}>{item.request.name} · {item.request.pin.model}</option>)}
        </select>
      </label>}
      <div className="mixer-header-actions">
        <div className="mixer-edit-actions">
          <button type="button" className="sek mini" disabled={!history.past.length} onClick={history.undo}>{t("stem_undo")}</button>
          <button type="button" className="sek mini" disabled={!history.future.length} onClick={history.redo}>{t("stem_redo")}</button>
          <button type="button" className="sek mini" onClick={() => edit(current => ({
            ...current, master_db: 0, master_comp: 0, master_limit: 0, master_dynamics: undefined, master_off: false,
            fx_returns: initialFxReturns(),
            tracks: current.tracks.map(resetTrack),
          }))}>{t("stem_reset_mix")}</button>
        </div>
        {job && <div className="mixer-monitor" role="group" aria-label={t("stem_comparing")}>
          <button type="button" aria-pressed={original} disabled={!transport.ready || !!transport.missing.original}
            onClick={() => compareOriginal(true)}>{t("stem_original")}</button>
          <button type="button" aria-pressed={!original} disabled={!transport.ready || !canMonitorMix}
            onClick={() => compareOriginal(false)}>{t("stem_mix")}</button>
        </div>}
        {job && editableProject && <>
          <details className="mixer-header-menu" name={`mixer-actions-${job.id}`}>
            <summary className="sek">{t("stem_save_menu")}</summary>
            <div className="mixer-header-panel">{projectControls}</div>
          </details>
          <details className="mixer-header-menu" name={`mixer-actions-${job.id}`}>
            <summary className="sek">{t("stem_export_menu")}</summary>
            <div className="mixer-header-panel">
              <StemExports job={job} mix={mix} selected={selected} missing={transport.missing} />
            </div>
          </details>
        </>}
        {onNewSeparation && <button type="button" className="sek" onClick={() => { transport.play(false); onNewSeparation(); }}>{t(job ? "stem_new" : "stem_split")}</button>}
        <button type="button" className="sek" onClick={onClose}>{t("library")}</button>
      </div>
    </header>
    <MixerTransportPanel project={project} source={sourceAudio} mix={mix} transport={transport}
      change={patch => edit(current => ({ ...current, ...patch }))} />
    <div className="mixer-tools">
      <button type="button" className="sek mini" disabled={!soloTracks && !returns.some(settings => settings.solo)} onClick={() => edit(current => {
        const fxReturns = current.fx_returns;
        return {
          ...current, tracks: current.tracks.map(track => ({ ...track, solo: false })),
          fx_returns: fxReturns && mapFxSlots(slot => ({ ...fxReturns[slot], solo: false })),
        };
      })}>{t("stem_clear_solos")}</button>
      {(soloTracks || soloReturns) && <span className="mixer-solo-status" role="status">{t("stem_solo_active")}</span>}
      {editableProject && <button type="button" className="sek mini" disabled={importing || mix.tracks.length >= 32}
        onClick={() => void addTrack()}>{t("stem_add_track")}</button>}
      {editableProject && !generation.running && <button type="button" className="sek mini"
        disabled={importing || generation.occupied || mix.tracks.length >= 32}
        onClick={() => { gesture.end(); setGenerating(true); }}>{t("stem_layer_generate")}</button>}
      {generation.running && !generating && <div className="mixer-layer-generation">
        <StemGenerationStatus job={generation.running} />
        <button type="button" className="sek mini" disabled={generation.running.cancelling || !generation.running.progress}
          onClick={() => void generation.cancel()}>{t("cancel")}</button>
      </div>}
      <div className="mixer-return-switches" role="group" aria-label={t("stem_fx_returns")}>
        {fxSlots.map(slot => {
          const settings = returns[slot];
          const effect = settings.effect.kind === "off" ? defaultFxReturns[slot].effect : settings.effect;
          return <button key={slot} type="button" className="sek mini" aria-pressed={returnEnabled(settings)}
            title={t(`stem_fx_kind_${effect.kind}`)} onClick={() => toggleReturn(slot)}>FX {slot + 1}</button>;
        })}
      </div>
      {job && <details><summary>{t("stem_sources")}</summary><div className="mixer-source-popover">
        <p>{job.source.name} · {(project.source_start_frame / job.source.audio.rate).toFixed(2)} s</p>
        <button type="button" className="sek mini" disabled={importing} onClick={() => void relink()}>{t("stem_relink_source")}</button>
      </div></details>}
    </div>
    {!transport.ready && !transport.error && <p className="small" role="status">{t("stem_preparing")}</p>}
    {(missing || Boolean(transport.error)) && <div className="mixer-warning" role="alert">
      {missing ? t("stem_mix_incomplete") : stemError(transport.error, t)}
      {Boolean(transport.missing.original) && <span> · {t("stem_original")}: {stemError(transport.missing.original, t)}</span>}
      <button type="button" className="sek mini" onClick={transport.retry}>{t("settings_retry")}</button>
    </div>}
    {readError && <p className="err" role="alert">{readError}</p>}
    {error && <p className="err" role="alert">{error}</p>}
    {!generating && Boolean(generation.error || generation.running?.cancelError) &&
      <p className="err" role="alert">{stemError(generation.error || generation.running?.cancelError, t)}</p>}
    {generation.result && !canAppendGenerated && !importing && <p role="status" className="mixer-warning">{t("stem_layer_ready_no_space")}</p>}
    <div className="mixer-board-slot">
      <div className="mixer-board">
        <div className="mixer-bank" tabIndex={0} aria-label={t("stem_tracks_bank")}>
          {!mix.tracks.length && <p className="mixer-empty">{t("stem_empty_mix")}</p>}
          {mix.tracks.map((track, index) => {
            const failure = transport.missing[track.replacement ?? track.role];
            return <StemChannel key={track.role} track={track} index={index} rate={project.rate} duration={project.frames / project.rate}
              store={transport} gesture={gesture} focused={focused === track.role} focus={() => setFocused(track.role)}
              audible={!dryExcluded && audible.includes(track)} excluded={dryExcluded || (soloTracks && !track.solo)}
              error={failure ? stemError(failure, t) : undefined} change={patch => changeTrack(track.role, patch)}
              reset={() => changeTrack(track.role, resetTrack(track))} replace={editableProject && !importing ? () => void addTrack(track) : undefined}
              canRestore={editableProject && !importing}
              repair={!failure ? (tool, name) => {
                setRepairing({ track, tool, name, frame: transport.getPosition().frame });
                if (tool === "dynamic_eq") {
                  if (originalSelected) compareOriginal(false);
                } else transport.play(false);
              } : undefined}
              exportable={Boolean(job)}
              returns={returns}
              remove={() => removeTrack(track.role)} />;
          })}
          {fxSlots.filter(slot => returnEnabled(returns[slot])).map(slot => <MixerEffectReturn key={slot} slot={slot}
            settings={returns[slot]} rate={project.rate} store={transport} excluded={soloReturns && !returns[slot].solo}
            gesture={gesture} change={settings => changeReturn(slot, settings)} />)}
        </div>
        <MixerMaster mix={mix} mono={mono} toggleMono={() => { setMono(!mono); transport.setMono(!mono); }}
          store={transport} gesture={gesture} change={patch => edit(current => ({ ...current, ...patch }))} />
      </div>
    </div>
    {job && generating && <GenerateStemTrack mix={mix} generation={generation} onClose={closeGeneration} onManage={onOpenModels} />}
    {repairing?.tool === "dynamic_eq" && editedTrack && <LiveEqDialog id={job?.id} role={editedTrack.replacement ?? editedTrack.role}
      name={repairing.name} frame={repairing.frame} frames={project.frames} rate={project.rate}
      transport={transport} gesture={gesture} settings={editedTrack.dynamic_eq} onEdit={update => edit(current => ({
        ...current, tracks: current.tracks.map(track => {
          if (track.role !== editedTrack.role) return track;
          const dynamic_eq = update(track.dynamic_eq ?? { bands: [] });
          return { ...track, dynamic_eq: dynamic_eq.bands.length ? dynamic_eq : undefined };
        }),
      }))} onClose={() => { gesture.end(); setRepairing(undefined); }} />}
    {job && repairing && repairing.tool !== "dynamic_eq" && <SpectralRepair id={job.id} role={repairing.track.replacement ?? repairing.track.role} tool={repairing.tool}
      name={repairing.name} frame={repairing.frame} frames={project.frames} rate={project.rate}
      onApply={replacement => {
        changeTrack(repairing.track.role, { replacement });
        compareOriginal(false);
        setRepairing(undefined);
      }} onClose={() => setRepairing(undefined)} />}
  </section>;
}
