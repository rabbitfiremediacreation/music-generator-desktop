import { useEffect, useRef, useState } from "react";
import { stemApi, stemError, type RepairSelection } from "../../stems";
import { useI18n } from "../i18n";

type Mode = "before" | "after";
type Buffers = [AudioBuffer, AudioBuffer];
type Loop = ReturnType<typeof startLoop>;

interface Player {
  context: AudioContext;
  buffers?: Buffers;
  loop?: Loop;
}

/** Decode the paired, interleaved float32 stereo frames returned by the repair engine. */
function decode(context: AudioContext, bytes: ArrayBuffer, rate: number): Buffers {
  const length = bytes.byteLength / 16;
  if (!Number.isInteger(length) || length < 1) throw new Error("stem_spectral_failed");
  const before = context.createBuffer(2, length, rate);
  const after = context.createBuffer(2, length, rate);
  const channels = [before.getChannelData(0), before.getChannelData(1), after.getChannelData(0), after.getChannelData(1)];
  const samples = new DataView(bytes);
  const fade = Math.max(1, Math.min(Math.round(.005 * rate), Math.floor(length / 4)));
  for (let frame = 0; frame < length; frame++) {
    const gain = Math.min(1, Math.min(frame, length - 1 - frame) / fade);
    for (let channel = 0; channel < channels.length; channel++) {
      channels[channel][frame] = gain * samples.getFloat32((frame * 4 + channel) * 4, true);
    }
  }
  return [before, after];
}

/** Run both versions on the same sample clock so A/B switches keep their position. */
function startLoop(context: AudioContext, buffers: Buffers, mode: Mode) {
  const start = context.currentTime + .020;
  const nodes = buffers.map((buffer, index) => {
    const source = context.createBufferSource();
    const gain = context.createGain();
    const side = index === 0 ? "before" : "after";
    source.buffer = buffer;
    source.loop = true;
    gain.gain.value = mode === side ? 1 : 0;
    source.connect(gain);
    gain.connect(context.destination);
    source.start(start);
    return { source, gain, side };
  });
  return {
    select(next: Mode) {
      for (const { gain, side } of nodes) gain.gain.setTargetAtTime(next === side ? 1 : 0, context.currentTime, .004);
    },
    stop() {
      for (const { source, gain } of nodes) {
        source.stop();
        source.disconnect();
        gain.disconnect();
      }
    },
  };
}

export function SpectralAudition({ id, role, rate, selection }: {
  id: string; role: string; rate: number; selection?: RepairSelection;
}) {
  const { t } = useI18n();
  const player = useRef<Player>(null);
  const side = useRef<Mode>("before");
  const [mode, setMode] = useState<Mode>("before");
  const [phase, setPhase] = useState<"idle" | "loading" | "playing">("idle");
  const [error, setError] = useState("");
  useEffect(() => () => {
    const active = player.current;
    player.current = null;
    if (active) void active.context.close().catch(() => {});
  }, []);

  function select(next: Mode) {
    side.current = next;
    setMode(next);
    player.current?.loop?.select(next);
  }

  async function play() {
    if (!selection || phase !== "idle") return;
    setPhase("loading");
    setError("");
    let active = player.current;
    try {
      if (!active) {
        if (typeof AudioContext === "undefined") throw new Error("stem_audio_unavailable");
        active = { context: new AudioContext() };
        player.current = active;
      }
      const [, bytes] = await Promise.all([
        active.context.resume(), active.buffers ? undefined : stemApi.spectralAudition(id, role, selection),
      ]);
      if (player.current !== active) return;
      const buffers = bytes ? decode(active.context, bytes, rate) : active.buffers;
      if (!buffers) throw new Error("stem_spectral_failed");
      active.buffers = buffers;
      active.loop = startLoop(active.context, active.buffers, side.current);
      setPhase("playing");
    } catch (cause) {
      if (player.current !== active) return;
      setError(stemError(cause, t));
      setPhase("idle");
    }
  }

  function stop() {
    const active = player.current;
    if (active) {
      active.loop?.stop();
      active.loop = undefined;
    }
    setPhase("idle");
  }

  return <div className="spectral-audition">
    <button type="button" className="sek" disabled={!selection || phase === "loading"}
      onClick={phase === "playing" ? stop : () => void play()}>
      {t(phase === "playing" ? "stem_spectral_audition_stop" : phase === "loading" ? "stem_spectral_audition_loading" : "stem_spectral_audition")}
    </button>
    <div className="mixer-monitor" role="group" aria-label={t("stem_spectral_compare")}>
      {(["before", "after"] as const).map(option => <button type="button" key={option} disabled={!selection}
        aria-pressed={mode === option} onClick={() => select(option)}>{t(`stem_spectral_${option}`)}</button>)}
    </div>
    {error && <p className="err" role="alert">{error}</p>}
  </div>;
}
