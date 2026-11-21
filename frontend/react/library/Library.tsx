import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orderedAudioFormats } from "../../audio-formats";
import { backend } from "../../backend";
import { DownloadFormatMenu } from "../../DownloadFormatMenu";
import { bundledProfile } from "../../expert-mode";
import { exportFolder } from "../../exports";
import type { ModelSelection, Song } from "../../types";
import { useI18n } from "../i18n";
import { foldersQuery, invalidateLibrary, queueQuery, settingsQuery, songPageQuery } from "../data";
import { GenerationStatus } from "../generation/GenerationStatus";
import { Dialog, ErrorState, LoadingState } from "../ui";
import { SongRow } from "./SongRow";

const PAGE_SIZE = 50;

export function Library({folder,onFolderChange,onReuse,selection,onReady,onError}: {
  folder:string;onFolderChange:(folder:string)=>void;onReuse:(song:Song)=>void;selection:ModelSelection|null;onReady?:()=>void;onError?:(error:unknown)=>void;
}) {
  const {t,language}=useI18n(),client=useQueryClient();
  const [search,setSearch]=useState(""),[debounced,setDebounced]=useState(""),[favorites,setFavorites]=useState(false),[error,setError]=useState<unknown>(null);
  const [armed,setArmed]=useState(""),[nameDialog,setNameDialog]=useState<{id:string|null;name:string}|null>(null);
  const [paging,setPaging]=useState({folder,page:0});
  const page=paging.folder===folder?paging.page:0;
  const list=useRef<HTMLDivElement>(null);
  const folders=useQuery(foldersQuery()),songs=useQuery(songPageQuery({q:debounced,favorites,folder},page*PAGE_SIZE,PAGE_SIZE)),queue=useQuery(queueQuery()),settings=useQuery(settingsQuery());
  const formats=orderedAudioFormats(settings.data?.export_format,settings.data?.export_formats,settings.data?.mp3_available);
  const pageCount=Math.max(1,Math.ceil((songs.data?.total??0)/PAGE_SIZE));
  const pastLastPage=Boolean(songs.data)&&!songs.isPlaceholderData&&page>=pageCount;
  const changePage=(next:number)=>setPaging({folder,page:next});
  if(paging.folder!==folder||pastLastPage)setPaging({folder,page:Math.min(page,pageCount-1)});
  const previous=useRef(new Map<string,Song["status"]>()),[announcement,setAnnouncement]=useState<{key:string;title?:string}|null>(null);
  const mutate=useMutation({mutationFn:async(action:()=>Promise<unknown>)=>action(),onSuccess:()=>invalidateLibrary(client),onError:error=>setError(error)});
  useEffect(()=>{
    if(search===debounced)return;
    const timer=setTimeout(()=>{
      setDebounced(search);
      setPaging(current=>({...current,page:0}));
    },250);
    return()=>clearTimeout(timer);
  },[search,debounced]);
  useLayoutEffect(()=>{if(list.current)list.current.scrollTop=0;},[page,folder,favorites,debounced]);
  useEffect(()=>{if(folders.data&&folder&&folder!=="none"&&!folders.data.folders.some(value=>value.id===folder))onFolderChange("");},[folder,folders.data,onFolderChange]);
  useEffect(()=>{if(songs.isSuccess&&folders.isSuccess&&queue.isSuccess)onReady?.();},[songs.isSuccess,folders.isSuccess,queue.isSuccess,onReady]);
  useEffect(()=>{const failure=songs.error||folders.error||queue.error;if(failure)onError?.(failure);},[songs.error,folders.error,queue.error,onError]);
  useEffect(()=>{
    if(songs.isPlaceholderData||songs.isStale)return;
    for(const song of songs.data?.songs??[]){const was=previous.current.get(song.id);if(was&&was!==song.status&&["done","error"].includes(song.status))setAnnouncement({key:song.status==="done"?"an_done":"an_error",title:`${song.title||song.caption}${song.letter?` ${song.letter}`:""}`});previous.current.set(song.id,song.status);}
  },[songs.data,songs.isPlaceholderData,songs.isStale]);
  useEffect(()=>{
    if(!armed)return;
    const timer=setTimeout(()=>setArmed(""),3000);
    const cancel=(event:MouseEvent)=>{if(!(event.target instanceof Element)||!event.target.closest("[data-arm]"))setArmed("");};
    document.addEventListener("click",cancel,true);
    return()=>{clearTimeout(timer);document.removeEventListener("click",cancel,true);};
  },[armed]);
  const arm=(key:string)=>{if(armed===key){setArmed("");return true;}setArmed(key);setAnnouncement({key:"an_armed"});return false;};
  const current=folders.data?.folders.find(value=>value.id===folder),library=queue.data?.library;
  const zipLabel=t(current?"f_zip":"f_zip_all");
  const rememberedAce = selection && (!selection.language || bundledProfile(selection)?.capabilities.output_kind === "midi")
    ? settings.data?.model_profiles?.["ace-step"] ?? settings.data?.recommended_profiles?.find(profile => profile.provider === "ace-step")
    : undefined;
  function restore(song: Song) {
    onReuse(rememberedAce && !song.params.model_selection ? { ...song, params: { ...song.params, model_selection: rememberedAce } } : song);
  }
  const chip=(id:string,name:string,count:number)=><button key={id} type="button" className={`chip fold ${id===folder?"on":""}`} aria-pressed={id===folder} title={name} onClick={()=>onFolderChange(id)}
    onDragOver={event=>{if(id&&event.dataTransfer.types.includes("text/song"))event.preventDefault();}}
    onDrop={event=>{if(!id)return;event.preventDefault();const songId=event.dataTransfer.getData("text/song");if(songId)mutate.mutate(()=>backend.patch(songId,{folder_id:id==="none"?null:id}));}}>{name} <b>{count}</b></button>;
  return <section className="card min-h-0" aria-labelledby="libHeading">
    <div className="libhead"><div className="libtitle"><h2 id="libHeading" className="col-title" tabIndex={-1}>{t("library")}</h2><span id="libStats" className="sumhint">{library?.count?`${library.count} Songs · ${library.bytes>=1024**3?(library.bytes/1024**3).toLocaleString(language,{maximumFractionDigits:1})+" GB":(library.bytes/1024**2).toLocaleString(language,{maximumFractionDigits:0})+" MB"}`:""}</span></div>
      <input id="search" type="search" aria-label={t("search")} placeholder={t("search")} value={search} onChange={event=>setSearch(event.target.value)}/>
      <button type="button" id="onlyFav" className="sek icon" title={t("only_fav")} aria-label={t("only_fav")} aria-pressed={favorites} onClick={()=>{setFavorites(!favorites);changePage(0);}}>{favorites?"★":"☆"}</button>
    </div>
    <div id="folderBar" className="folderbar">
      {chip("",t("f_all"),folders.data?.all??0)}
      {Boolean(folders.data?.folders.length)&&chip("none",t("f_none"),folders.data?.none??0)}
      {folders.data?.folders.map(value=>chip(value.id,value.name,value.count))}
      <button type="button" className="chip add" title={t("f_new")} aria-label={t("f_new")} onClick={()=>setNameDialog({id:null,name:""})}>＋</button>
      <span className="fold-actions">{current&&<><button type="button" className="sek mini" onClick={()=>setNameDialog({id:current.id,name:current.name})}>{t("f_rename")}</button>
        <button type="button" className={`sek mini ${armed===`folder:${folder}`?"armed":""}`} data-arm={`folder:${folder}`} title={t("f_delete_q",current.name)} onClick={()=>{if(arm(`folder:${folder}`))mutate.mutate(async()=>{await backend.deleteFolder(folder);onFolderChange("");});}}>{t(armed===`folder:${folder}`?"f_delete_sure":"f_delete")}</button></>}
        <DownloadFormatMenu formats={formats} label={zipLabel} menuLabel={t("download_zip_format")} originalLabel={t("download_original")}
          className="download mini" title={t("f_zip_tip")} disabled={mutate.isPending}
          onChoose={format=>mutate.mutate(()=>exportFolder(folder,format))}>{zipLabel}</DownloadFormatMenu></span>
    </div>
    {(pageCount>1||page>0)&&<nav className="library-pages" aria-label={t("lib_pages")}>
      <button type="button" className="sek mini" aria-controls="library" disabled={page===0} onClick={()=>changePage(page-1)}>{t("lib_prev")}</button>
      <span aria-live="polite" aria-atomic="true">{songs.data&&t("lib_page",(page+1).toLocaleString(language),pageCount.toLocaleString(language))}</span>
      <button type="button" className="sek mini" aria-controls="library" disabled={page+1>=pageCount} onClick={()=>changePage(page+1)}>{t("lib_next")}</button>
    </nav>}
    <div className="sr-only" role="status" aria-live="polite">{announcement&&t(announcement.key,announcement.title??"")}</div>
    {(error||songs.error||folders.error||queue.error)&&<ErrorState error={error||songs.error||folders.error||queue.error} retry={()=>{setError(null);void invalidateLibrary(client);}}/>}
    {(!songs.data?.songs.some(song=>song.status==="running") || songs.isPlaceholderData) && <GenerationStatus className="library-generation-status" />}
    <div id="library" ref={list} aria-busy={songs.isPending||songs.isPlaceholderData}>{songs.isPending||songs.isPlaceholderData?<LoadingState/>:!songs.data?.songs.length?<div className="empty">{t("empty")}</div>:songs.data.songs.map((song,index)=><SongRow key={song.id} song={song} folders={folders.data?.folders??[]} selection={rememberedAce??selection} onReuse={restore} armed={armed===`song:${song.id}`} onArm={()=>arm(`song:${song.id}`)} onError={error=>setError(error)} newGroup={index>0&&songs.data.songs[index-1].group_id!==song.group_id} exportFormats={formats} queueProgress={queue.data?.progress}/>)}</div>
    <Dialog open={nameDialog!==null} title={t("f_name_q")} busy={mutate.isPending} onClose={()=>setNameDialog(null)}><form onSubmit={event=>{event.preventDefault();if(!nameDialog?.name.trim()||mutate.isPending)return;const value=nameDialog;mutate.mutate(async()=>{const next=await backend.saveFolder(value.name,value.id);setNameDialog(null);if(!value.id)onFolderChange(next.id);});}}>
      <label className="field">{t("f_name_q")}<input autoFocus maxLength={60} value={nameDialog?.name??""} onChange={event=>setNameDialog(previous=>previous?{...previous,name:event.target.value}:null)}/></label>
      <div className="submit"><button type="button" className="sek" disabled={mutate.isPending} onClick={()=>setNameDialog(null)}>{t("cancel")}</button><button className="aktion" disabled={mutate.isPending}>{t("save")}</button></div>
    </form></Dialog>
  </section>;
}
