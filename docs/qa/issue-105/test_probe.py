import io
import json
from pathlib import Path
import struct
import tempfile
import unittest
import wave

import probe


def wav_bytes(samples):
    target = io.BytesIO()
    with wave.open(target, "wb") as wav:
        wav.setparams((2, 2, 48000, 0, "NONE", "not compressed"))
        wav.writeframes(struct.pack(f"<{len(samples)}h", *samples))
    return target.getvalue()


class ProbeTests(unittest.TestCase):
    def test_matrix_pairs_languages_and_instrumental_controls_across_sizes(self):
        matrices = [
            {(code, req["seed"], req["lm_seed"]): req for _, code, req in probe.matrix(size)}
            for size in probe.MODELS
        ]
        expected = {(code, seed, lm_seed)
                    for code in ("de", "en", "es", "instrumental")
                    for seed, lm_seed in ((12345, 3), (67890, 7))}
        self.assertEqual(set(matrices[0]), expected)
        for requests in matrices:
            self.assertEqual(set(requests), expected)
            for key, req in requests.items():
                code = key[0]
                self.assertEqual(req["inference_steps"], 80)
                self.assertEqual(
                    {k: v for k, v in req.items() if k != "lm_model"},
                    {k: v for k, v in matrices[0][key].items() if k != "lm_model"},
                )
                if code == "instrumental":
                    self.assertEqual(req["lyrics"], "[Instrumental]")
                    self.assertNotIn("vocal_language", req)
                else:
                    self.assertNotIn("lyrics", req)
                    self.assertEqual(req["vocal_language"], probe.LANGUAGES[code])

    def test_synthesis_preserves_controls_and_overrides_lm_sampling_fields(self):
        lm = {"vocal_language": "en", "lyrics": "Words", "audio_codes": "1,2",
              "inference_steps": 5, "effective_inference_steps": 5,
              "inference_steps_limit": 200, "seed": 1, "duration": 90}
        cases = {code: request for _, code, request in probe.matrix("4B")}
        vocals = probe.synth_request(cases["de"], lm, "de")
        self.assertEqual(vocals["lyrics"], "Words")
        self.assertEqual(vocals["audio_codes"], "1,2")
        self.assertEqual(vocals["vocal_language"], "de")
        self.assertEqual(vocals["inference_steps"], 80)
        self.assertEqual(vocals["seed"], 67890)
        self.assertEqual(vocals["duration"], 30)
        self.assertNotIn("effective_inference_steps", vocals)
        self.assertNotIn("inference_steps_limit", vocals)
        control = probe.synth_request(cases["instrumental"], lm, "instrumental")
        self.assertEqual(control["lyrics"], "[Instrumental]")
        self.assertNotIn("vocal_language", control)
        self.assertEqual(lm["lyrics"], "Words")

    def test_synthesis_extracts_binary_audio_and_requires_runtime_metadata(self):
        audio = wav_bytes((-32768, 32767, 0, 0))
        metadata = {"effective_inference_steps": 80, "inference_steps_limit": 200}
        content_type = "multipart/mixed; boundary=evidence"
        audio_part = b"--evidence\r\nContent-Type: audio/wav\r\n\r\n" + audio + b"\r\n"
        json_part = (b"--evidence\r\nContent-Type: application/json\r\n\r\n"
                     + json.dumps([metadata]).encode() + b"\r\n")
        end = b"--evidence--\r\n"
        self.assertEqual(probe.synthesis_parts(content_type, audio_part + json_part + end),
                         (audio, metadata))
        with self.assertRaisesRegex(ValueError, "step evidence"):
            probe.synthesis_parts("audio/wav", audio)
        with self.assertRaisesRegex(ValueError, "one audio and one JSON"):
            probe.synthesis_parts(content_type, audio_part + end)

    def test_signal_measures_pcm_and_rejects_truncated_data(self):
        audio = wav_bytes((-32768, 32767, 0, 0))
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "test.wav"
            path.write_bytes(audio)
            facts = probe.signal(path)
            self.assertEqual(facts["duration_seconds"], 2 / 48000)
            self.assertEqual(facts["channels"], 2)
            self.assertEqual(facts["peak_dbfs"], 0)
            self.assertEqual(facts["rms_dbfs"], -3.01)
            self.assertEqual(facts["pcm_endpoint_samples"], 2)
            path.write_bytes(audio[:-2])
            with self.assertRaisesRegex(ValueError, "shorter"):
                probe.signal(path)

    def test_silence_has_no_finite_dbfs(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "silent.wav"
            path.write_bytes(wav_bytes((0, 0, 0, 0)))
            facts = probe.signal(path)
            self.assertIsNone(facts["peak_dbfs"])
            self.assertIsNone(facts["rms_dbfs"])
            self.assertEqual(facts["pcm_endpoint_samples"], 0)


if __name__ == "__main__":
    unittest.main()
