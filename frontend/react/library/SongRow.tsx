import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { backend } from "../../backend";
import { exportSong } from "../../exports";
import { songErrorKey } from "../../song-errors";
import { generationSeconds } from "../../song-timing";
import { audioTime, songDuration, songDurationWarning, songIterations } from "../../song-result";
import type { Folder, Generation, JobProgress, ModelSelection, Song } from "../../types";
import { useI18n } from "../i18n";
import { invalidateLibrary, queryKeys } from "../data";
import { usePlayer } from "../player";
import { useGenerationAdmission } from "../generation/admission";
import { progressText } from "../../progress";

export function SongRow({song,folders,selection,onReuse,armed,onArm,onError,newGroup,exportFormat}: {
  song:Song;folders:Folder[];selection:ModelSelection|null;onReuse:(song:Song)=>void;
  armed:boolean;onArm:()=>boolean;onError:(error:unknown)=>void;newGroup:boolean;exportFormat:string;
}) {
  const { t } = useI18n(), client = useQueryClient(), player = usePlayer(), admission = useGenerationAdmission();
  const [editing,setEditing] = useState(false), [title,setTitle] = useState(""), [lyricsOpen,setLyricsOpen] = useState(false), [moving,setMoving] = useState(false);
  const [dragAllowed,setDragAllowed] = useState(true);
  const edit = useRef<HTMLInputElement>(null), moveMenu = useRef<HTMLDivElement>(null);
  const progress = useQuery<Record<string,JobProgress>>({queryKey:queryKeys.progress,queryFn:async()=>({}),enabled:false}).data?.[song.id];
  const change = useMutation({mutationFn:async (action:()=>Promise<unknown>)=>action(),onSuccess:()=>invalidateLibrary(client),onError});
  useEffect(() => { if (editing) {edit.current?.focus();edit.current?.select();} },[editing]);
  useEffect(() => {
    if (!moving) return;
    const close = (event:Event) => {if (!(event.target instanceof Node) || !moveMenu.current?.contains(event.target)) setMoving(false);};
    document.addEventListener("pointerdown",close);window.addEventListener("scroll",close,true);
    return()=>{document.removeEventListener("pointerdown",close);window.removeEventListener("scroll",close,true);};
  },[moving]);
  const commit = () => {if(!editing)return;setEditing(false);if(title.trim() !== (song.title||""))change.mutate(()=>backend.patch(song.id,{title:title.trim()}));};
  const more = async (retry=false) => {
    try {
      const params = song.params as Generation & {use_cot_caption?:boolean};
      await admission.start(retry ? {...params,title:song.title||"",folder_id:song.folder_id} : {...params,model_selection:params.model_selection??selection??undefined,instrumental:false,keep_caption:params.use_cot_caption!==true,title:song.title||"",seed:-1,variants:1,group_id:song.group_id,folder_id:song.folder_id},retry?song.id:undefined);
    } catch(error){onError(error);}
  };
  const action = (name:string,children:ReactNode,callback:()=>void,classes="",disabled=false) => <button type="button" className={`sek icon ${classes}`} title={name} aria-label={name} disabled={disabled} onClick={callback}>{children}</button>;
  const meta = song.result_meta ?? {}, duration=songDuration(song), iterations=songIterations(song), warning=songDurationWarning(song), took=generationSeconds(song);
  const label = `${song.title||song.caption.split(",").slice(0,3).join(",")}${song.letter?` ${song.letter}`:""}`;
  const lyrics = song.status==="done" && song.lyrics!=="[Instrumental]" && typeof meta.lyrics==="string" && /[^\s\[\]]/.test(meta.lyrics.replace(/\[[^\]]*\]/g,"")) ? meta.lyrics.trim():"";
  const info = [meta.bpm?`${meta.bpm}BPM`:null,iterations?`${iterations}IT`:null,song.params.lm_temperature!=null?`${song.params.lm_temperature.toFixed(1)}VAR`:null,meta.keyscale,duration?audioTime(duration):null].filter(Boolean).join(" · ");
  return <article className={`song ${player.song?.id===song.id?"playing":""}${newGroup?" new-group":""}`} data-id={song.id}
    aria-label={label} draggable={folders.length>0&&!editing&&dragAllowed} onMouseDown={event=>setDragAllowed(!(event.target as Element).closest("button,input,a,.lyr"))}
    onDragStart={event=>{if(!dragAllowed){event.preventDefault();return;}event.dataTransfer.setData("text/song",song.id);event.dataTransfer.effectAllowed="move";}}>
    {song.status==="done"&&!song.audio_missing ? action(t("play"),player.song?.id===song.id&&player.playing?"❚❚":"▶",()=>player.play(song),"round") : <div className={`slot ${song.status==="running"?"run":song.status==="error"||song.audio_missing?"err":""}`} title={song.message??undefined}>{song.audio_missing||song.status==="error"?"!":song.status==="running"?"♪":song.status==="cancelled"?"✕":"…"}</div>}
    <div className="min-w-0">
      {editing ? <input ref={edit} className="t-edit" aria-label={t("rename")} value={title} onChange={event=>setTitle(event.target.value)} onBlur={commit}
        onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();commit();}if(event.key==="Escape"){event.preventDefault();setEditing(false);}}}/> :
        <h3 className="m-0"><button type="button" className="t song-title" aria-label={`${label} · ${t("rename")}`} title={t("rename")} onClick={()=>{setTitle(song.title||"");setEditing(true);}}>{label}</button></h3>}
      <div className="m" title={t("meta_tip")}>{info}</div>
      {song.status==="running"&&<div className="generation-progress"><div className="s run">{progress?progressText(progress,t):song.message||"0:00"}</div>{progress?.total_steps&&progress.step!=null?<progress className="step-progress" max={progress.total_steps} value={progress.step} aria-label="DiT"/>:<div className="mini-bar" aria-hidden="true"/>}</div>}
      {song.status==="queued"&&<div className="s">{t("waiting")}</div>}
      {song.status==="cancelled"&&<div className="s">{t("cancelled")}</div>}
      {song.status==="error"&&<div className="s err" title={song.message??undefined}>{t("error")} · {t(songErrorKey(song.message||""))}</div>}
      {song.status==="done"&&!player.played.has(song.id)&&took!==null&&<div className="s took">{t("created_in")} {audioTime(took)}</div>}
      {song.status==="done"&&Boolean(meta.title_generation_error)&&<div className="s err" title={String(meta.title_generation_error)}>{t("title_failed")}</div>}
      {song.audio_missing&&<div className="s err">{t("import_audio_missing")}</div>}
      {warning&&!song.audio_missing&&<div className="s duration-warning" role="note">{t(`duration_${warning.code}`,audioTime(warning.actual_seconds),audioTime(warning.requested_seconds))}</div>}
    </div>
    <div className="actions relative">
      {song.status==="done"&&<button type="button" className={`sek icon ${song.favorite?"on":""}`} aria-label={t("fav")} title={t("fav")} aria-pressed={song.favorite} disabled={change.isPending} onClick={()=>change.mutate(()=>backend.patch(song.id,{favorite:!song.favorite}))}>{song.favorite?"★":"☆"}</button>}
      {song.status==="done"&&!song.audio_missing&&action(t("download"),exportFormat==="mp3"||song.file?.endsWith(".mp3")?"MP3":"WAV",()=>change.mutate(()=>exportSong(song)),"download fmt")}
      {lyrics&&action(t("show_lyrics"),"TXT",()=>setLyricsOpen(!lyricsOpen),`txt ${lyricsOpen?"on":""}`)}
      {folders.length>0&&<div ref={moveMenu}>{action(t("move"),"▱",()=>setMoving(!moving))}{moving&&<div className="song-move-menu" role="menu" onKeyDown={event=>{if(event.key==="Escape")setMoving(false);}}>{[{id:"none",name:t("f_none"),count:0},...folders].map(folder=><button role="menuitem" key={folder.id} className={(song.folder_id||"none")===folder.id?"on":""} onClick={()=>{setMoving(false);change.mutate(()=>backend.patch(song.id,{folder_id:folder.id==="none"?null:folder.id}));}}>{folder.name}</button>)}</div>}</div>}
      {action(t("more"),"＋",()=>{void more();},"",admission.busy)}
      {action(t("reuse"),"↑",()=>onReuse(song))}
      {["error","cancelled"].includes(song.status)&&action(t("retry"),"↻",()=>{void more(true);},"",admission.busy)}
      <button type="button" data-arm={`song:${song.id}`} className={`sek icon del ${armed?"armed":""}`} title={armed?t("del_q"):t(["queued","running"].includes(song.status)?"cancel":"del")} aria-label={armed?t("del_q"):t(["queued","running"].includes(song.status)?"cancel":"del")} disabled={change.isPending}
        onClick={()=>{if(["queued","running"].includes(song.status)||onArm())change.mutate(()=>backend.remove(song.id));}}>{armed?"?":"✕"}</button>
    </div>
    {lyrics&&lyricsOpen&&<div className="lyr-wrap"><pre className="lyr">{lyrics}</pre><button type="button" className="download mini lyr-dl" title={t("lyrics_dl")} aria-label={t("lyrics_dl")} onClick={()=>change.mutate(()=>exportSong(song,true))}>TXT ↓</button></div>}
  </article>;
}
