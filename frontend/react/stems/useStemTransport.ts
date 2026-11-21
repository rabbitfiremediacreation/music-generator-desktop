import { useCallback, useEffect, useRef, useState } from "react";
import { stemApi, type StemMix, type StemProject } from "../../stems";
import { createTransport, type AudioGraph } from "./audio-graph";
import { readStereoWave, type Position, type TransportMessage } from "./transport-core";

interface Controller extends AudioGraph { context: AudioContext; assetKey: string; started: boolean }
interface PlayIntent { playing: boolean; revision: number }
export interface TransportStore {
  subscribe: (listener: () => void) => () => void;
  getPosition: () => Position;
}

const empty: Position = { frame: 0, playing: false, playRevision: 0, peaks: [], master: 0, stereo: [], masterStereo: [0, 0] };

export type MixerTransport = ReturnType<typeof useStemTransport>;

export function useStemTransport(id: string, project: StemProject, mix: StemMix) {
  const control = useRef<Controller | null>(null);
  const mixRef = useRef(mix);
  const position = useRef(empty);
  const listeners = useRef(new Set<() => void>());
  const monitoring = useRef({ original: false, mono: false });
  const playIntent = useRef<PlayIntent>({ playing: false, revision: 0 });
  const seekRevision = useRef(0);
  const handoff = useRef<Promise<void> | undefined>(undefined);
  const assetKey = JSON.stringify(mix.tracks.map(track => track.replacement ?? track.role));
  const [reload, setReload] = useState(0);
  const [readyKey, setReadyKey] = useState<string>();
  const [missing, setMissing] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<unknown>(null);

  const publish = useCallback((value: Position) => {
    position.current = value;
    for (const listener of listeners.current) listener();
  }, []);
  const subscribe = useCallback((listener: () => void) => {
    listeners.current.add(listener);
    return () => { listeners.current.delete(listener); };
  }, []);
  const getPosition = useCallback(() => position.current, []);
  const retry = useCallback(() => setReload(value => value + 1), []);
  const resume = useCallback(async (active: Controller, intent: PlayIntent) => {
    try {
      await active.context.resume();
      if (control.current === active && playIntent.current === intent) {
        active.send({ type: "play", playing: true, revision: intent.revision });
        active.started = true;
      }
    } catch {
      if (control.current === active && playIntent.current === intent) setError(new Error("stem_audio_unavailable"));
    }
  }, []);

  const retire = useCallback((active: Controller, dispose: () => void) => {
    const intent = playIntent.current;
    const seek = seekRevision.current;
    return active.freeze().then(snapshot => {
      const latest = playIntent.current;
      const ended = snapshot ? !snapshot.playing && snapshot.playRevision === latest.revision : latest === intent;
      if (ended) playIntent.current = { ...latest, playing: false };
      if (snapshot && seekRevision.current === seek) {
        position.current = { ...position.current, ...snapshot, playing: false };
      }
    }).finally(dispose);
  }, []);

  useEffect(() => {
    mixRef.current = mix;
    if (control.current?.assetKey === assetKey) control.current.send({ type: "mix", mix });
  }, [mix, assetKey]);
  useEffect(() => {
    let context: AudioContext | undefined;
    let graph: AudioGraph | undefined;
    const lifetime = new AbortController();
    setReadyKey(undefined); setError(null); setMissing({});
    const dispose = () => {
      graph?.dispose();
      graph = undefined;
      if (context && context.state !== "closed") void context.close().catch(() => {});
    };
    async function load() {
      try {
        context = new AudioContext({ sampleRate: project.rate });
      } catch {
        throw new Error("stem_audio_unavailable");
      }
      const assets = JSON.parse(assetKey) as string[];
      graph = await createTransport(context, project, assets.length, value => {
        if (lifetime.signal.aborted || control.current?.assetKey !== assetKey) return;
        const intent = playIntent.current;
        if (!value.playing && intent.playing && value.playRevision === intent.revision) {
          playIntent.current = { ...intent, playing: false };
        }
        publish(value.playing && !playIntent.current.playing ? { ...value, playing: false } : value);
      });
      if (lifetime.signal.aborted) { dispose(); return; }
      const failures: Record<string, unknown> = {};
      for (const [index, role] of ["original", ...assets].entries()) {
        if (lifetime.signal.aborted) return;
        try {
          const url = await stemApi.projectAudio(id, role);
          const response = await fetch(url, { signal: lifetime.signal });
          if (!response.ok) throw new Error("stem_asset_missing");
          const pcm = readStereoWave(await response.arrayBuffer(), project.frames, project.rate);
          if (lifetime.signal.aborted) return;
          graph.send({ type: "audio", index: index - 1, pcm });
        } catch (cause) {
          if (lifetime.signal.aborted) return;
          failures[role] = cause;
        }
      }
      await handoff.current;
      if (lifetime.signal.aborted) return;
      setMissing(failures);
      if (failures.original && assets.every(role => failures[role])) throw new Error("stem_asset_missing");
      const active = { context, ...graph, assetKey, started: false };
      control.current = active;
      const currentMix = mixRef.current;
      const currentPosition = position.current;
      const frame = Math.max(currentMix.first, Math.min(currentPosition.frame, currentMix.end));
      graph.send({ type: "mix", mix: currentMix });
      graph.send({ type: "seek", frame });
      graph.send({ type: "compare", original: !failures.original && (monitoring.current.original || assets.every(role => failures[role])) });
      graph.send({ type: "mono", mono: monitoring.current.mono });
      const intent = playIntent.current;
      publish({ ...currentPosition, frame, playing: false });
      setReadyKey(assetKey);
      if (intent.playing) void resume(active, intent);
    }
    void load().catch(cause => {
      if (!lifetime.signal.aborted) {
        control.current = null;
        dispose();
        setError(cause);
      }
    });
    return () => {
      lifetime.abort();
      const retiring = control.current;
      control.current = null;
      if (!retiring?.started) { dispose(); return; }
      handoff.current = retire(retiring, dispose);
    };
  }, [id, project, assetKey, reload, publish, resume, retire]);

  const send = useCallback((message: TransportMessage) => control.current?.send(message), []);
  const play = useCallback((playing: boolean) => {
    const active = control.current;
    const intent = { playing, revision: playIntent.current.revision + 1 };
    playIntent.current = intent;
    if (!playing) {
      active?.send({ type: "play", playing: false, revision: intent.revision });
      publish({ ...position.current, playing: false });
    } else if (active) void resume(active, intent);
  }, [publish, resume]);
  const seek = useCallback((frame: number) => {
    seekRevision.current++;
    publish({ ...position.current, frame });
    send({ type: "seek", frame });
  }, [publish, send]);
  const compare = useCallback((original: boolean) => {
    monitoring.current.original = original;
    send({ type: "compare", original });
  }, [send]);
  const setMono = useCallback((mono: boolean) => {
    monitoring.current.mono = mono;
    send({ type: "mono", mono });
  }, [send]);
  return { subscribe, getPosition, ready: readyKey === assetKey && !error, error, missing, retry, play, seek, compare, setMono };
}
