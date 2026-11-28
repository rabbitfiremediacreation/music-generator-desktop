import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { audioFormats, type AudioFormat } from "../../audio-formats";
import { backend } from "../../backend";
import { DownloadFormatMenu } from "../../DownloadFormatMenu";
import { GenerationProgress } from "../../GenerationActivity";
import { exportSong } from "../../exports";
import { progressText } from "../../progress";
import { songErrorKey } from "../../song-errors";
import { songModel } from "../../song-model";
import { audioTime, songDuration, songDurationWarning, songMachineGeneratedBy } from "../../song-result";
import { songUsage } from "../../song-usage";
import type { Folder, JobProgress, ModelSelection, Song } from "../../types";
import { invalidateLibrary, queryKeys } from "../data";
import { useGenerationAdmission } from "../generation/admission";
import { useI18n } from "../i18n";
import { usePlayer } from "../player";
import type { StemStudioRequest } from "../stems/StemStudio";
import { SongArtwork } from "./SongArtwork";
import { useSongCoverAction, type CoverModel } from "./useSongCoverAction";
import { SongActionMenu } from "./SongActionMenu";
import { SongDetails } from "./SongDetails";
import { SongExportDialog, SongUsageBadges } from "./SongUsage";
import "./song-row.css";

interface Props {
  song: Song; folders: Folder[]; selection: ModelSelection | null; onReuse: (song: Song) => void; onRemix?: (song: Song) => void;
  armed: boolean; onArm: () => boolean; onDisarm: () => void; onError: (error: unknown) => void; newGroup: boolean; exportFormats: AudioFormat[];
  queueProgress?: JobProgress | null; onStems?: (request: StemStudioRequest) => void; coverModel?: CoverModel;
}

