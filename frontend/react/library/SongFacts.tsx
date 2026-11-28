import { songModel } from "../../song-model";
import { audioTime, songIterations, songStreamMetrics, songWavFormat } from "../../song-result";
import { generationSeconds } from "../../song-timing";
import type { Song } from "../../types";
import { useI18n } from "../i18n";

export function SongFacts({ song }: { song: Song }) {
  const { t, language } = useI18n();
  const meta = song.result_meta ?? {};
  const model = songModel(song);
  const modelText = model.name ? t(model.hasVariant ? "result_music_model" : "result_music_model_partial", model.name) : t("result_music_model_unknown");
  const wav = songWavFormat(song);
  const number = new Intl.NumberFormat(language, { maximumFractionDigits: 3 });
  const runtime = typeof meta.runtime === "string" && meta.runtime;
  const revision = typeof meta.runtime_revision === "string" && meta.runtime_revision;
  const iterations = songIterations(song);
  const variance = song.params.lm_temperature;
  const took = song.status === "done" ? generationSeconds(song) : null;
  const stream = song.status === "done" ? songStreamMetrics(song) : null;
  const metric = new Intl.NumberFormat(language, { maximumFractionDigits: 2 });

  return <div className="song-facts">
    <div title={model.revision ? t("result_music_model_revision", model.revision) : undefined}>{modelText}</div>
    <div className="song-fact-line">
      {wav && <span>{t("result_wav_format", number.format(wav.sampleRateHz / 1000), wav.channels, wav.bitsPerSample)}</span>}
      {runtime && <span title={revision || undefined}>{runtime}{revision && ` ${revision.slice(0, 8)}`}</span>}
      {iterations && <span>{t("iterations")} {iterations}</span>}
      {variance != null && <span>{t("variance")} {metric.format(variance)}</span>}
      {took !== null && <span>{t("created_in")} {audioTime(took)}</span>}
    </div>
    {stream && <div className="song-fact-line">
      <span>{t("stream_first_audio", metric.format(stream.first_audio_ms / 1000))}</span>
      <span>{t("stream_underruns", metric.format(stream.underrun_blocks))}</span>
      <span>{t("stream_peak_ram", metric.format(stream.peak_rss_bytes / 1024 ** 3))}</span>
      <span>{t(stream.realtime ? "stream_realtime_met" : "stream_realtime_missed")}</span>
    </div>}
    {song.status === "done" && Boolean(meta.title_generation_error) && <span className="err" title={String(meta.title_generation_error)}>{t("title_failed")}</span>}
  </div>;
}
