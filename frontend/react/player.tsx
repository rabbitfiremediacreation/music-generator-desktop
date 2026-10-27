import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Song } from "../types";
import { audioTime } from "../song-result";
import { useI18n } from "./i18n";

interface Waveform {
  load(url: string): Promise<void>; play(): Promise<void>; pause(): void; playPause(): Promise<void>;
  destroy(): void; on(event: string, callback: () => void): () => void; setVolume(volume: number): void;
  getCurrentTime(): number; getDuration(): number;
}
declare global { interface Window { WaveSurfer: {create(options: Record<string, unknown>): Waveform} } }

function saved<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback; } catch { return fallback; }
}
const PlayerContext = createContext<{
  song: Song | null; playing: boolean; played: Set<string>; play: (song: Song) => void;
  engine: React.RefObject<Waveform | null>; setPlaying: (value: boolean) => void; error: string; setError: (error: string) => void;
} | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [song, setSong] = useState<Song | null>(null), [playing, setPlaying] = useState(false), [error, setError] = useState("");
  const [played, setPlayed] = useState(() => {
    const value=saved<unknown>("played",[]);
    return new Set<string>(Array.isArray(value)?value.filter((id):id is string=>typeof id==="string"):[]);
  });
  const engine = useRef<Waveform | null>(null);
  const current = useRef<Song | null>(null);
  const play = useCallback((next: Song) => {
    if (current.current?.id === next.id && engine.current) { void engine.current.playPause().catch(cause => setError(String(cause))); return; }
    engine.current?.pause(); setPlaying(false); setError(""); current.current = next; setSong(next);
    setPlayed(previous => { const updated = new Set(previous).add(next.id); try {localStorage.setItem("played", JSON.stringify([...updated]));} catch { /* Playback remains available without storage. */ } return updated; });
  }, []);
  return <PlayerContext.Provider value={{ song, playing, played, play, engine, setPlaying, error, setError }}>{children}</PlayerContext.Provider>;
}
export function usePlayer() {
  const player = useContext(PlayerContext);
  if (!player) throw new Error("PlayerProvider missing");
  return player;
}

/** Keep one waveform alive across route changes and reject superseded audio loads. */
export function Player() {
  const { t } = useI18n();
  const { song, playing, engine, setPlaying, error, setError } = usePlayer();
  const waveform = useRef<HTMLDivElement>(null), footer = useRef<HTMLElement>(null), sequence = useRef(0);
  const [time, setTime] = useState("0:00 / 0:00");
  const [volume, setVolume] = useState(() => {
    const value=saved<unknown>("volume",1);
    return typeof value==="number"&&Number.isFinite(value)?Math.max(0,Math.min(1,value)):1;
  });
  const [muted, setMuted] = useState(() => saved<number>("muted", 0) === 1);
  const active = song !== null;
  useEffect(() => {
    if (!active || !waveform.current) return;
    const loadSequence = sequence;
    const css = getComputedStyle(document.documentElement);
    const instance = window.WaveSurfer.create({ container: waveform.current, height:44, barWidth:2, barGap:1, barRadius:2,
      waveColor:css.getPropertyValue("--border").trim() || "#2a2e38", progressColor:css.getPropertyValue("--accent2").trim() || "#d1a75c", cursorWidth:0 });
    engine.current = instance;
    const update = () => setTime(`${audioTime(instance.getCurrentTime())} / ${audioTime(instance.getDuration())}`);
    const offs = [instance.on("timeupdate", update), instance.on("ready", update), instance.on("play", () => setPlaying(true)), instance.on("pause", () => setPlaying(false)), instance.on("finish", () => setPlaying(false))];
    const resize = new ResizeObserver(() => document.documentElement.style.setProperty("--player-h", `${footer.current?.offsetHeight ?? 0}px`));
    if (footer.current) resize.observe(footer.current);
    return () => { loadSequence.current++; offs.forEach(off => off()); resize.disconnect(); instance.destroy(); engine.current = null; document.documentElement.style.removeProperty("--player-h"); };
  }, [active, engine, setPlaying]);
  useEffect(() => {
    if (!song?.url || !engine.current) return;
    const loadSequence = sequence;
    const instance = engine.current, version = ++loadSequence.current;
    void instance.load(song.url).then(() => { if (version === sequence.current) return instance.play(); }).catch(cause => { if (version === sequence.current) setError(String(cause)); });
    return () => { loadSequence.current++; };
  }, [song, active, engine, setError]);
  useEffect(() => {
    engine.current?.setVolume(muted ? 0 : volume);
    try {localStorage.setItem("volume", String(volume)); localStorage.setItem("muted", muted ? "1" : "0");} catch { /* Audio does not depend on saved preferences. */ }
  }, [volume, muted, active, engine]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.code === "Space" && active && !target?.closest('input,textarea,select,button,[role="button"],dialog,[contenteditable="true"]')) {
        event.preventDefault(); void engine.current?.playPause().catch(cause => setError(String(cause)));
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  }, [active, engine, setError]);
  return <footer id="player" ref={footer} hidden={!song}>
    <div className="player-in">
      <button id="playBtn" className="aktion round" aria-label={t("play")} onClick={() => {void engine.current?.playPause().catch(cause => setError(String(cause)));}}>{playing ? "❚❚" : "▶"}</button>
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
