import type { StemProject } from "../../stems";
import { mapFxSlots } from "../../stem-returns";
import { StemTransport, type PlaybackSnapshot, type Position, type TransportMessage, type WorkletReport } from "./transport-core";
import processor from "./transport-worklet?worker&url";

export interface AudioGraph {
  send: (message: TransportMessage) => void;
  freeze: () => Promise<PlaybackSnapshot | undefined>;
  dispose: () => void;
}

function workletGraph(node: AudioWorkletNode, onPosition: (position: Position) => void): AudioGraph {
  let completeFreeze: ((snapshot?: PlaybackSnapshot) => void) | undefined;
  node.port.onmessage = ({ data }: MessageEvent<WorkletReport>) => {
    if ("type" in data) completeFreeze?.(data.position);
    else onPosition(data);
  };

  return {
    send: message => node.port.postMessage(message, message.type === "audio" ? [message.pcm.left.buffer, message.pcm.right.buffer] : []),
    freeze: () => new Promise(resolve => {
      const timeout = setTimeout(() => completeFreeze?.(), 250);
      completeFreeze = snapshot => {
        clearTimeout(timeout);
        completeFreeze = undefined;
        resolve(snapshot);
      };
      try { node.port.postMessage({ type: "freeze" }); }
      catch { completeFreeze(); }
    }),
    dispose: () => {
      completeFreeze?.();
      node.port.onmessage = null;
      node.port.close();
      node.disconnect();
    },
  };
}

export async function createTransport(
  context: AudioContext, project: Pick<StemProject, "frames" | "rate">, tracks: number, onPosition: (value: Position) => void,
): Promise<AudioGraph> {
  if (context.audioWorklet) {
    try {
      await context.audioWorklet.addModule(processor);
      const node = new AudioWorkletNode(context, "stem-transport", {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
        processorOptions: { rate: project.rate, frames: project.frames, tracks },
      });
      node.connect(context.destination);
      return workletGraph(node, onPosition);
    } catch {
      if (context.state === "closed") throw new Error("stem_audio_unavailable");
    }
  }

  const transport = new StemTransport(project.rate, project.frames, tracks, context.sampleRate);
  const node = context.createScriptProcessor(1024, 0, 2);
  node.onaudioprocess = event => {
    const output = event.outputBuffer;
    const position = transport.render(output.getChannelData(0), output.getChannelData(1));
    onPosition({ ...position, stereo: position.stereo.map(pair => [...pair]), masterStereo: [...position.masterStereo],
      reduction: [...position.reduction], returnStereo: mapFxSlots(slot => [...position.returnStereo[slot]]),
      returnReduction: mapFxSlots(slot => position.returnReduction[slot]) });
  };
  node.connect(context.destination);
  return {
    send: message => transport.receive(message),
    freeze: async () => transport.freeze(),
    dispose: () => { node.onaudioprocess = null; node.disconnect(); },
  };
}
