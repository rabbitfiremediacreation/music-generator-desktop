import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { audioFormats, type AudioFormat } from "../../audio-formats";
import { audibleTracks, stemApi, stemError, stemRole, type ExportKind, type StemJob, type StemMix, type WaveFormat } from "../../stems";
import { settingsQuery } from "../data";
import { useI18n } from "../i18n";

type ExportAction = "tracks" | "mix" | "package";

export function StemExports({ job, mix, selected, controls, missing }: {
  job: StemJob; mix: StemMix; selected: string[]; controls: ReactNode; missing: Record<string, unknown>;
}) {
  const { t } = useI18n();
  const client = useQueryClient();
  const [action, setAction] = useState<ExportAction>();
  const [kind, setKind] = useState<"raw" | "processed">("raw");
  const [format, setFormat] = useState<AudioFormat>("wav");
  const [wave, setWave] = useState<WaveFormat>("float32");
  const [sampleRate, setSampleRate] = useState(44100);
  const [channels, setChannels] = useState(2);
  const [useRegion, setUseRegion] = useState(true);
  const [keepPosition, setKeepPosition] = useState(false);
  const [original, setOriginal] = useState(false);
  const [includeMix, setIncludeMix] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [destination, setDestination] = useState("");
  const settings = useQuery(settingsQuery());
  const formats = (settings.data?.export_formats ?? ["wav"]).filter(value => value !== "original");
  const history = useQuery({
    queryKey: ["stem-exports", job.id], queryFn: () => stemApi.exports(job.id), networkMode: "always",
    refetchInterval: query => query.state.data?.some(item => ["queued", "running"].includes(item.status)) ? 500 : false,
  });

  async function run(task: () => Promise<unknown>) {
    setBusy(true); setError("");
    try { await task(); await client.invalidateQueries({ queryKey: ["stem-exports", job.id] }); }
    catch (cause) { setError(stemError(cause, t)); }
    finally { setBusy(false); }
  }

  async function start() {
    if (!action) return;
    const snapshotKind: ExportKind = action === "tracks" ? kind : action;
    await stemApi.startExport({
      project_id: job.id, kind: snapshotKind, mix: snapshot, selected, format: action === "package" ? "wav" : format,
      wav_format: wave, sample_rate: outputRate, channels, keep_position: keepPosition, include_original: original, include_mix: includeMix,
    });
    setAction(undefined);
  }

  const rate = job.project!.rate;
  const fullRaw = action === "tracks" && kind === "raw" && !useRegion;
  const snapshot = fullRaw ? { ...mix, first: 0, end: job.project!.frames } : mix;
  const needs48k = action !== "package" && format === "ogg";
  const outputRate = needs48k ? 48000 : sampleRate;
  const audible = audibleTracks(mix);
  const exported = mix.tracks.filter(track => selected.includes(track.role));
  const missingStem = (track: typeof exported[number], processed: boolean) =>
    Boolean(missing[(processed && track.replacement) || track.role]);
  const incomplete = (action === "mix" || (action === "package" && includeMix)) && audible.some(track => missingStem(track, true))
    || (action === "tracks" || action === "package") && exported.some(track => missingStem(track, action === "tracks" && kind === "processed"));
  const needsTracks = (action === "tracks" || (action === "package" && !includeMix && !original)) && !selected.length;
  const names = (tracks: typeof audible) => tracks.map(track => track.name === track.role ? stemRole(track.role, t) : track.name).join(" · ");
  return <section className="stem-exports">
    <footer className="mixer-footer">
      {controls}
      <div className="mixer-export-actions">
        <button className="sek" type="button" aria-expanded={action === "tracks"} onClick={() => setAction(action === "tracks" ? undefined : "tracks")}>{t("stem_export_tracks")}</button>
        <button className="sek" type="button" aria-expanded={action === "package"} onClick={() => setAction(action === "package" ? undefined : "package")}>{t("stem_export_package")}</button>
        <button className="aktion" type="button" aria-expanded={action === "mix"} onClick={() => setAction(action === "mix" ? undefined : "mix")}>{t("stem_export_mix")}</button>
      </div>
    </footer>
    {action && <div className="stem-block">
      {action === "tracks" && <label className="field">{t("stem_selected")}<select value={kind} onChange={event => setKind(event.target.value as "raw" | "processed")}>
        <option value="raw">{t("stem_raw")}</option><option value="processed">{t("stem_processed")}</option>
      </select></label>}
      {action === "tracks" && kind === "processed" && <p className="small">{t("stem_processed_hint")}</p>}
      {action === "tracks" && kind === "raw" && <label className="stem-check"><input type="checkbox" checked={useRegion}
        onChange={event => setUseRegion(event.target.checked)} />{t("stem_export_region")}</label>}
      <p className="small">{names(action === "mix" ? audible : exported)}</p>
      {(action === "mix" || (action === "package" && includeMix)) && mix.tracks.some(track => track.solo) &&
        <p className="small">{t("stem_export_solo")}</p>}
      {incomplete && <p className="err" role="alert">{t("stem_mix_incomplete")}</p>}
      <div className="stem-row">
        {action !== "package" && <label className="field">{t("download_format")}<select value={format} onChange={event => setFormat(event.target.value as AudioFormat)}>
          {formats.map(value => <option key={value} value={value}>{audioFormats[value].label}</option>)}
        </select></label>}
        {(format === "wav" || action === "package") && <label className="field">WAV<select value={wave} onChange={event => setWave(event.target.value as WaveFormat)}>
          <option value="float32">32-bit float</option><option value="pcm24">24-bit PCM</option><option value="pcm16">16-bit PCM</option>
        </select></label>}
        <label className="field">{t("stem_export_rate")}<select value={outputRate} disabled={needs48k} onChange={event => setSampleRate(Number(event.target.value))}>
          <option value={44100}>44.1 kHz</option><option value={48000}>48 kHz</option>
        </select></label>
        <label className="field">{t("stem_export_channels")}<select value={channels} onChange={event => setChannels(Number(event.target.value))}>
          <option value={2}>Stereo</option><option value={1}>Mono</option>
        </select></label>
        <span className="small">{(snapshot.first / rate).toFixed(2)}–{(snapshot.end / rate).toFixed(2)} s</span>
        {action === "mix" && <span className="small">{t("stem_master")} {mix.master_off ? "−∞" : mix.master_db} dB</span>}
      </div>
      <label className="stem-check"><input type="checkbox" checked={keepPosition} onChange={event => setKeepPosition(event.target.checked)} />{t("stem_export_position")}</label>
      {action === "package" && <>
        <label className="stem-check"><input type="checkbox" checked={original} onChange={event => setOriginal(event.target.checked)} />{t("stem_export_original")}</label>
        <label className="stem-check"><input type="checkbox" checked={includeMix} onChange={event => setIncludeMix(event.target.checked)} />{t("stem_export_include_mix")}</label>
      </>}
      <button className="aktion" type="button" disabled={busy || incomplete || needsTracks} onClick={() => void run(start)}>
        {t(action === "mix" ? "stem_export_mix" : action === "tracks" ? "stem_export_tracks" : "stem_export_package")}
      </button>
    </div>}
    {(error || history.error) && <p className="err" role="alert">{error || stemError(history.error, t)}</p>}
    {destination && <p className="small" role="status">{destination}</p>}
    {Boolean(history.data?.length) && <details open>
      <summary>{t("stem_export_history")}</summary>
      {history.data?.map(item => <div className="stem-block" key={item.id}>
        <div className="stem-row">
          <span>{t(`stem_${item.status}`)}</span>
          {["queued", "running"].includes(item.status) && <>
            <progress value={item.progress} max={100} aria-label={t("stem_export_history")} />
            <button type="button" className="sek mini" onClick={() => void run(() => stemApi.cancelExport(item.id))}>{t("cancel")}</button>
          </>}
          {item.status === "done" && <>
            <button type="button" className="sek mini" disabled={busy} onClick={() => void run(async () => {
              const path = await stemApi.saveExport(item.id, t("stem_export_destination"));
              if (path) setDestination(path);
            })}>{t("stem_export_save")}</button>
            <button type="button" className="sek mini" onClick={() => void run(() => stemApi.openExport(item.id))}>{t("stem_open_folder")}</button>
          </>}
        </div>
        {item.error && <p className="err">{t(item.error)}</p>}
        {item.outputs.map(output => <p className="small" key={output.file}>{output.file}{output.peak !== null ? ` · ${output.peak > 0 ? (20 * Math.log10(output.peak)).toFixed(1) : "−∞"} dBFS` : ""}</p>)}
        {item.outputs.some(output => output.clipped || (output.peak ?? 0) > 1) && <p className="small err">{t("stem_export_clip")}</p>}
      </div>)}
    </details>}
  </section>;
}
