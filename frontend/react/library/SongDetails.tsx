import { useState } from "react";
import { exportSong } from "../../exports";
import type { SongUsage } from "../../song-usage";
import type { Song } from "../../types";
import { useI18n } from "../i18n";
import { SongFacts } from "./SongFacts";
import { SongUsageDetails } from "./SongUsage";

interface Props {
  song: Song; usage: SongUsage | null;
  change: (action: () => Promise<unknown>) => void;
}

export function SongDetails({ song, usage, change }: Props) {
  const { t } = useI18n();
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const audio = song.status === "done" && song.output_kind !== "midi";
  const supplied = song.engine === "yue2";
  const text = supplied ? song.lyrics : song.result_meta?.lyrics;
  const lyrics = audio && song.lyrics !== "[Instrumental]" && typeof text === "string" && text.replace(/\[[^\]]*\]/g, "").trim() ? text.trim() : "";
  return <>
    <SongFacts song={song} />
    {usage && <SongUsageDetails usage={usage} />}
    {song.stem_project_count && song.stem_status && ["queued", "running", "error"].includes(song.stem_status)
      ? <p className="small">{t("stem_jobs")} · {t(`stem_${song.stem_status}`)}</p> : null}
    {lyrics && <div>
      <button type="button" className="sek mini" aria-expanded={lyricsOpen} onClick={() => setLyricsOpen(!lyricsOpen)}>{t(supplied ? "lyrics" : "show_lyrics")}</button>
      {lyricsOpen && <div className="lyr-wrap"><pre className="lyr">{lyrics}</pre>
        <button type="button" className="download mini lyr-dl" title={t("lyrics_dl")} aria-label={t("lyrics_dl")} onClick={() => change(() => exportSong(song, true))}>TXT ↓</button>
      </div>}
    </div>}
  </>;
}