export function SongRow({ song, folders, selection, onReuse, onRemix, armed, onArm, onDisarm, onError, newGroup, exportFormats, queueProgress, onStems, coverModel }: Props) {
  const { t, language } = useI18n(), client = useQueryClient(), player = usePlayer(), admission = useGenerationAdmission();
  const publicDisclosureId = useId(), panelId = useId();
  const expanded = player.selectedSongId === song.id;
  const toggleDetails = () => player.selectSong(expanded ? null : song.id);
  const [editing, setEditing] = useState(false), [title, setTitle] = useState("");
  const [dragAllowed, setDragAllowed] = useState(true);
  const [pendingExport, setPendingExport] = useState<AudioFormat | null>(null);
  const edit = useRef<HTMLInputElement>(null);
  const liveProgress = useQuery<Record<string, JobProgress>>({ queryKey: queryKeys.progress, queryFn: async () => ({}), enabled: false }).data?.[song.id];
  const progress = liveProgress ?? (queueProgress?.job_id === song.id ? queueProgress : undefined);
  const change = useMutation({ mutationFn: (action: () => Promise<unknown>) => action(), onSuccess: () => invalidateLibrary(client), onError });
  const cover = useSongCoverAction(song, coverModel);
  const midi = song.output_kind === "midi";
  const audioExtension = audioFormats[exportFormats[0] ?? "wav"].extension ?? song.file?.split(".").pop();
  const audioFormat = audioExtension?.toUpperCase() || t("download_original");
  const canCancel = song.status === "queued" || song.status === "running";
  useEffect(() => { if (editing) { edit.current?.focus(); edit.current?.select(); } }, [editing]);
  const commit = () => {
    setEditing(false);
    if (title.trim() !== (song.title || "")) change.mutate(() => backend.patch(song.id, { title: title.trim() }));
  };
  const more = async (retry=false) => {
    try {
      const params = song.params as typeof song.params & { use_cot_caption?: boolean };
      const generation = {...params,title:song.title||"",folder_id:song.folder_id};
      if (!retry) {
        const capabilities = params.generation_profile?.capabilities;
        generation.model_selection = params.model_selection ?? selection ?? undefined;
        if (midi) generation.prompt = params.prompt || params.caption || song.caption;
        if (midi || capabilities?.prompt === false || params.bars !== undefined) delete generation.caption;
        const instrumental = generation.model_selection?.provider === "yue2" || params.remix
          ? params.instrumental === true || song.lyrics === "[Instrumental]"
          : midi || params.bars !== undefined || (capabilities?.instrumental === true && capabilities.lyrics === false);
        Object.assign(generation, { instrumental, keep_caption: params.use_cot_caption !== true, seed: -1, variants: 1, group_id: song.group_id });
      }
      await admission.start(generation,retry?song.id:undefined);
    } catch(error){onError(error);}
  };
  const meta = song.result_meta ?? {}, duration = songDuration(song), warning = songDurationWarning(song);
  const durationText = duration && (song.params.bars === undefined ? audioTime(meta.duration_limit ? Math.round(duration) : duration)
    : `${duration.toLocaleString(language, { maximumFractionDigits: 3 })} s`);
  const summary = [midi ? t("midi_format") : durationText, meta.bpm ? `${meta.bpm} BPM` : null, meta.keyscale, songModel(song).name]
    .filter((part): part is string => typeof part === "string" && !!part);
  const generatedBy = songMachineGeneratedBy(song);
  const canExport = song.status === "done" && !song.audio_missing;
  const usage = songUsage(song, language, t);
  const label = `${song.title || song.caption.split(",").slice(0, 3).join(",")}${song.letter ? ` ${song.letter}` : ""}`;
  const current = player.song?.id === song.id;

  return <article className={`song${current ? " playing" : ""}${expanded ? " selected" : ""}${newGroup ? " new-group" : ""}`} data-id={song.id} aria-label={label}
    onClick={event => {
      const target = event.target;
      if (target instanceof Element && event.currentTarget.contains(target) && !target.closest("button,input,a,select,dialog,.song-panel")) toggleDetails();
    }}
    draggable={folders.length > 0 && !editing && dragAllowed}
    onMouseDown={event => setDragAllowed(!(event.target as Element).closest("button,input,a,.song-panel,dialog"))}
    onDragStart={event => { if (!dragAllowed) { event.preventDefault(); return; } event.dataTransfer.setData("text/song", song.id); event.dataTransfer.effectAllowed = "move"; }}>
    <SongArtwork song={song} playing={current && player.playing} onPlay={() => { player.selectSong(song.id); player.play(song); }} />
    <div className="song-heading">
      {editing ? <input ref={edit} className="t-edit" aria-label={t("title")} value={title} onChange={event => setTitle(event.target.value)} onBlur={commit}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); commit(); } if (event.key === "Escape") { event.preventDefault(); setEditing(false); } }} /> :
        <h3><button type="button" className="t song-title" title={label} aria-controls={panelId} aria-expanded={expanded}
          onClick={toggleDetails}><span className="song-title-label">{label}</span></button></h3>}
      {summary.length > 0 && <div className="song-summary">{summary.map((part, i) => <span key={i} title={part}>{part}</span>)}</div>}
      <SongUsageBadges usage={usage} hasOutput={song.status === "done"} />
      {generatedBy && <div className="generated-disclosure" id={publicDisclosureId} role="note"><strong>{t("result_machine_generated", generatedBy)}</strong>{canExport && ` · ${t("result_public_disclosure")}`}</div>}
      {song.status === "queued" && <div className="s">{t("waiting")}</div>}
      {song.status === "cancelled" && <div className="s">{t("cancelled")}</div>}
      {song.status === "error" && <div className="s err" title={song.message ?? undefined}>{t("error")} · {t(songErrorKey(song.message || ""))}</div>}
      {song.audio_missing && <div className="s err">{t(midi ? "midi_missing" : "import_audio_missing")}</div>}
      {cover.pending && <span className="small" role="status">{t("desktop_progress_cover_art")}</span>}
      {(expanded || cover.failed) && cover.error && <p className="song-cover-error" role="alert">{t("cover_art_failed")} · {t(cover.error)}</p>}
      {!midi && warning && !song.audio_missing && <div className="s duration-warning" role="note">{t(`duration_${warning.code}`, audioTime(warning.actual_seconds), audioTime(warning.requested_seconds))}</div>}
    </div>
    <div className="actions">
      {song.status === "done" && <button type="button" className={`sek icon song-favorite${song.favorite ? " on" : ""}`} aria-label={t("fav")} title={t("fav")}
        aria-pressed={song.favorite} disabled={change.isPending} onClick={() => change.mutate(() => backend.patch(song.id, { favorite: !song.favorite }))}>{song.favorite ? "★" : "☆"}</button>}
      {canExport && (midi
        ? <button type="button" className="sek icon download fmt" aria-label={t("midi_export")} title={t("midi_export")} aria-describedby={generatedBy ? publicDisclosureId : undefined}
            disabled={change.isPending} onClick={() => change.mutate(() => exportSong(song))}>MIDI</button>
        : <DownloadFormatMenu formats={exportFormats} label={t("download")} menuLabel={t("download_format")} originalLabel={t("download_original")} language={language}
            className="sek icon download fmt" descriptionId={generatedBy ? publicDisclosureId : undefined} disabled={change.isPending} onChoose={setPendingExport}>{audioFormat}</DownloadFormatMenu>)}
      {canCancel && <button type="button" className="sek mini" disabled={change.isPending} onClick={() => change.mutate(() => backend.cancel(song.id))}>{t("cancel")}</button>}
      {["error", "cancelled"].includes(song.status) && <button type="button" className="sek mini" disabled={admission.busy} onClick={() => void more(true)}>{t("retry")}</button>}
      <SongActionMenu song={song} folders={folders} cover={cover.action} onReuse={onReuse} onRemix={onRemix} onStems={onStems}
        onRename={() => { setTitle(song.title || ""); setEditing(true); }} onVariant={() => void more()} variantBusy={admission.busy}
        change={change.mutate} busy={change.isPending || cover.pending} armed={armed} onDisarm={onDisarm}
        onDelete={() => { if (onArm()) change.mutate(async () => { await backend.remove(song.id); player.clear(song.id); }); }} />
    </div>
    {song.status === "running" && <GenerationProgress wave={false} className="song-generation-status" progress={progress}
      label={t("desktop_progress_generation")} remainingLabel={t("desktop_progress_remaining")}
      details={progress ? progressText(progress, t) : song.message || t("desktop_progress_generation")} />}
    <div id={panelId} className="song-panel" hidden={!expanded}>
      {expanded && <SongDetails song={song} usage={song.status === "done" ? usage : null} change={change.mutate} />}
    </div>
    {canExport && !midi && <SongExportDialog usage={usage} format={pendingExport} label={label} onClose={() => setPendingExport(null)}
      onExport={format => { setPendingExport(null); change.mutate(() => exportSong(song, false, format)); }} />}
  </article>;
}
