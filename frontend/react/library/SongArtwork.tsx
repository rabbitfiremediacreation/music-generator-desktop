import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { WaveLogo } from "../../GenerationActivity";
import type { Song } from "../../types";
import { useI18n } from "../i18n";

/** Place the original beside the tile, or above/below it in a narrow window. */
function previewPosition(tile: DOMRect) {
  const gap = 8;
  const width = window.innerWidth, height = window.innerHeight;
  const right = width - tile.right - 2 * gap, left = tile.left - 2 * gap;
  const below = height - tile.bottom - 2 * gap, above = tile.top - 2 * gap;
  const horizontal = Math.min(512, Math.max(left, right), height - 2 * gap);
  const vertical = Math.min(512, Math.max(above, below), width - 2 * gap);
  if (horizontal >= vertical) {
    return { width: horizontal, left: right >= horizontal ? tile.right + gap : tile.left - gap - horizontal,
      top: Math.max(gap, Math.min(tile.top, height - horizontal - gap)) };
  }
  return { width: vertical, left: Math.max(gap, Math.min(tile.left, width - vertical - gap)),
    top: below >= vertical ? tile.bottom + gap : tile.top - gap - vertical };
}

export function SongArtwork({ song, playing, onPlay }: { song: Song; playing: boolean; onPlay: () => void }) {
  const { t } = useI18n();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [failedThumbnail, setFailedThumbnail] = useState<string>();
  const playable = song.status === "done" && song.output_kind !== "midi" && !song.audio_missing;
  const show = (element: HTMLElement) => { if (song.cover_url) setAnchor(element.getBoundingClientRect()); };
  const hide = () => setAnchor(null);
  useEffect(() => {
    if (!anchor) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") hide(); };
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", hide);
      window.removeEventListener("scroll", hide, true);
    };
  }, [anchor]);

  const thumb = song.cover_thumbnail_url;
  const error = song.status === "error" || song.audio_missing;
  const tile = <>
    {thumb && thumb !== failedThumbnail && <img src={thumb} alt={t("cover_art_image")} width={64} height={64}
      loading="lazy" decoding="async" draggable={false} onError={() => setFailedThumbnail(thumb)} />}
    {song.status === "running" ? <WaveLogo active /> : <span className="song-artwork-symbol" aria-hidden="true">
      {playable ? (playing ? "❚❚" : "▶") : error ? "!" : song.status === "cancelled" ? "✕" : song.status === "done" ? "♪" : "…"}
    </span>}
  </>;
  return <div className={`song-artwork${error ? " has-error" : ""}`} onMouseEnter={event => show(event.currentTarget)}
    onMouseLeave={hide} onFocus={event => { if (event.target.matches(":focus-visible")) show(event.currentTarget); }} onBlur={hide}>
    {playable ? <button type="button" onClick={onPlay} aria-label={t(playing ? "pause" : "play")} title={t(playing ? "pause" : "play")}>{tile}</button>
      : <div className="song-artwork-status" tabIndex={song.cover_url ? 0 : undefined} title={song.message ?? undefined}>{tile}</div>}
    {anchor && song.cover_url && createPortal(<img className="song-cover-preview" src={song.cover_url} alt="" aria-hidden="true"
      style={previewPosition(anchor)} draggable={false} onError={hide} />, document.body)}
  </div>;
}
