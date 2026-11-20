import contextlib
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import wave

import audiocraft_synth as synth


def generation_args(profile, models_dir, duration, prompt="Cello, pizzicato, à 94 BPM", seed=123):
    return [
        "--profile", profile,
        "--models-dir", str(models_dir),
        f"--prompt={prompt}",
        "--duration", str(duration),
        "--seed", str(seed),
        "--output", str(models_dir / "output.wav"),
    ]


class RunnerTest(unittest.TestCase):
    def test_accepts_musicgen_duration_range_and_magnet_fixed_duration(self):
        cases = (
            ("musicgen-small", 1),
            ("musicgen-small", 2.5),
            ("musicgen-small", 30),
            ("magnet-small-30secs", 30),
        )
        for profile, duration in cases:
            with self.subTest(profile=profile, duration=duration):
                args = synth.parse_args(generation_args(profile, Path("models"), duration, seed=0xFFFFFFFF))
                self.assertEqual(args.duration, duration)
                self.assertEqual(args.seed, 0xFFFFFFFF)
                self.assertEqual(args.prompt, "Cello, pizzicato, à 94 BPM")

    def test_rejects_unsupported_profiles_durations_and_inputs(self):
        cases = (
            ("musicgen-small", 0, "Piano", 123),
            ("musicgen-small", 31, "Piano", 123),
            ("musicgen-small", float("nan"), "Piano", 123),
            ("musicgen-small", float("inf"), "Piano", 123),
            ("magnet-small-30secs", 29, "Piano", 123),
            ("magnet-small-30secs", 29.99, "Piano", 123),
            ("magnet-small-30secs", 31, "Piano", 123),
            ("musicgen-melody", 5, "Piano", 123),
            ("musicgen-small", 5, "\t ", 123),
            ("musicgen-small", 5, "Piano", -1),
            ("musicgen-small", 5, "Piano", 0x100000000),
        )
        for profile, duration, prompt, seed in cases:
            with self.subTest(profile=profile, duration=duration, prompt=prompt, seed=seed):
                with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as err:
                    synth.parse_args(generation_args(profile, Path("models"), duration, prompt, seed))
                self.assertEqual(err.exception.code, 2)

    def test_uses_distinct_local_checkpoints_and_shared_t5_files(self):
        with tempfile.TemporaryDirectory() as temp:
            models_dir = Path(temp)
            root = models_dir.resolve() / "audiocraft"
            for profile in synth.PROFILES:
                folder = root / profile
                folder.mkdir(parents=True)
                for name in synth.CHECKPOINT_FILES:
                    (folder / name).touch()

            encoder = root / "t5-base"
            encoder.mkdir()
            for name in synth.T5_FILES:
                (encoder / name).touch()
            for profile in synth.PROFILES:
                with self.subTest(profile=profile):
                    self.assertEqual(synth.model_paths(models_dir, profile), (root / profile, encoder))

            (encoder / "spiece.model").unlink()
            with self.assertRaisesRegex(FileNotFoundError, "spiece.model"):
                synth.model_paths(models_dir, "magnet-small-30secs")

    def test_missing_checkpoint_exits_before_loading_runtime(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(synth, "load_runtime") as runtime:
            with patch.dict(os.environ), self.assertRaisesRegex(FileNotFoundError, "state_dict.bin"):
                synth.main(generation_args("musicgen-small", Path(temp), 3))
            runtime.assert_not_called()

    def test_disables_hub_and_pytorch_fallbacks_before_loading_runtime(self):
        with patch.dict(os.environ, {"HF_HUB_OFFLINE": "0", "TRANSFORMERS_OFFLINE": "0"}):
            synth.configure_offline()
            for setting in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_HUB_DISABLE_TELEMETRY", "TORCH_FORCE_WEIGHTS_ONLY_LOAD"):
                self.assertEqual(os.environ[setting], "1")

    def test_writes_mono_32khz_pcm_wav(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "sample.wav"
            frames = b"\xff\x7f\x00\x80"
            synth.write_wav(output, frames)
            with wave.open(str(output), "rb") as wav:
                self.assertEqual(wav.getnchannels(), 1)
                self.assertEqual(wav.getsampwidth(), 2)
                self.assertEqual(wav.getframerate(), 32_000)
                self.assertEqual(wav.getnframes(), 2)
                self.assertEqual(wav.readframes(2), frames)


if __name__ == "__main__":
    unittest.main()
