"""Offline lyrics and text-style runner for the bundled DiffRhythm 2 runtime."""

import argparse
import importlib
import json
import math
import os
import re
import sys
import tempfile
import wave
from pathlib import Path


MIN_SECONDS = 10
MAX_SECONDS = 210
MAX_TEXT_BYTES = 8 * 1024
MAX_SEED = (1 << 32) - 1
LATENT_FRAMES_PER_SECOND = 5
DECODER_CHUNK_FRAMES = 20
SUPPORTED_TEXT = re.compile(r"[A-Za-z\u4e00-\u9fa5]")
SECTION_TAG = re.compile(r"\[.*?\]")
SECTION_IDS = {
    "[start]": 500,
    "[end]": 501,
    "[intro]": 502,
    "[verse]": 503,
    "[chorus]": 504,
    "[outro]": 505,
    "[inst]": 506,
    "[solo]": 507,
    "[bridge]": 508,
    "[hook]": 509,
    "[break]": 510,
    "[stop]": 511,
    "[space]": 512,
}
MODEL_FILES = (
    "config.json",
    "model.safetensors",
    "decoder.json",
    "decoder.bin",
    "mulan/config.json",
    "mulan/pytorch_model.bin",
    "muq/config.json",
    "muq/model.safetensors",
    "xlm-roberta/config.json",
    "xlm-roberta/model.safetensors",
    "xlm-roberta/tokenizer.json",
    "xlm-roberta/tokenizer_config.json",
)


def configure_offline():
    # Set these before importing PyTorch, Transformers or huggingface_hub.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["TORCH_FORCE_WEIGHTS_ONLY_LOAD"] = "1"


def parse_arguments(argv):
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--check-runtime", action="store_true")
    parser.add_argument("--models", type=Path, help="Directory of verified DiffRhythm 2 files")
    parser.add_argument("--output", type=Path, help="Path for the mono PCM WAV")
    parser.add_argument("--lyrics", help="English or Mandarin lyrics")
    parser.add_argument("--style", help="English or Mandarin style description")
    parser.add_argument("--duration", type=float, help="Maximum output duration in seconds")
    parser.add_argument("--seed", type=int)
    args = parser.parse_args(argv)
    generation_args = (args.models, args.output, args.lyrics, args.style, args.duration, args.seed)
    if args.check_runtime:
        if any(value is not None for value in generation_args):
            parser.error("--check-runtime takes no generation arguments")
        return args
    if any(value is None for value in generation_args):
        parser.error("--models, --output, --lyrics, --style, --duration and --seed are required")

    args.lyrics = args.lyrics.strip()
    args.style = args.style.strip()
    if not args.style or not args.lyrics:
        parser.error("Enter lyrics and a text style description")
    if len(args.lyrics.encode("utf-8")) + len(args.style.encode("utf-8")) > MAX_TEXT_BYTES:
        parser.error("Style and lyrics must total at most 8 KiB of UTF-8 text")
    if not MIN_SECONDS <= args.duration <= MAX_SECONDS:
        parser.error(f"Duration must be between {MIN_SECONDS} and {MAX_SECONDS} seconds")
    if not 0 <= args.seed <= MAX_SEED:
        parser.error(f"Seed must be between 0 and {MAX_SEED}")
    return args


def verify_model_files(models):
    missing = [name for name in MODEL_FILES if not (models / name).is_file()]
    if missing:
        raise FileNotFoundError(f"Missing local DiffRhythm 2 files: {', '.join(missing)}")


def phonemize_lyrics(lyrics, phonemize_line):
    tokens = []
    has_start = False
    has_lyrics = False
    stop = SECTION_IDS["[stop]"]
    for line in map(str.strip, lyrics.splitlines()):
        if SECTION_TAG.fullmatch(line):
            section = SECTION_IDS.get(line.lower())
            if section is not None:
                tokens.extend((section, stop))
                has_start |= section == SECTION_IDS["[start]"]
        elif SUPPORTED_TEXT.search(line):
            _, phones = phonemize_line(line)
            if phones:
                tokens.extend(phone + 1 for phone in phones)
                tokens.append(stop)
                has_lyrics = True
    if not has_lyrics:
        raise ValueError("Enter lyrics with English or Mandarin words")
    if not has_start:
        tokens[:0] = (SECTION_IDS["[start]"], stop)
    return tokens


def read_json(path):
    with path.open(encoding="utf-8") as configuration:
        return json.load(configuration)


def local_mulan_config(models):
    configuration = read_json(models / "mulan/config.json")
    # MuQ 0.1.0 selects the architectures by these names, then loads their files.
    configuration["audio_model"]["name"] = str(models / "muq")
    configuration["text_model"]["name"] = str(models / "xlm-roberta")
    return configuration


def check_phonemizer():
    from g2p.g2p_generation import chn_eng_g2p

    # Exercise both branches against the packaged eSpeak and G2P data.
    phonemize_lyrics("The city lights shine", chn_eng_g2p)
    phonemize_lyrics("重庆灯火明亮", chn_eng_g2p)


