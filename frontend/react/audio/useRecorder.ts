import { useCallback, useEffect, useRef, useState } from "react";
import { measureMelody, toWav, type Melody } from "../../melody";
import { useI18n } from "../i18n";

interface Recording {
  stream: MediaStream; recorder: MediaRecorder; chunks: Blob[]; started: number;
  stopped: number; timer: ReturnType<typeof setInterval>; finish: () => void;
}

/** Permission replies, recorder callbacks and timers all belong to the mounted control. */
export function useRecorder(onRecorded: (file: File, idea: Melody) => Promise<void>, onMessage: (key: string) => void, disabled: boolean) {
  const { t } = useI18n();
  const callbacks = useRef({ onRecorded, onMessage, t, disabled });
  callbacks.current = { onRecorded, onMessage, t, disabled };
  const mounted = useRef(false);
  const recording = useRef<Recording | undefined>(undefined);
  const intent = useRef(false);
  const requesting = useRef(false);
  const processing = useRef(false);
  const permission = useRef(0);
  const delayed = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [active, setActive] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);

  const stop = useCallback(() => {
    intent.current = false; permission.current++; requesting.current = false;
    clearTimeout(delayed.current);
    const session = recording.current;
    if (!session || session.stopped) return;
    session.stopped = performance.now();
    clearInterval(session.timer);
    if (session.recorder.state === "recording") session.recorder.stop();
    session.stream.getTracks().forEach(track => track.stop());
  }, []);

  const start = useCallback(async () => {
    if (recording.current || requesting.current || processing.current || callbacks.current.disabled) return;
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) { callbacks.current.onMessage("rec_unsupported"); return; }
    intent.current = true; requesting.current = true;
    const current = ++permission.current;
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false } }); }
    catch { if (mounted.current && current === permission.current) { requesting.current = false; callbacks.current.onMessage("rec_denied"); } return; }
    if (!mounted.current || !intent.current || current !== permission.current) { stream.getTracks().forEach(track => track.stop()); return; }
    requesting.current = false;
    let recorder: MediaRecorder;
    try { recorder = new MediaRecorder(stream); }
    catch { stream.getTracks().forEach(track => track.stop()); callbacks.current.onMessage("rec_unsupported"); return; }
    const session: Recording = { stream, recorder, chunks: [], started: performance.now(), stopped: 0, timer: 0 as unknown as ReturnType<typeof setInterval>, finish: () => {} };
    const finish = async () => {
      clearInterval(session.timer); session.stream.getTracks().forEach(track => track.stop());
      if (recording.current === session) recording.current = undefined;
      if (!mounted.current) return;
      setActive(false); setSeconds(0);
      if ((session.stopped || performance.now()) - session.started < 5000) { callbacks.current.onMessage("rec_short"); return; }
      processing.current = true; setBusy(true);
      try {
        const { wav, mono, rate } = await toWav(new Blob(session.chunks, { type: recorder.mimeType }));
        if (!mounted.current) return;
        const idea = measureMelody(mono, rate) || { range: 5, rate: 2.5, drift: 0, legato: 0.8 };
        await callbacks.current.onRecorded(new File([wav], callbacks.current.t("rec_name"), { type: "audio/wav" }), idea);
      } catch (error) { if (mounted.current) callbacks.current.onMessage(error instanceof Error ? error.message : String(error)); }
      finally { processing.current = false; if (mounted.current) setBusy(false); }
    };
    session.finish = () => { void finish(); };
    recording.current = session;
    recorder.addEventListener("dataavailable", event => { if (event.data.size) session.chunks.push(event.data); });
    recorder.addEventListener("stop", session.finish, { once: true });
    recorder.addEventListener("error", () => { callbacks.current.onMessage("rec_unsupported"); stop(); }, { once: true });
    try { recorder.start(); }
    catch { recording.current = undefined; stream.getTracks().forEach(track => track.stop()); callbacks.current.onMessage("rec_unsupported"); return; }
    setActive(true); setSeconds(0);
    session.timer = setInterval(() => {
      const elapsed = (performance.now() - session.started) / 1000;
      setSeconds(Math.floor(elapsed)); if (elapsed >= 30) stop();
    }, 100);
  }, [stop]);

  const toggle = useCallback(() => {
    if (recording.current || intent.current || requesting.current) { stop(); return; }
    if (processing.current || callbacks.current.disabled) return;
    intent.current = true; callbacks.current.onMessage("an_rec_start");
    delayed.current = setTimeout(() => { if (intent.current) void start(); }, 1800);
  }, [start, stop]);

  useEffect(() => {
    mounted.current = true;
    window.addEventListener("pointerup", stop); window.addEventListener("pointercancel", stop); window.addEventListener("blur", stop);
    const keyboard = (event: KeyboardEvent) => { if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === "KeyR") { event.preventDefault(); toggle(); } };
    window.addEventListener("keydown", keyboard);
    return () => {
      mounted.current = false;
      const session = recording.current;
      if (session) session.recorder.removeEventListener("stop", session.finish);
      stop(); recording.current = undefined;
      window.removeEventListener("pointerup", stop); window.removeEventListener("pointercancel", stop); window.removeEventListener("blur", stop); window.removeEventListener("keydown", keyboard);
    };
  }, [stop, toggle]);
  return { active, seconds, busy, start, stop, toggle };
}
