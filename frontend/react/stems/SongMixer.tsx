import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { backend } from "../../backend";
import { stemApi, stemError, type StemJob } from "../../stems";
import type { Song } from "../../types";
import { useI18n } from "../i18n";
import { OriginalMixer, type OriginalMixAudio } from "./StemMixer";

async function decodeSong(id: string): Promise<OriginalMixAudio> {
  const bytes = await backend.songAudio(id);
  const context = new OfflineAudioContext(2, 1, 48000);
  const buffer = await context.decodeAudioData(bytes);
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  return { pcm: { left, right }, rate: buffer.sampleRate, frames: buffer.length };
}

export function SongMixer({ song, active, onProject, onSeparate, onBack, onClose }: {
  song: Song; active: boolean; onProject: (job: StemJob) => void;
  onSeparate: () => void; onBack: () => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const latest = useQuery({
    queryKey: ["stem-latest-project", song.id],
    queryFn: async () => {
      try { return await stemApi.latestProject(song.id); }
      catch (error) {
        if ((error instanceof Error ? error.message : String(error)) === "stem_project_missing") return null;
        throw error;
      }
    },
    enabled: active, networkMode: "always", retry: false, staleTime: 0, gcTime: 0,
  });
  const audio = useQuery({
    queryKey: ["stem-original-audio", song.id],
    queryFn: () => decodeSong(song.id), enabled: active && latest.data === null,
    networkMode: "always", retry: false, staleTime: Infinity, gcTime: 0,
  });

  useEffect(() => {
    if (active && latest.data && !latest.isFetching) onProject(latest.data);
  }, [active, latest.data, latest.isFetching, onProject]);

  if (audio.data) return <OriginalMixer audio={audio.data} name={song.title || song.caption} active={active}
    onBack={onBack} onClose={onClose} onNewSeparation={onSeparate} />;
  const error = latest.error ?? audio.error;
  if (error) return <div>
    <p className="err" role="alert">{stemError(error, t)}</p>
    <div className="stem-row">
      <button type="button" className="sek" onClick={onSeparate}>{t("stem_split")}</button>
      <button type="button" className="sek" onClick={onBack}>{t("stem_projects")}</button>
    </div>
  </div>;
  return <p role="status">{t("stem_preparing")}</p>;
}
