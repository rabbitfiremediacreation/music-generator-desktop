import { useState } from "react";
import { backend } from "../../backend";
import { PopupMenu, PopupMenuItem } from "../../PopupMenu";
import type { Folder, Song } from "../../types";
import { useI18n } from "../i18n";
import type { StemStudioRequest } from "../stems/StemStudio";
import { Dialog } from "../ui";
import type { useSongCoverAction } from "./useSongCoverAction";

interface Props {
  song: Song; folders: Folder[]; cover: ReturnType<typeof useSongCoverAction>["action"];
  onRename: () => void; onReuse: (song: Song) => void; onRemix?: (song: Song) => void; onStems?: (request: StemStudioRequest) => void;
  onVariant: () => void; variantBusy: boolean; onDelete: () => void; onDisarm: () => void; armed: boolean; busy: boolean;
  change: (action: () => Promise<unknown>) => void;
}

export function SongActionMenu({ song, folders, cover, onRename, onReuse, onRemix, onStems, onVariant, variantBusy, onDelete, onDisarm, armed, busy, change }: Props) {
  const { t } = useI18n();
  const [moving, setMoving] = useState(false);
  const audio = song.status === "done" && song.output_kind !== "midi" && !song.audio_missing && song.path;
  const projects = song.stem_project_count ?? 0;
  const stemStatus = song.stem_status && ["queued", "running", "error"].includes(song.stem_status) ? t(`stem_${song.stem_status}`) : null;
  return <>
    <PopupMenu label={t("song_actions")} className="sek icon song-actions-trigger" triggerContent="•••" onDismiss={onDisarm}>
      {close => <>
        <PopupMenuItem close={close} onChoose={onRename}>{t("f_rename")}</PopupMenuItem>
        <PopupMenuItem close={close} onChoose={() => onReuse(song)}>{t("reuse")}</PopupMenuItem>
        <PopupMenuItem close={close} onChoose={onVariant} disabled={variantBusy}>{t("more")}</PopupMenuItem>
        {onRemix && audio && audio.toLowerCase().endsWith(".wav") &&
          <PopupMenuItem close={close} onChoose={() => onRemix(song)}>{t("workspace_remix")}</PopupMenuItem>}
        {onStems && !projects && audio &&
          <PopupMenuItem close={close} onChoose={() => onStems({ song })}>{t("stem_split")}</PopupMenuItem>}
        {onStems && (projects > 0
          ? <PopupMenuItem close={close} onChoose={() => onStems({ song, projects: true, openLatest: true })}>{t("stem_mixer")}</PopupMenuItem>
          : stemStatus && <PopupMenuItem close={close} onChoose={() => onStems({ song, projects: true })}>{t("stem_projects")} · {stemStatus}</PopupMenuItem>)}
        {cover && <PopupMenuItem close={close} onChoose={cover.run} disabled={cover.disabled}>{cover.label}</PopupMenuItem>}
        {folders.length > 0 && <PopupMenuItem close={close} onChoose={() => setMoving(true)} disabled={busy}>{t("move")}</PopupMenuItem>}
        {song.status !== "queued" && song.status !== "running" &&
          <PopupMenuItem close={armed ? close : undefined} onChoose={onDelete} disabled={busy}
            data-arm={`song:${song.id}`} className={`danger${armed ? " armed" : ""}`}>{t(armed ? "del_q" : "del")}</PopupMenuItem>}
      </>}
    </PopupMenu>
    {moving && <Dialog open title={t("move")} onClose={() => setMoving(false)}>
      <form onSubmit={event => {
        event.preventDefault();
        const folder_id = new FormData(event.currentTarget).get("folder")?.toString() || null;
        setMoving(false);
        if (folder_id !== song.folder_id) change(() => backend.patch(song.id, { folder_id }));
      }}>
        <label className="field">{t("move")}<select name="folder" defaultValue={song.folder_id ?? ""} autoFocus>
          <option value="">{t("f_none")}</option>
          {folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
        </select></label>
        <div className="submit"><button type="button" className="sek" onClick={() => setMoving(false)}>{t("cancel")}</button>
          <button className="aktion" type="submit">{t("save")}</button></div>
      </form>
    </Dialog>}
  </>;
}
