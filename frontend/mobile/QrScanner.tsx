import { useCallback, useEffect, useId, useRef, useState } from "react";
import { pairingToken } from "./client";
import type { Message } from "./messages";

type Translate = (key: Message) => string;
type Decoder = (video: HTMLVideoElement) => Promise<string | null>;
interface NativeDetector { detect(source: HTMLVideoElement): Promise<{ rawValue?: string }[]> }
interface DetectorConstructor { new(options: { formats: string[] }): NativeDetector }

async function decoder(): Promise<Decoder> {
  const Native = (window as Window & { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
  if (Native) {
    try {
      const detector = new Native({ formats: ["qr_code"] });
      let fallback: Promise<Decoder> | undefined;
      return async video => {
        try { return (await detector.detect(video))[0]?.rawValue || null; }
        catch { return (await (fallback ??= softwareDecoder()))(video); }
      };
    } catch { /* Some implementations do not support QR; use the bundled decoder. */ }
  }
  return softwareDecoder();
}

async function softwareDecoder(): Promise<Decoder> {
  const { default: decode } = await import("jsqr");
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("camera_unavailable");
  return async video => {
    if (!video.videoWidth || !video.videoHeight) return null;
    const scale = Math.min(1, 720 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return decode(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" })?.data || null;
  };
}

/** Camera permission is requested only in the Scan button's click handler. */
export function QrScanner({ t, onToken }: { t: Translate; onToken: (token: string) => void }) {
  const [open, setOpen] = useState(false), [opening, setOpening] = useState(false), [failure, setFailure] = useState<Message | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const scanButton = useRef<HTMLButtonElement>(null), cancelButton = useRef<HTMLButtonElement>(null);
  const video = useRef<HTMLVideoElement>(null), streamRef = useRef<MediaStream | null>(null), frame = useRef<number | null>(null), generation = useRef(0);
  const latest = useRef({ onToken, t }); latest.current = { onToken, t };
  const headingId = useId(), hintId = useId();
  const available = Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia);
  const stopCamera = useCallback(() => {
    generation.current++;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null;
    if (video.current) { video.current.pause(); video.current.srcObject = null; }
  }, []);
  const close = useCallback(() => { stopCamera(); setStream(null); setOpen(false); setOpening(false); scanButton.current?.focus(); }, [stopCamera]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) close(); };
    document.addEventListener("visibilitychange", hidden);
    return () => { document.removeEventListener("visibilitychange", hidden); stopCamera(); };
  }, [close, stopCamera]);
  useEffect(() => {
    if (!open || !stream || !video.current) return;
    const id = generation.current;
    const element = video.current;
    element.srcObject = stream;
    let active = true;
    const start = async () => {
      try {
        const [decode] = await Promise.all([decoder(), element.play()]);
        if (!active || generation.current !== id) return;
        setOpening(false);
        let last = 0;
        const scan = async (time: number) => {
          if (!active || generation.current !== id) return;
          if (time - last >= 180 && element.readyState >= 2) {
            last = time;
            try {
              const code = await decode(element);
              if (!active || generation.current !== id) return;
              if (code) {
                const token = pairingToken(code);
                if (token) { close(); latest.current.onToken(token); return; }
                setFailure("scanInvalid");
              }
            } catch { /* A frame can be unavailable while the camera changes exposure. */ }
          }
          if (active && generation.current === id) frame.current = requestAnimationFrame(time => void scan(time));
        };
        frame.current = requestAnimationFrame(time => void scan(time));
      } catch {
        if (active && generation.current === id) { stopCamera(); setStream(null); setOpening(false); setFailure("scanUnavailable"); }
      }
    };
    void start();
    return () => { active = false; if (frame.current !== null) cancelAnimationFrame(frame.current); };
  }, [stream, open, close, stopCamera]);
  async function startCamera() {
    if (!available) { setFailure(window.isSecureContext ? "scanUnsupported" : "scanHttp"); return; }
    stopCamera(); const id = generation.current;
    setOpen(true); setOpening(true); setFailure(null);
    try {
      const next = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      if (generation.current !== id || document.hidden) { next.getTracks().forEach(track => track.stop()); return; }
      streamRef.current = next; setStream(next);
    } catch (error) {
      if (generation.current !== id) return;
      setOpening(false);
      setFailure(error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError") ? "scanDenied" : "scanUnavailable");
    }
  }
  return <div className="qr-scanner">
    <button ref={scanButton} type="button" className="secondary wide scan-button" onClick={() => void startCamera()} aria-describedby={available ? undefined : hintId}>
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5M7 7h3v3H7zm7 0h3v3h-3zM7 14h3v3H7zm7 0h3v3h-3z" /></svg>{t("scan")}
    </button>
    {!available && <p id={hintId} className="fine">{t(window.isSecureContext ? "scanUnsupported" : "scanHttp")}</p>}
    {!open && failure && <p className="notice danger" role="alert">{t(failure)}</p>}
    {open && <section className="camera-panel" role="dialog" aria-modal="true" aria-labelledby={headingId} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); close(); } else if (event.key === "Tab") { event.preventDefault(); cancelButton.current?.focus(); } }}>
      <div className="camera-inner"><h2 id={headingId}>{t("scan")}</h2><p className="fine">{t("scanHint")}</p><div className="camera-preview"><video ref={video} muted playsInline aria-label={t("scanHint")} /><span className="camera-target" aria-hidden="true" /></div>{opening && <p className="fine" role="status">{t("scanOpening")}</p>}{failure && <p className="notice danger" role="alert">{t(failure)}</p>}<button ref={cancelButton} type="button" autoFocus className="secondary wide" onClick={close}>{t("scanCancel")}</button></div>
    </section>}
  </div>;
}
