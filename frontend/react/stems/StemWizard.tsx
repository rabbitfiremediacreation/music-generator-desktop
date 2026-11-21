import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { sourceDuration, stemApi, stemError, type Pin, type StemRequest, type StemSource } from "../../stems";
import type { Song } from "../../types";
import { foldersQuery } from "../data";
import { useI18n } from "../i18n";
import { useStemCatalog, useStemJob } from "./data";
import { StemRuntimeRequirement } from "./StemModelTasks";
import { StemProjectEstimate } from "./StemProjectEstimate";
import { StemSourcePicker, type SourceRange } from "./StemSourcePicker";

const steps = ["stem_sources", "stem_goal", "stem_result"] as const;
const goals = ["multitrack", "vocal_pair", "vocals_only", "instrumental_only"] as const;
type Goal = typeof goals[number];

export function StemWizard({ song, initialSource, folderId, active = true, onQueued, onPreview, onOpenEngines, onOpenModels }: {
  song?: Song; initialSource?: StemSource; folderId?: string; active?: boolean; onQueued: (ids: string[]) => void; onPreview: (id: string) => void;
  onOpenEngines: () => void; onOpenModels: () => void;
}) {
  const { t } = useI18n();
  const catalog = useStemCatalog();
  const view = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [sources, setSources] = useState<StemSource[]>(() => initialSource ? [initialSource] : []);
  const [ranges, setRanges] = useState<Record<string, SourceRange>>({});
  const [failure, setFailure] = useState<string>();
  const [sourceErrors, setSourceErrors] = useState<string[]>([]);
  const [queued, setQueued] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [goal, setGoal] = useState<Goal>("multitrack");
  const [modelId, setModelId] = useState("");
  const [selected, setSelected] = useState<string[]>();
  const [quality, setQuality] = useState<StemRequest["quality"]>("standard");
  const [overlap, setOverlap] = useState(0.25);
  const [previewPosition, setPreviewPosition] = useState<number>();
  const [previewId, setPreviewId] = useState<string>();
  const [name, setName] = useState(() => initialSource?.name.slice(0, 150) ?? "");
  const [folder, setFolder] = useState(song?.folder_id ?? (folderId === "none" ? "" : folderId ?? ""));
  const folders = useQuery(foldersQuery());
  const preview = useStemJob(previewId);
  const engineReady = catalog.data?.engine_ready;
  const models = catalog.data?.models.filter(model => model.status === "ready" && model.active) ?? [];
  const model = models.find(model => model.id === modelId) ?? models[0];
  const pin = model?.active;
  const roles = goal === "multitrack" ? model?.roles ?? [] : goal === "vocal_pair" ? ["vocals", "instrumental"]
    : goal === "vocals_only" ? ["vocals"] : ["instrumental"];
  const outputs = selected ? roles.filter(role => selected.includes(role)) : roles;
  const source = sources[0];
  const previewRange = source ? ranges[source.id] : undefined;
  const previewStart = previewPosition ?? previewRange?.start ?? 0;
  const previewRunning = preview.data?.status === "queued" || preview.data?.status === "running";
  const canSeparate = Boolean(engineReady && pin && outputs.length);
  const canAdvance = step === 0 ? Boolean(engineReady && sources.length) : canSeparate;
  const canStart = canSeparate && sources.length > 0 && name.trim().length > 0;

  useEffect(() => {
    if (!active) view.current?.querySelectorAll("audio").forEach(audio => { if (!audio.paused) audio.pause(); });
  }, [active]);

  useEffect(() => {
    if (!song || !engineReady) return;
    let live = true;
    void stemApi.songSource(song.id).then(value => {
      if (live) {
        setSources(current => current.some(item => item.id === value.id) ? current : [value, ...current]);
        setName(current => current || value.name.slice(0, 150));
      }
    }, cause => { if (live) setFailure(stemError(cause, t)); });
    return () => { live = false; };
  }, [song, engineReady, t]);

  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setFailure(undefined);
    try { await action(); }
    catch (cause) { setFailure(stemError(cause, t)); }
    finally { busyRef.current = false; setBusy(false); }
  }

  function add(items: { name: string; source: StemSource | null; error: string | null }[]) {
    const good = items.flatMap(item => item.source ? [item.source] : []);
    setSources(current => [...current, ...good]);
    setName(current => current || good[0]?.name.slice(0, 150) || "");
    setSourceErrors(items.flatMap(item => item.error ? [`${item.name} · ${t(item.error)}`] : []));
  }

  async function drop(files: File[]) {
    const items = [];
    for (const file of files) {
      try { items.push({ name: file.name, source: await stemApi.upload(file), error: null }); }
      catch (cause) { items.push({ name: file.name, source: null, error: cause instanceof Error ? cause.message : String(cause) }); }
    }
    add(items);
  }

  function request(item: StemSource, revision: Pin, isPreview: boolean): StemRequest {
    const range = ranges[item.id] ?? { start: 0, end: null };
    const title = name.trim() || item.name.slice(0, 150);
    return {
      source_id: item.id, pin: revision,
      name: sources.length + queued > 1 && !isPreview ? `${title} · ${item.name}`.slice(0, 160) : title,
      folder_id: folder || null, start: isPreview ? previewStart : range.start,
      end: isPreview ? Math.min(previewStart + 12, range.end ?? sourceDuration(item)) : range.end,
      quality, overlap, outputs, preview: isPreview,
    };
  }

  async function startPreview() {
    if (!source || !pin || !canSeparate || previewRunning || (previewId && preview.isPending)) return;
    setPreviewId(await stemApi.start(request(source, pin, true)));
  }

  async function start() {
    if (!canStart || !pin) return;
    const ids: string[] = [];
    const remaining: StemSource[] = [];
    const errors: string[] = [];
    for (const item of sources) {
      try { ids.push(await stemApi.start(request(item, pin, false))); }
      catch (cause) { remaining.push(item); errors.push(`${item.name} · ${stemError(cause, t)}`); }
    }
    setSourceErrors(errors);
    if (!remaining.length) onQueued(ids);
    else if (ids.length) {
      setSources(remaining);
      setQueued(count => count + ids.length);
      setPreviewPosition(undefined);
      setPreviewId(undefined);
    }
  }

  return <div className="stem-wizard" ref={view} onPlay={event => {
    if (event.target instanceof HTMLAudioElement) {
      for (const audio of event.currentTarget.querySelectorAll("audio")) if (audio !== event.target) audio.pause();
    }
  }}>
    <ol className="stem-steps">{steps.map((key, index) => <li key={key} aria-current={index === step ? "step" : undefined}>{t(key)}</li>)}</ol>
    {catalog.isPending && <p role="status">{t("desktop_checking")}</p>}
    {catalog.error && <div>
      <p className="err" role="alert">{stemError(catalog.error, t)}</p>
      <button type="button" className="sek" onClick={() => void catalog.refetch()}>{t("settings_retry")}</button>
    </div>}
    <StemRuntimeRequirement catalog={catalog.data} onOpenEngines={onOpenEngines} />
    {engineReady && !models.length && <div>
      <p>{t("stem_model_missing")}</p>
      <button type="button" className="sek" onClick={onOpenModels}>{t("settings_page_stems")}</button>
    </div>}
    {queued > 0 && <p role="status">{t("stem_queued")} · {queued}</p>}
    {failure && <p className="err" role="alert">{failure}</p>}
    {sourceErrors.map((error, index) => <p className="err" role="alert" key={index}>{error}</p>)}
    {step === 0 && engineReady && <StemSourcePicker sources={sources} ranges={ranges} busy={busy} songName={song?.title || song?.caption}
      onImport={() => void run(async () => add(await stemApi.pickSources(t("stem_import"))))}
      onDrop={files => void run(() => drop(files))}
      onRemove={id => {
        setSources(current => current.filter(item => item.id !== id));
        if (source?.id === id) { setPreviewPosition(undefined); setPreviewId(undefined); }
      }}
      onRangeChange={(id, range) => {
        setRanges(current => ({ ...current, [id]: range }));
        if (source?.id === id) setPreviewPosition(undefined);
      }} />}
    {step === 1 && model && <>
      <div className="stem-row">
        <label className="field">{t("stem_goal")}<select value={goal} onChange={event => { setGoal(event.target.value as Goal); setSelected(undefined); }}>
          {goals.map(value => <option key={value} value={value}>{t(`stem_${value}`)}</option>)}
        </select></label>
        <label className="field">{t("stem_model")}<select value={model.id} onChange={event => { setModelId(event.target.value); setSelected(undefined); }}>
          {models.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}
        </select></label>
      </div>
      {model === models[0] && <p className="small">{t("stem_recommended")}</p>}
      <fieldset><legend>{t("stem_roles")}</legend>{roles.map(role => <label className="stem-check" key={role}>
        <input type="checkbox" checked={outputs.includes(role)} onChange={event => setSelected(event.target.checked ? [...outputs, role] : outputs.filter(value => value !== role))} />
        {t(`stem_role_${role}`)}
      </label>)}</fieldset>
      {outputs.includes("instrumental") && <p className="small">{t("stem_derived")}</p>}
      <details className="stem-block"><summary>{t("stem_advanced")}</summary>
        <div className="stem-row">
          <label className="field">{t("stem_quality")}<select value={quality} onChange={event => setQuality(event.target.value as StemRequest["quality"])}>
            <option value="standard">{t("stem_standard")}</option><option value="fast">{t("stem_fast")}</option>
          </select></label>
          <label className="field">{t("stem_overlap")}<input type="number" min={0} max={0.5} step={0.05} value={overlap} onChange={event => setOverlap(Number(event.target.value))} /></label>
        </div>
        <p className="small">{t("stem_cpu")}</p>
      </details>
      {source && <details className="stem-block"><summary>{t("stem_preview")}</summary>
        <p className="small">{t("stem_preview_hint")}</p>
        <label className="field">{t("stem_preview_position")}<input type="number" min={previewRange?.start ?? 0}
          max={previewRange?.end ?? sourceDuration(source)} step="any" value={previewStart} onChange={event => setPreviewPosition(Number(event.target.value))} /></label>
        <div className="stem-row">
          <button type="button" className="sek" disabled={busy || !canSeparate || previewRunning || Boolean(previewId && preview.isPending)}
            onClick={() => void run(startPreview)}>{t("stem_preview")}</button>
          {preview.data && <span role="status">{t(`stem_${preview.data.phase}`)}{preview.data.error && ` · ${t(preview.data.error)}`}</span>}
          {preview.data?.status === "done" && <button type="button" className="sek" onClick={() => onPreview(preview.data!.id)}>{t("stem_preview_result")}</button>}
          {preview.data && previewRunning && <button type="button" className="sek" disabled={busy}
            onClick={() => void run(async () => { await stemApi.cancel(preview.data!.id); })}>{t("cancel")}</button>}
        </div>
      </details>}
    </>}
    {step === 2 && <>
      <div className="stem-row">
        <label className="field">{t("stem_project_name")}<input maxLength={150} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
        <label className="field">{t("stem_project_folder")}<select value={folder} disabled={busy} onChange={event => setFolder(event.target.value)}>
          <option value="">{t("f_none")}</option>{folders.data?.folders.map(value => <option value={value.id} key={value.id}>{value.name}</option>)}
        </select></label>
      </div>
      <dl className="stem-summary">
        <dt>{t("stem_sources")}</dt><dd>{sources.map(item => `${item.name} (${ranges[item.id]?.start ?? 0}–${(ranges[item.id]?.end ?? sourceDuration(item)).toFixed(2)} s)`).join(", ")}</dd>
        <dt>{t("stem_model")}</dt><dd>{model && `${model.engine} ${model.engine_version} · ${model.name}`}{pin && <> · <code title={pin.revision}>{pin.revision.slice(0, 12)}</code></>}</dd>
        <dt>{t("stem_roles")}</dt><dd>{outputs.map(role => t(`stem_role_${role}`)).join(" · ")}</dd>
        <dt>{t("stem_quality")}</dt><dd>{t(`stem_${quality}`)} · CPU · {t("stem_overlap")} {Math.round(overlap * 100)}%</dd>
        <dt>{t("stem_storage")}</dt><dd>{t("stem_mixer")} · 44.1 kHz · WAV</dd>
        <StemProjectEstimate requests={canStart && pin ? sources.map(item => request(item, pin, false)) : []} />
      </dl>
    </>}
    <div className="stem-row">
      {step > 0 && <button type="button" className="sek" disabled={busy} onClick={() => setStep(value => value - 1)}>{t("stem_back")}</button>}
      {step < steps.length - 1 ? <button type="button" className="aktion" disabled={busy || !canAdvance}
        onClick={() => setStep(value => value + 1)}>{t("stem_continue")}</button> :
        <button type="button" className="aktion" disabled={busy || !canStart} onClick={() => void run(start)}>{t("stem_start")}</button>}
      {busy && <span className="small" role="status">{t(step === 2 ? "stem_preflighting" : "desktop_checking")}</span>}
    </div>
  </div>;
}
