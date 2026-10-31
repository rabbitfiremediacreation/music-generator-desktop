import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useMutation } from "@tanstack/react-query";
import { backend } from "../../backend";
import { dialogDirectory, pathErrorText, rememberDialogFolder } from "../../path-dialogs";
import { modelErrorText } from "../../expert-mode";
import { describeIdea, type Melody } from "../../melody";
import type { ModelSelection } from "../../types";
import { useI18n } from "../i18n";
import { useRecorder } from "./useRecorder";

export interface AudioControlsProps {
  selection: ModelSelection | null;
  onAnalysis: (values: Record<string, unknown>, microphone: boolean) => void;
}

export function AudioControls({ selection, onAnalysis }: AudioControlsProps) {
  const { t } = useI18n();
  const mounted = useRef(false);
  const analyzing = useRef(false);
  const choosing = useRef(false);
  const [message, setMessage] = useState<{ key: string; argument?: string; error?: unknown; state?: string }>({ key: "" });
  const [drag, setDrag] = useState(false);
  const analysis = useMutation({ mutationKey: ["audio", "analyze"], mutationFn: (file: File) => backend.analyze(file, selection || undefined), networkMode: "always", retry: false });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (message.state !== "ok") return;
    const timer = setTimeout(() => setMessage({ key: "" }), 4000);
    return () => clearTimeout(timer);
  }, [message]);
  async function analyze(file?: File, idea?: Melody) {
    if (!file || analyzing.current) return;
    analyzing.current = true; setMessage({ key: "analyzing", argument: file.name, state: "busy" });
    try {
      const values = await analysis.mutateAsync(file);
      if (!mounted.current) return;
      onAnalysis(idea ? { ...values, caption: describeIdea(idea, String(values.caption || ""), String(values.keyscale || "")) } : values, Boolean(idea));
      setMessage({ key: idea ? "idea_ready" : "analyzed", argument: file.name, state: "ok" });
    } catch (error) { if (mounted.current) setMessage({ key: "", error, state: "err" }); }
    finally { analyzing.current = false; }
  }
  const recorder = useRecorder(async (file, idea) => analyze(file, idea), key => setMessage({ key, state: key === "an_rec_start" ? "" : "err" }), analysis.isPending);
  async function choose() {
    if (choosing.current || analyzing.current || recorder.active || recorder.busy) return;
    choosing.current = true;
    try {
      const chosen = await backend.pickAudioFile(await dialogDirectory("audio_import"), t("dialog_audio_import"), t("dialog_audio_filter"));
      if (!chosen || !mounted.current) return;
      rememberDialogFolder("audio_import", chosen.directory);
      await analyze(new File([new Uint8Array(chosen.data)], chosen.name));
    } catch (error) { if (mounted.current) setMessage({ key: "", error, state: "err" }); }
    finally { choosing.current = false; }
  }
  const text = message.error ? `${t("error")}: ${pathErrorText(modelErrorText(message.error, t))}` : message.key ? t(message.key, message.argument || "") : "";
  return <>
    <button type="button" id="dropzone" className={`logo-wrap ${drag ? "drag" : ""} ${message.state || ""}`} aria-label={t("drop_aria")} title={t("drop_title")} onClick={() => void choose()}
      onDragEnter={event => { event.preventDefault(); setDrag(true); }} onDragOver={event => { event.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDragEnd={() => setDrag(false)}
      onDrop={event => { event.preventDefault(); setDrag(false); if (!recorder.active && !recorder.busy) void analyze(event.dataTransfer.files[0]); }}>
      <svg className="logo" viewBox="0 0 84 84" aria-hidden="true"><defs><linearGradient id="logoGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#434445" /><stop offset="1" stopColor="#2b2c2c" /></linearGradient></defs><rect x="1" y="1" width="82" height="82" rx="14" fill="url(#logoGradient)" stroke="#2a2e38" /><g fill="#ddc8aa">{[12, 28, 44, 24, 36, 16].map((height, index) => <rect key={index} x={16 + index * 9} y={(84 - height) / 2} width="5" height={height} rx="2.5" />)}</g></svg>
      <span className={`dz-bubble ${text ? "show" : ""}`} role="status" aria-live="polite">{text}</span>
    </button>
    <button type="button" id="recBtn" className={`rec ${recorder.active ? "on" : ""} ${recorder.busy || analysis.isPending ? "busy" : ""}`} style={recorder.active ? { "--p": Math.min(1, recorder.seconds / 30) } as CSSProperties : undefined} aria-pressed={recorder.active} aria-label={t("rec_aria")} title={t("rec_aria")} disabled={recorder.busy || analysis.isPending}
      onPointerDown={event => { if (event.button === 0) void recorder.start(); }}
      onKeyDown={event => { if ((event.key === " " || event.key === "Enter") && !event.repeat) { event.preventDefault(); void recorder.start(); } }}
      onKeyUp={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); recorder.stop(); } }}
      onClick={event => { if (event.detail === 0) recorder.toggle(); }} onContextMenu={event => event.preventDefault()}>
      <svg className="rec-mic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" /></svg><span className="rec-time" aria-hidden="true">{recorder.active ? recorder.seconds : ""}</span>
    </button>
  </>;
}
