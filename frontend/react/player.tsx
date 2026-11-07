import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Song } from "../types";
import { audioTime } from "../song-result";
import { backend } from "../backend";
import { useI18n } from "./i18n";

interface Waveform {
  loadBlob(blob: Blob): Promise<void>; play(): Promise<void>; pause(): void; playPause(): Promise<void>;
  destroy(): void; on(event: string, callback: (error?: Error) => void): () => void; setVolume(volume: number): void;
  getCurrentTime(): number; getDuration(): number;
}
declare global { interface Window { WaveSurfer: {create(options: Record<string, unknown>): Waveform} } }

function saved<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; } catch { return fallback; }
}
const PlayerContext = createContext<{
  song: Song | null; playing: boolean; played: Set<string>; play: (song: Song) => void; clear: (id: string) => void;
  loadRevision: React.RefObject<number>;
  playback: React.RefObject<"loading" | "ready" | "error">;
  engine: React.RefObject<Waveform | null>; setPlaying: (value: boolean) => void; error: string; setError: (error: string) => void;
} | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [song, setSong] = useState<Song | null>(null), [playing, setPlaying] = useState(false), [error, setError] = useState("");
  const [played, setPlayed] = useState(() => {
    const value=saved<unknown>("played",[]);
    return new Set<string>(Array.isArray(value)?value.filter((id):id is string=>typeof id==="string"):[]);
  });
  const engine = useRef<Waveform | null>(null);
  const current = useRef<Song | null>(null), loadRevision = useRef(0);
  const playback = useRef<"loading" | "ready" | "error">("loading");
  const play = useCallback((next: Song) => {
    if (current.current?.id === next.id && engine.current && playback.current !== "error") {
      if (playback.current === "ready") {
        const version = loadRevision.current;
        void engine.current.playPause().catch(cause => {
          if (version !== loadRevision.current) return;
          playback.current = "error"; engine.current?.pause(); setPlaying(false); setError(String(cause));
        });
      }
      return;
    }
    loadRevision.current++;
    playback.current = "loading";
    engine.current?.pause(); setPlaying(false); setError(""); current.current = next; setSong({ ...next });
    setPlayed(previous => { const updated = new Set(previous).add(next.id); try {localStorage.setItem("played", JSON.stringify([...updated]));} catch { /* Playback remains available without storage. */ } return updated; });
  }, []);
  const clear = useCallback((id: string) => {
    if (current.current?.id !== id) return;
    loadRevision.current++; current.current = null; engine.current?.pause();
    setSong(null); setPlaying(false); setError("");
  }, []);
  return <PlayerContext.Provider value={{ song, playing, played, play, clear, loadRevision, playback, engine, setPlaying, error, setError }}>{children}</PlayerContext.Provider>;
}
export function usePlayer() {
  const player = useContext(PlayerContext);
  if (!player) throw new Error("PlayerProvider missing");
  return player;
}

/** Keep playback across route changes; isolate each song's media events and pending reads. */
export function Player() {
  const { t } = useI18n();
  const { song, playing, play, playback, engine, loadRevision: sequence, setPlaying, error, setError } = usePlayer();
  const waveform = useRef<HTMLDivElement>(null), footer = useRef<HTMLElement>(null);
  const [time, setTime] = useState("0:00 / 0:00");
  const [volume, setVolume] = useState(() => {
    const value=saved<unknown>("volume",1);
    return typeof value==="number"&&Number.isFinite(value)?Math.max(0,Math.min(1,value)):1;
  });
  const [muted, setMuted] = useState(() => saved<number>("muted", 0) === 1);
  const active = song !== null;
  useEffect(() => {
    if (!song || !waveform.current) return;
    const loadSequence = sequence;
    const version = ++loadSequence.current;
    setTime("0:00 / 0:00");
    const css = getComputedStyle(document.documentElement);
    const instance = window.WaveSurfer.create({ container: waveform.current, height:44, barWidth:2, barGap:1, barRadius:2,
      waveColor:css.getPropertyValue("--border").trim() || "#2a2e38", progressColor:css.getPropertyValue("--accent2").trim() || "#d1a75c", cursorWidth:0 });
    engine.current = instance;
    const fail = (cause: unknown) => {
      if (version !== sequence.current) return;
      loadSequence.current++; playback.current = "error";
      instance.pause(); setPlaying(false); setError(String(cause));
    };
    const update = () => setTime(`${audioTime(instance.getCurrentTime())} / ${audioTime(instance.getDuration())}`);
    // A media error can leave WaveSurfer's load promise waiting for metadata forever.
    const offs = [instance.on("timeupdate", update), instance.on("ready", update), instance.on("play", () => setPlaying(true)), instance.on("pause", () => setPlaying(false)), instance.on("finish", () => setPlaying(false)), instance.on("error", fail)];
    // Binary IPC avoids asset URL/path and custom-protocol media loading differences on Windows.
    void backend.songAudio(song.id).then(async bytes => {
      if (version !== sequence.current) return;
      await instance.loadBlob(new Blob([bytes]));
      if (version !== sequence.current) return;
      playback.current = "ready";
      await instance.play();
    }).catch(fail);
    const resize = new ResizeObserver(() => document.documentElement.style.setProperty("--player-h", `${footer.current?.offsetHeight ?? 0}px`));
    if (footer.current) resize.observe(footer.current);
    return () => { loadSequence.current++; offs.forEach(off => off()); resize.disconnect(); instance.destroy(); engine.current = null; document.documentElement.style.removeProperty("--player-h"); };
  }, [song, engine, sequence, playback, setPlaying, setError]);
  useEffect(() => {
    engine.current?.setVolume(muted ? 0 : volume);
    try {localStorage.setItem("volume", String(volume)); localStorage.setItem("muted", muted ? "1" : "0");} catch { /* Audio does not depend on saved preferences. */ }
  }, [volume, muted, song, engine]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.code === "Space" && active && !target?.closest('input,textarea,select,button,[role="button"],dialog,[contenteditable="true"]')) {
        event.preventDefault(); if (song) play(song);
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  }, [active, song, play]);
  return <footer id="player" ref={footer} hidden={!song}>
    <div className="player-in">
      <button id="playBtn" className="aktion round" aria-label={t("play")} onClick={() => {if (song) play(song);}}>{playing ? "❚❚" : "▶"}</button>
      <div className="pmeta"><div id="pTitle" title={`Seed ${song?.seed ?? ""}`}>{song?.title || song?.caption}</div><div id="waveform" ref={waveform} /></div>
      <span id="pTime" className="time">{time}</span>
      <div className="vol" id="vol" data-level={muted || volume === 0 ? "off" : volume < .5 ? "low" : "high"} style={{"--v":volume} as CSSProperties}>
        <button type="button" id="volBtn" className="sek icon" title={t(muted ? "unmute":"mute")} aria-label={t(muted ? "unmute":"mute")}
          onClick={() => {setMuted(!muted); if (muted && volume === 0) setVolume(.5);}}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path className="w1" d="M16 9a3.5 3.5 0 0 1 0 6"/><path className="w2" d="M18.5 6.5a7 7 0 0 1 0 11"/><path className="mx" d="M17 9l5 6M22 9l-5 6"/></svg>
        </button>
        <input id="volRange" type="range" min="0" max="100" step="1" value={Math.round(volume * 100)} aria-label={t("volume")} aria-valuetext={`${Math.round(volume * 100)} %`}
          onChange={event => {setVolume(Number(event.target.value)/100); setMuted(false);}} />
      </div>
    </div>{error && <p className="err" role="alert">{t("error")}: {error}</p>}
  </footer>;
}
