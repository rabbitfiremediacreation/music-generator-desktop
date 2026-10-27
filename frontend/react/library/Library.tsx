import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { backend } from "../../backend";
import { exportFolder } from "../../exports";
import type { ModelSelection, Song } from "../../types";
import { useI18n } from "../i18n";
import { foldersQuery, invalidateLibrary, queueQuery, settingsQuery, songsQuery } from "../data";
import { Dialog, ErrorState, LoadingState } from "../ui";
import { SongRow } from "./SongRow";

export function Library({folder,onFolderChange,onReuse,selection,onReady,onError}: {
  folder:string;onFolderChange:(folder:string)=>void;onReuse:(song:Song)=>void;selection:ModelSelection|null;onReady?:()=>void;onError?:(error:unknown)=>void;
}) {
  const {t,language}=useI18n(),client=useQueryClient();
  const [search,setSearch]=useState(""),[debounced,setDebounced]=useState(""),[favorites,setFavorites]=useState(false),[error,setError]=useState<unknown>(null);
  const [armed,setArmed]=useState(""),[nameDialog,setNameDialog]=useState<{id:string|null;name:string}|null>(null);
  const folders=useQuery(foldersQuery()),songs=useQuery(songsQuery({q:debounced,favorites,folder})),queue=useQuery(queueQuery()),settings=useQuery(settingsQuery());
  const previous=useRef(new Map<string,Song["status"]>()),[announcement,setAnnouncement]=useState("");
  const mutate=useMutation({mutationFn:async(action:()=>Promise<unknown>)=>action(),onSuccess:()=>invalidateLibrary(client),onError:setError});
  useEffect(()=>{const timer=setTimeout(()=>setDebounced(search),250);return()=>clearTimeout(timer);},[search]);
  useEffect(()=>{if(folders.data&&folder&&folder!=="none"&&!folders.data.folders.some(value=>value.id===folder))onFolderChange("");},[folder,folders.data,onFolderChange]);
  useEffect(()=>{if(songs.isSuccess&&folders.isSuccess&&queue.isSuccess)onReady?.();},[songs.isSuccess,folders.isSuccess,queue.isSuccess,onReady]);
  useEffect(()=>{const failure=songs.error||folders.error||queue.error;if(failure)onError?.(failure);},[songs.error,folders.error,queue.error,onError]);
  useEffect(()=>{
    for(const song of songs.data??[]){const was=previous.current.get(song.id);if(was&&was!==song.status&&["done","error"].includes(song.status))setAnnouncement(t(song.status==="done"?"an_done":"an_error",song.title||song.caption));previous.current.set(song.id,song.status);}
  },[songs.data,t]);
  useEffect(()=>{
    if(!armed)return;
    const timer=setTimeout(()=>setArmed(""),3000);
    const cancel=(event:MouseEvent)=>{if(!(event.target instanceof Element)||!event.target.closest("[data-arm]"))setArmed("");};
    document.addEventListener("click",cancel,true);
    return()=>{clearTimeout(timer);document.removeEventListener("click",cancel,true);};
  },[armed]);
  const arm=(key:string)=>{if(armed===key){setArmed("");return true;}setArmed(key);setAnnouncement(t("an_armed"));return false;};
  const current=folders.data?.folders.find(value=>value.id===folder),library=queue.data?.library;
  const chip=(id:string,name:string,count:number)=><button key={id} type="button" className={`chip fold ${id===folder?"on":""}`} aria-pressed={id===folder} title={name} onClick={()=>onFolderChange(id)}
    onDragOver={event=>{if(id&&event.dataTransfer.types.includes("text/song"))event.preventDefault();}}
    onDrop={event=>{if(!id)return;event.preventDefault();const songId=event.dataTransfer.getData("text/song");if(songId)mutate.mutate(()=>backend.patch(songId,{folder_id:id==="none"?null:id}));}}>{name} <b>{count}</b></button>;
  return <section className="card min-h-0" aria-labelledby="libHeading">
    <div className="libhead"><div className="libtitle"><h2 id="libHeading" className="col-title" tabIndex={-1}>{t("library")}</h2><span id="libStats" className="sumhint">{library?.count?`${library.count} Songs · ${library.bytes>=1024**3?(library.bytes/1024**3).toLocaleString(language,{maximumFractionDigits:1})+" GB":(library.bytes/1024**2).toLocaleString(language,{maximumFractionDigits:0})+" MB"}`:""}</span></div>
      <input id="search" type="search" aria-label={t("search")} placeholder={t("search")} value={search} onChange={event=>setSearch(event.target.value)}/>
      <button type="button" id="onlyFav" className="sek icon" title={t("only_fav")} aria-label={t("only_fav")} aria-pressed={favorites} onClick={()=>setFavorites(!favorites)}>{favorites?"★":"☆"}</button>
    </div>
    <div id="folderBar" className="folderbar">
      {chip("",t("f_all"),folders.data?.all??0)}
      {Boolean(folders.data?.folders.length)&&chip("none",t("f_none"),folders.data?.none??0)}
      {folders.data?.folders.map(value=>chip(value.id,value.name,value.count))}
      <button type="button" className="chip add" title={t("f_new")} aria-label={t("f_new")} onClick={()=>setNameDialog({id:null,name:""})}>＋</button>
      <span className="fold-actions">{current&&<><button type="button" className="sek mini" onClick={()=>setNameDialog({id:current.id,name:current.name})}>{t("f_rename")}</button>
        <button type="button" className={`sek mini ${armed===`folder:${folder}`?"armed":""}`} data-arm={`folder:${folder}`} title={t("f_delete_q",current.name)} onClick={()=>{if(arm(`folder:${folder}`))mutate.mutate(async()=>{await backend.deleteFolder(folder);onFolderChange("");});}}>{t(armed===`folder:${folder}`?"f_delete_sure":"f_delete")}</button></>}
        <button type="button" className="download mini" title={t("f_zip_tip")} onClick={()=>mutate.mutate(()=>exportFolder(folder))}>{t(current?"f_zip":"f_zip_all")}</button></span>
    </div>
    <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
    {(error||songs.error||folders.error||queue.error)&&<ErrorState error={error||songs.error||folders.error||queue.error} retry={()=>{setError(null);void invalidateLibrary(client);}}/>}
    <div id="library">{songs.isPending?<LoadingState/>:!songs.data?.length?<div className="empty">{t("empty")}</div>:songs.data.map((song,index)=><SongRow key={song.id} song={song} folders={folders.data?.folders??[]} selection={selection} onReuse={onReuse} armed={armed===`song:${song.id}`} onArm={()=>arm(`song:${song.id}`)} onError={setError} newGroup={index>0&&songs.data[index-1].group_id!==song.group_id} exportFormat={settings.data?.export_format??"wav"}/>)}</div>
    <Dialog open={nameDialog!==null} title={t("f_name_q")} busy={mutate.isPending} onClose={()=>setNameDialog(null)}><form onSubmit={event=>{event.preventDefault();if(!nameDialog?.name.trim()||mutate.isPending)return;const value=nameDialog;mutate.mutate(async()=>{const next=await backend.saveFolder(value.name,value.id);setNameDialog(null);if(!value.id)onFolderChange(next.id);});}}>
      <label className="field">{t("f_name_q")}<input autoFocus maxLength={60} value={nameDialog?.name??""} onChange={event=>setNameDialog(previous=>previous?{...previous,name:event.target.value}:null)}/></label>
      <div className="submit"><button type="button" className="sek" disabled={mutate.isPending} onClick={()=>setNameDialog(null)}>{t("cancel")}</button><button className="aktion" disabled={mutate.isPending}>{t("save")}</button></div>
    </form></Dialog>
  </section>;
}
