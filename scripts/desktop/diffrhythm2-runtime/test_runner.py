import contextlib
import io
import json
import os
import struct
import sys
import tempfile
import unittest
import wave
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import runner


class DiffRhythmRunnerTest(unittest.TestCase):
    def generation_args(self):
        return [
            "--models", "music/models", "--output", "song.wav",
            "--lyrics=--Hello\n城市晚安", "--style=--quiet piano", "--duration", "15.25", "--seed", "7",
        ]

    def test_accepts_multilingual_lyrics_and_fractional_duration(self):
        args = runner.parse_arguments(self.generation_args())
        self.assertEqual(args.lyrics, "--Hello\n城市晚安")
        self.assertEqual(args.style, "--quiet piano")
        self.assertEqual(args.duration, 15.25)
        self.assertEqual(args.seed, 7)

    def test_rejects_non_finite_duration_and_out_of_range_seed(self):
        for flag, value in (("--duration", "nan"), ("--duration", "211"), ("--seed", "4294967296")):
            with self.subTest(flag=flag, value=value):
                args = self.generation_args()
                args[args.index(flag) + 1] = value
                with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
                    runner.parse_arguments(args)
                self.assertEqual(error.exception.code, 2)

    def test_runtime_probe_sets_offline_flags_before_runtime_imports(self):
        def probe():
            self.assertEqual(os.environ["HF_HUB_OFFLINE"], "1")
            self.assertEqual(os.environ["TRANSFORMERS_OFFLINE"], "1")
            self.assertEqual(os.environ["HF_HUB_DISABLE_TELEMETRY"], "1")
            self.assertEqual(os.environ["TORCH_FORCE_WEIGHTS_ONLY_LOAD"], "1")

        with mock.patch.dict(os.environ), mock.patch.object(runner, "check_runtime", side_effect=probe):
            self.assertEqual(runner.main(["--check-runtime"]), 0)

    def test_requires_cuda_before_generation(self):
        torch = mock.Mock()
        torch.cuda.is_available.return_value = False
        with self.assertRaisesRegex(RuntimeError, "NVIDIA CUDA"):
            runner.require_cuda(torch)
        torch.zeros.assert_not_called()

    def test_runtime_probe_rejects_a_cpu_only_torch_package(self):
        torch = SimpleNamespace(version=SimpleNamespace(cuda=None))
        with mock.patch.dict(sys.modules, {"torch": torch}):
            with self.assertRaisesRegex(RuntimeError, "CUDA build of PyTorch"):
                runner.check_runtime()

    def test_maps_sections_and_phonemizes_english_and_mandarin(self):
        phonemize = mock.Mock(side_effect=[("h", [1, 2]), ("n", [3])])
        lyric = "[Verse]\nHello world\n\n[unknown]\n[chorus]\n你好世界\n!"
        self.assertEqual(
            runner.phonemize_lyrics(lyric, phonemize),
            [500, 511, 503, 511, 2, 3, 511, 504, 511, 4, 511],
        )
        self.assertEqual(phonemize.call_args_list, [mock.call("Hello world"), mock.call("你好世界")])

    def test_preserves_explicit_start_and_requires_spoken_content(self):
        phonemize = mock.Mock(return_value=("h", [7]))
        self.assertEqual(runner.phonemize_lyrics("[start]\nHi", phonemize), [500, 511, 8, 511])
        with self.assertRaisesRegex(ValueError, "Enter lyrics"):
            runner.phonemize_lyrics("[verse]\n!?", phonemize)

    def test_runner_checks_every_required_catalog_file(self):
        repository = Path(__file__).resolve().parents[3]
        profiles = runner.read_json(repository / "models/catalog.json")["profiles"]
        profile = next(profile for profile in profiles if profile["selection"]["provider"] == "diffrhythm2")
        catalog_files = {Path(name).relative_to("diffrhythm2").as_posix() for name in profile["files"]}
        self.assertEqual(catalog_files, set(runner.MODEL_FILES))

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for name in catalog_files:
                file = root / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.touch()
            runner.verify_model_files(root)
            (root / "xlm-roberta/tokenizer.json").unlink()
            (root / "mulan/config.json").unlink()
            with self.assertRaisesRegex(FileNotFoundError, "mulan/config.json.*xlm-roberta/tokenizer.json"):
                runner.verify_model_files(root)

    def test_style_uses_local_encoder_and_treats_a_filename_as_text(self):
        with tempfile.TemporaryDirectory() as folder:
            models = Path(folder)
            configuration = {"audio_model": {"name": "OpenMuQ/MuQ-large-msd-iter"},
                             "text_model": {"name": "xlm-roberta-base"}}
            (models / "mulan").mkdir()
            config_file = models / "mulan/config.json"
            config_file.write_text(json.dumps(configuration), encoding="utf-8")
            misleading_file = models / "reference.wav"
            misleading_file.touch()

            torch = mock.Mock()
            muq = mock.Mock()
            mulan = muq.MuQMuLan.return_value
            tokenizer = mulan.mulan_module.text.tokenizer
            tokenizer.model_max_length = 512
            tokenizer.encode.return_value = [0, 1, 2]

            with mock.patch.dict(sys.modules, {"muq": muq}):
                runner.encode_style(torch, models, "cuda", str(misleading_file))

            muq.MuQMuLan.assert_called_once_with(config={
                "audio_model": {"name": str(models / "muq")},
                "text_model": {"name": str(models / "xlm-roberta")},
            })
            torch.load.assert_called_once_with(models / "mulan/pytorch_model.bin", map_location="cpu", weights_only=True)
            mulan.to.return_value.eval.return_value.assert_called_once_with(texts=[str(misleading_file)])
            self.assertEqual(runner.read_json(config_file), configuration)

    def test_rejects_empty_latents_and_decodes_a_short_eos_without_chunking(self):
        latents = mock.MagicMock()
        decoder = mock.Mock()
        channels_first = latents.__getitem__.return_value.transpose.return_value
        channels_first.shape = (1, 64, 0)
        with self.assertRaisesRegex(RuntimeError, "no audio frames"):
            runner.decode_latents(decoder, latents, 50)

        channels_first.shape = (1, 64, 19)
        self.assertIs(runner.decode_latents(decoder, latents, 50), decoder.decoder.return_value)
        decoder.decoder.assert_called_once_with(channels_first)
        decoder.decode_audio.assert_not_called()

        channels_first.shape = (1, 64, 51)
        self.assertIs(runner.decode_latents(decoder, latents, 51), decoder.decode_audio.return_value)
        decoder.decode_audio.assert_called_once_with(channels_first, overlap=5, chunk_size=20)
        self.assertEqual(latents.__getitem__.call_args.args[0], (slice(None), slice(None, 51), slice(None)))

    def test_writes_native_mono_pcm_and_removes_staging_files(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "song.wav"
            frames = struct.pack("<hhh", -32767, 0, 32767)
            runner.write_mono_wav(output, 48000, frames)
            with wave.open(str(output), "rb") as wav:
                self.assertEqual(wav.getparams()[:4], (1, 2, 48000, 3))
                self.assertEqual(wav.readframes(3), frames)
            with self.assertRaises(ValueError):
                runner.write_mono_wav(output, 48000, b"")
            self.assertEqual(list(Path(folder).iterdir()), [output])


if __name__ == "__main__":
    unittest.main()
