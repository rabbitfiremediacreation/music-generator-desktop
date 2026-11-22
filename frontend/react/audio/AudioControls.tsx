import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useMutation } from "@tanstack/react-query";
import { backend } from "../../backend";
import { dialogDirectory, pathErrorText, rememberDialogFolder } from "../../path-dialogs";
import { modelErrorText } from "../../expert-mode";
import { describeIdea, type Melody } from "../../melody";
import type { ModelSelection } from "../../types";
import { WaveLogo } from "../../GenerationActivity";
import { useI18n } from "../i18n";
import { audioPermissionPrompt, confirmAudioPermission } from "../../audio-permission";
import { useRecorder } from "./useRecorder";

export interface AudioControlsProps {
  selection: ModelSelection | null;
  onAnalysis: (values: Record<string, unknown>, microphone: boolean) => void;
  enabled?: boolean;
  blocked?: boolean;
  generating?: boolean;
  unavailableHint?: string;
  referencePicker?: {
    label: string;
    descriptionId: string;
    selected: boolean;
    disabled: boolean;
    pick: () => void;
  };
}

export function AudioControls({ selection, onAnalysis, enabled = true, blocked = false, generating, unavailableHint, referencePicker }: AudioControlsProps) {
  const { t } = useI18n();
  const mounted = useRef(false);
  const analyzing = useRef(false);
  const [message, setMessage] = useState<{ key: string; argument?: string; error?: unknown; state?: string }>({ key: "" });
  const [drag, setDrag] = useState(false);
  const analysis = useMutation({
    mutationKey: ["audio", "analyze"],
    mutationFn: (run: () => Promise<Record<string, unknown> | null>) => run(),
    networkMode: "always",
    retry: false,
  });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (message.state !== "ok") return;
    const timer = setTimeout(() => setMessage({ key: "" }), 4000);
    return () => clearTimeout(timer);
  }, [message]);
  async function analyze(source: File | "dialog" | undefined, idea?: Melody) {
    if (!enabled || !source || analyzing.current) return;
    analyzing.current = true;
    let name = "";
    const started = (filename: string) => {
      name = filename;
      setMessage({ key: "analyzing", argument: filename, state: "busy" });
    };
    try {
      const values = await analysis.mutateAsync(async () => {
        const prompt = audioPermissionPrompt("analysis");
        if (source === "dialog") {
          const directory = await dialogDirectory("audio_import");
          if (!mounted.current) return null;
          return backend.pickAndAnalyzeAudio(directory, t("dialog_audio_import"), t("dialog_audio_filter"), selection, prompt, file => {
            if (!mounted.current) return;
            rememberDialogFolder("audio_import", file.directory);
            started(file.name);
          });
        }
        if (!idea && !await confirmAudioPermission(source.name, prompt)) return null;
        if (!mounted.current) return null;
        started(source.name);
        return backend.analyze(source, selection || undefined);
      });
      if (!values || !mounted.current) return;
      onAnalysis(idea ? { ...values, caption: describeIdea(idea, String(values.caption || ""), String(values.keyscale || "")) } : values, Boolean(idea));
      setMessage({ key: idea ? "idea_ready" : "analyzed", argument: name, state: "ok" });
    } catch (error) { if (mounted.current) setMessage({ key: "", error, state: "err" }); }
    finally { analyzing.current = false; }
  }
  const recorder = useRecorder(async (file, idea) => analyze(file, idea), key => setMessage({ key, state: key === "an_rec_start" ? "" : "err" }), !enabled || analysis.isPending);
  const text = message.error ? `${t("error")}: ${pathErrorText(modelErrorText(message.error, t))}` : message.key ? t(message.key, message.argument || "") : "";
  const canAnalyzeFile = enabled && !blocked && !recorder.active && !recorder.busy && !analysis.isPending;
  const pickForAnalysis = () => { if (canAnalyzeFile) void analyze("dialog"); };
  const fileLabel = referencePicker?.label ?? t("dialog_audio_import");
  const disabledHint = unavailableHint ?? t("audio_analysis_unavailable");
  return <>
    <button type="button" id="dropzone" className={`logo-wrap ${drag ? "drag" : ""} ${message.state || ""}`} disabled={!enabled || blocked}
      aria-label={t("drop_aria")} title={enabled ? t("drop_title") : disabledHint} onClick={pickForAnalysis}
      onDragEnter={event => { event.preventDefault(); setDrag(true); }} onDragOver={event => { event.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDragEnd={() => setDrag(false)}
      onDrop={event => { event.preventDefault(); setDrag(false); if (canAnalyzeFile) void analyze(event.dataTransfer.files[0]); }}>
      <WaveLogo className="logo" active={generating} />
      <span className={`dz-bubble ${text ? "show" : ""}`} role="status" aria-live="polite">
        {text}
        {message.state === "busy" && <progress className="song-activity-meter" aria-label={text} />}
      </span>
    </button>
    <div className="studio-audio-actions">
      <button type="button" id="recBtn" className={`rec ${recorder.active ? "on" : ""} ${recorder.busy || analysis.isPending ? "busy" : ""}`} style={recorder.active ? { "--p": Math.min(1, recorder.seconds / 30) } as CSSProperties : undefined} aria-pressed={recorder.active} aria-label={t("rec_aria")} title={enabled ? t("rec_aria") : disabledHint} disabled={!enabled || recorder.busy || analysis.isPending}
        onPointerDown={event => { if (event.button === 0) void recorder.start(); }}
        onKeyDown={event => { if ((event.key === " " || event.key === "Enter") && !event.repeat) { event.preventDefault(); void recorder.start(); } }}
        onKeyUp={event => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); recorder.stop(); } }}
        onClick={event => { if (event.detail === 0) recorder.toggle(); }} onContextMenu={event => event.preventDefault()}>
        <svg className="rec-mic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" /></svg><span className="rec-time" aria-hidden="true">{recorder.active ? recorder.seconds : ""}</span>
      </button>
      <button type="button" className={`rec reference-pick${referencePicker?.selected ? " has-reference" : ""}${!referencePicker && analysis.isPending ? " busy" : ""}`}
        aria-label={fileLabel} title={referencePicker || enabled ? fileLabel : disabledHint}
        disabled={referencePicker ? blocked || referencePicker.disabled : !canAnalyzeFile}
        aria-describedby={referencePicker?.descriptionId} onClick={referencePicker?.pick ?? pickForAnalysis}>
        <svg className="rec-mic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10zM13 3v7h7M7 15h2l1-2 2 4 2-3 1 1h2" />
        </svg>
      </button>
    </div>
  </>;
}
