// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { I18N, setLang, t } from "./i18n.js";
import { LANGS } from "./locales";
import { audioTime, songDuration, songDurationWarning, songIterations, songMachineGeneratedBy, songWavFormat } from "./song-result";
import "./song-result-i18n";

it("uses locally verified effective steps and bounds only the requested fallback without changing stored history", () => {
  const params = Object.freeze({ inference_steps: 120 });
  expect(songIterations({ params, result_meta: { effective_inference_steps: 60, inference_steps: 120 } })).toBe(60);
  expect(songIterations({ params, result_meta: {} })).toBe(100);
  expect(songIterations({ params, result_meta: { effective_inference_steps: 999 } })).toBe(100);
  expect(params.inference_steps).toBe(120);
});

it("distinguishes verified new 200-step execution from the historical 100-step runtime", () => {
  const params = Object.freeze({ inference_steps: 200 });
  expect(songIterations({ params, result_meta: { effective_inference_steps: 200, inference_steps_limit: 200 } })).toBe(200);
  expect(songIterations({ params, result_meta: { effective_inference_steps: 120, inference_steps_limit: 200 } })).toBe(120);
  expect(songIterations({ params, result_meta: { effective_inference_steps: 100 } })).toBe(100);
  expect(songIterations({ params, result_meta: { effective_inference_steps: 120 } })).toBe(100);
  expect(songIterations({ params, result_meta: { inference_steps: 120 } })).toBe(100);
  expect(params.inference_steps).toBe(200);
});

it("does not invent an executed step count for an automatic legacy request with an unknown model", () => {
  expect(songIterations({ params: { inference_steps: 0 }, result_meta: {} })).toBeNull();
  expect(songIterations({ params: {}, result_meta: {} })).toBeNull();
  expect(songIterations({ params: { inference_steps: 0, model_selection: { provider: "ace-step", synthesis: "acestep-v15-turbo-Q8_0.gguf", language: "lm" } }, result_meta: {} })).toBe(8);
});

it.each(["80", -1, 1.5, {}, []].map(value => ({ value })))("does not invent effective iterations from malformed historical steps $value", ({ value }) => {
  expect(songIterations({ params: JSON.parse(JSON.stringify({ inference_steps: value })), result_meta: {} })).toBeNull();
});

it.each([null, {}, { duration: 85 }, { duration: 85, duration_source: "unknown" }, { duration: "30", duration_source: "wav" }, { duration: 0, duration_source: "wav" }])("does not present unmeasured or invalid duration %j as audio length", meta => {
  expect(songDuration({ params: { duration: 30 }, result_meta: meta })).toBeNull();
});

it("uses whole-second player formatting while retaining exact measured audio duration", () => {
  const song = { params: { duration: 90 }, result_meta: { duration: 29.8, duration_source: "wav" } };
  expect(songDuration(song)).toBe(29.8);
  expect(audioTime(songDuration(song)!)).toBe("0:29");
  expect(audioTime(59.8)).toBe("0:59");
});

it("uses measured WAV parameters without filling in missing or malformed values", () => {
  const format = { container: "wav", encoding: "pcm", sample_rate_hz: 44100, channels: 2, bits_per_sample: 16 };
  expect(songWavFormat({ result_meta: { audio_format: format } })).toEqual({ sampleRateHz: 44100, channels: 2, bitsPerSample: 16 });
  for (const value of [null, [], { ...format, encoding: "unknown" }, { ...format, sample_rate_hz: "44100" }, { ...format, channels: 0 }, { ...format, bits_per_sample: 16.5 }]) {
    expect(songWavFormat({ result_meta: { audio_format: value } })).toBeNull();
  }
});

it("labels songs from recorded generation provenance", () => {
  expect(songMachineGeneratedBy({ result_meta: { machine_generated: true, generated_by: "MiniMax-Music3" } })).toBe("MiniMax-Music3");
  expect(songMachineGeneratedBy({ result_meta: { generated_by: "MiniMax-Music3" } })).toBeNull();
  expect(songMachineGeneratedBy({ result_meta: { machine_generated: true, generated_by: "   " } })).toBeNull();
});

it("renders only valid backend warnings coherent with measured audio, without adding its own materiality threshold", () => {
  const warning = { code: "short_audio", requested_seconds: 30, actual_seconds: 22 };
  const song = { params: { duration: 30 }, result_meta: { duration: 22, duration_source: "wav", duration_warning: warning } };
  expect(songDurationWarning(song)).toEqual(warning);
  for (const value of [undefined, null, [], {}, { ...warning, code: "other" }, { ...warning, requested_seconds: -1 }, { ...warning, actual_seconds: 21 }, { ...warning, code: "long_audio" }]) {
    expect(songDurationWarning({ ...song, result_meta: { ...song.result_meta, duration_warning: value } })).toBeNull();
  }
  expect(songDurationWarning({ params: song.params, result_meta: { duration: 29.8, duration_source: "wav", requested_duration: 30 } })).toBeNull();
});

it("explains short and long audio clearly in every registered language", () => {
  for (const language of Object.keys(LANGS) as (keyof typeof I18N)[]) {
    setLang(language);
    for (const key of ["duration_short_audio", "duration_long_audio"]) {
      const text = t(key, "0:22", "0:30");
      expect(text, `${language}:${key}`).toContain("0:22");
      expect(text, `${language}:${key}`).toContain("0:30");
      expect(text).not.toContain("duration_");
    }
  }
  setLang("de");
});