def require_cuda(torch):
    if not torch.cuda.is_available():
        raise RuntimeError("DiffRhythm 2 requires a compatible NVIDIA CUDA device and driver")
    device = torch.device("cuda")
    torch.zeros(1, device=device, dtype=torch.float16)
    torch.cuda.synchronize(device)
    return device


def check_runtime():
    import torch

    if torch.version.cuda is None:
        raise RuntimeError("The bundled DiffRhythm 2 runner requires the CUDA build of PyTorch")
    for module in ("bigvgan.model", "diffrhythm2.cfm", "muq", "safetensors.torch"):
        importlib.import_module(module)
    check_phonemizer()
    cuda_available = torch.cuda.is_available()
    if cuda_available:
        require_cuda(torch)
    report = {
        "cuda_available": cuda_available,
        "torch_version": torch.__version__,
        "cuda_version": torch.version.cuda,
        "phonemizer": "ok",
    }
    print(json.dumps(report), flush=True)


def decode_latents(decoder, latents, latent_limit):
    channels_first = latents[:, :latent_limit, :].transpose(1, 2)
    frames = channels_first.shape[2]
    if not frames:
        raise RuntimeError("DiffRhythm 2 produced no audio frames")
    # The upstream chunked decoder assumes its loop ran at least once.
    if frames <= DECODER_CHUNK_FRAMES:
        return decoder.decoder(channels_first)
    return decoder.decode_audio(channels_first, overlap=5, chunk_size=DECODER_CHUNK_FRAMES)


def write_mono_wav(path, sample_rate, pcm_bytes):
    if not pcm_bytes or len(pcm_bytes) % 2:
        raise ValueError("No complete PCM audio samples were produced")
    fd, name = tempfile.mkstemp(dir=path.parent, prefix=".diffrhythm2-")
    temporary = Path(name)
    try:
        with os.fdopen(fd, "wb") as file, wave.open(file, "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(sample_rate)
            output.writeframes(pcm_bytes)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def encode_style(torch, models, device, description):
    from muq import MuQMuLan

    mulan = MuQMuLan(config=local_mulan_config(models))
    weights = torch.load(models / "mulan/pytorch_model.bin", map_location="cpu", weights_only=True)
    mulan.load_state_dict(weights)
    del weights
    # XLM-RoBERTa has a finite positional context; give overlong text a clear error.
    tokenizer = mulan.mulan_module.text.tokenizer
    if len(tokenizer.encode(description, verbose=False)) > tokenizer.model_max_length:
        raise ValueError("The DiffRhythm 2 style description exceeds the encoder's token limit")
    return mulan.to(device).eval()(texts=[description]).to(dtype=torch.float16)


def generate(args):
    models = args.models.resolve()
    verify_model_files(models)

    import torch
    from bigvgan.model import Generator
    from diffrhythm2.backbones.dit import DiT
    from diffrhythm2.cfm import CFM
    from g2p.g2p_generation import chn_eng_g2p
    from safetensors.torch import load_file

    device = require_cuda(torch)
    tokens = phonemize_lyrics(args.lyrics, chn_eng_g2p)
    print("Encoding text style with local MuQ-MuLan", flush=True)
    with torch.inference_mode():
        style = encode_style(torch, models, device, args.style)

        print("Loading local DiffRhythm 2 checkpoint", flush=True)
        config = read_json(models / "config.json")
        config["use_flex_attn"] = False
        model = CFM(transformer=DiT(**config), num_channels=config["mel_dim"], block_size=config["block_size"])
        model.load_state_dict(load_file(str(models / "model.safetensors")))
        model = model.to(device=device, dtype=torch.float16).eval()
        text = torch.tensor([tokens], dtype=torch.long, device=device)
        latent_limit = math.ceil(args.duration * LATENT_FRAMES_PER_SECOND)
        print("Synthesizing DiffRhythm 2 latents", flush=True)
        # The upstream sample method takes a seed but draws from PyTorch's global RNG.
        torch.manual_seed(args.seed)
        latents = model.sample_block_cache(
            text=text, duration=latent_limit, style_prompt=style, steps=16, cfg_strength=2.0, process_bar=False,
        )
        del model

        print("Decoding mono WAV", flush=True)
        decoder = Generator(str(models / "decoder.json"), str(models / "decoder.bin"))
        decoder = decoder.to(device=device, dtype=torch.float16).eval()
        sample_rate = decoder.h.sampling_rate
        waveform = decode_latents(decoder, latents, latent_limit)
        samples = waveform[0, 0, :round(args.duration * sample_rate)].float()
        if not torch.isfinite(samples).all().item():
            raise RuntimeError("DiffRhythm 2 produced non-finite audio samples")
        pcm = (samples.clamp(-1, 1) * 32767).round().to(torch.int16).cpu().numpy().astype("<i2", copy=False)
    write_mono_wav(args.output, sample_rate, pcm.tobytes())


def main(argv=None):
    args = parse_arguments(argv)
    configure_offline()
    try:
        if args.check_runtime:
            check_runtime()
        else:
            generate(args)
    except (ImportError, OSError, RuntimeError, ValueError) as error:
        print(f"DiffRhythm 2: {error}", file=sys.stderr, flush=True)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
