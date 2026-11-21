// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { defaultMix, type StemProject } from "../../stems";
import { StemTransport, type WorkletCommand } from "./transport-core";
import { useStemTransport } from "./useStemTransport";

vi.mock("@tauri-apps/api/core", () => ({ invoke: async (_operation: string, args: { role: string }) => args.role, convertFileSrc: (path: string) => path }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const project: StemProject = {
  rate: 44100, channels: 2, frames: 4, source_start_frame: 0, source_frames: 4, roles: ["vocals"],
  engine: "Demucs", engine_version: "4.0.1", backend: "cpu", original_peak: 0, track_peaks: [],
};

function wav() {
  const bytes = new ArrayBuffer(52);
  const wave = new DataView(bytes);
  wave.setUint32(0, 0x52494646); wave.setUint32(4, 44, true); wave.setUint32(8, 0x57415645);
  wave.setUint32(12, 0x666d7420); wave.setUint32(16, 16, true); wave.setUint16(20, 3, true); wave.setUint16(22, 2, true);
  wave.setUint32(24, 44100, true); wave.setUint32(28, 352800, true); wave.setUint16(32, 8, true); wave.setUint16(34, 32, true);
  wave.setUint32(36, 0x64617461); wave.setUint32(40, 8, true);
  return new Response(bytes);
}

it.each(["decoding", "resuming", "finished", "ended between reports", "uninterrupted", "unresponsive"])("preserves the playback intent across a replacement that is %s", async phase => {
  const nodes: Worklet[] = [];
  class Worklet {
    constructor() { nodes.push(this); }
    transport = new StemTransport(project.rate, project.frames, 1);
    port = {
      postMessage: vi.fn((message: WorkletCommand) => {
        if (message.type === "freeze") {
          if (phase !== "unresponsive") {
            const position = this.transport.freeze();
            queueMicrotask(() => this.port.onmessage?.({ data: { type: "frozen", position } }));
          }
        } else this.transport.receive(message);
      }),
      onmessage: vi.fn(), close: vi.fn(),
    };
    connect() {}
    disconnect() {}
  }
  let finishResume!: () => void;
  const resume = vi.fn<() => Promise<void>>().mockResolvedValueOnce(undefined)
    .mockImplementation(() => phase === "resuming" ? new Promise(resolve => { finishResume = resolve; }) : Promise.resolve());
  class Context {
    audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };
    resume = resume;
    close = vi.fn().mockResolvedValue(undefined);
  }
  let finishDecode!: (response: Response) => void;
  const fetchAudio = vi.fn((path: string) => path === "layer" && phase === "decoding"
    ? new Promise<Response>(resolve => { finishDecode = resolve; }) : Promise.resolve(wav()));
  vi.stubGlobal("fetch", fetchAudio);
  vi.stubGlobal("AudioContext", Context);
  vi.stubGlobal("AudioWorkletNode", Worklet);

  const mix = defaultMix(project);
  const transport = renderHook(value => useStemTransport("project", project, value), { initialProps: mix });
  await waitFor(() => expect(transport.result.current.ready).toBe(true));
  await act(async () => transport.result.current.play(true));
  act(() => nodes[0].port.onmessage({ data: { ...transport.result.current.getPosition(), playRevision: 1, playing: phase !== "finished" } }));
  if (phase === "ended between reports") nodes[0].transport.render(new Float32Array(project.frames), new Float32Array(project.frames));
  if (phase === "uninterrupted") nodes[0].transport.render(new Float32Array(2), new Float32Array(2));
  transport.rerender({ ...mix, tracks: [{ ...mix.tracks[0], replacement: "layer" }] });
  if (phase === "resuming" || phase === "decoding") {
    await waitFor(() => expect(phase === "resuming" ? finishResume : finishDecode).toBeTypeOf("function"));
    act(() => transport.result.current.play(false));
    await act(async () => { if (phase === "resuming") finishResume(); else finishDecode(wav()); });
  }

  await waitFor(() => expect(transport.result.current.ready).toBe(true));
  const commands = nodes[1].port.postMessage.mock.calls.map(([command]) => command);
  expect(commands.some(command => command.type === "play" && command.playing)).toBe(phase === "uninterrupted");
  if (phase === "ended between reports") expect(transport.result.current.getPosition().frame).toBe(project.frames);
  if (phase === "uninterrupted") expect(commands).toContainEqual({ type: "seek", frame: 2 });
});
