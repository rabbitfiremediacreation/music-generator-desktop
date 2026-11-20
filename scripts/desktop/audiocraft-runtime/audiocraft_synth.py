"""One-shot CPU runner for the two pinned AudioCraft profiles."""

import argparse
import os
from pathlib import Path
import wave


RUNTIME_PROTOCOL = "audiocraft-synth/1"
SAMPLE_RATE = 32_000
CODEC_FRAME_RATE = 50
PROFILES = {"musicgen-small": (1, 30), "magnet-small-30secs": (30, 30)}
CHECKPOINT_FILES = ("state_dict.bin", "compression_state_dict.bin")
T5_FILES = ("config.json", "model.safetensors", "spiece.model")


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--profile", choices=PROFILES)
    parser.add_argument("--models-dir", type=Path)
    parser.add_argument("--prompt")
    parser.add_argument("--duration", type=float)
    parser.add_argument("--seed", type=int)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    generation = (args.profile, args.models_dir, args.prompt, args.duration, args.seed, args.output)
    if args.self_test:
        if any(value is not None for value in generation):
            parser.error("--self-test must be used on its own")
        return args

    if any(value is None for value in generation):
        parser.error(
            "generation requires --profile, --models-dir, --prompt, --duration, --seed and --output"
        )
    if not args.prompt.strip():
        parser.error("--prompt must contain a style description")
    minimum, maximum = PROFILES[args.profile]
    if not minimum <= args.duration <= maximum:
        supported = str(maximum) if minimum == maximum else f"{minimum} to {maximum}"
        parser.error(f"{args.profile} supports {supported} seconds")
    if not 0 <= args.seed <= 0xFFFFFFFF:
        parser.error("--seed must be an unsigned 32-bit integer")
    return args


def model_paths(models_dir, profile):
    root = models_dir.resolve() / "audiocraft"
    checkpoints = root / profile
    encoder = root / "t5-base"
    for directory, names in ((checkpoints, CHECKPOINT_FILES), (encoder, T5_FILES)):
        for name in names:
            path = directory / name
            if not path.is_file():
                raise FileNotFoundError(f"Required AudioCraft file is missing: {path}")
    return checkpoints, encoder


def configure_offline():
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["TORCH_FORCE_WEIGHTS_ONLY_LOAD"] = "1"


def load_runtime():
    import audiocraft
    from audiocraft.models import MAGNeT, MusicGen, loaders
    import torch

    if audiocraft.__version__ != "1.3.0" or not getattr(loaders, "LOCAL_CPU_RUNTIME", False):
        raise RuntimeError("The bundled AudioCraft 1.3.0 local CPU runtime is required")
    return torch, MusicGen, MAGNeT


def self_test():
    torch, _, _ = load_runtime()
    from audiocraft.modules.transformer import StreamingMultiheadAttention
    from sentencepiece import SentencePieceProcessor

    SentencePieceProcessor()

    # A stage attention bias must reach Torch SDPA as an additive mask.
    attention = StreamingMultiheadAttention(2, 1, bias=False, memory_efficient=True).eval()
    with torch.no_grad():
        attention.in_proj_weight.copy_(torch.eye(2).repeat(3, 1))
        attention.out_proj.weight.copy_(torch.eye(2))
        inputs = torch.eye(2)[None]
        mask = torch.tensor([[[[-float("inf"), 0.0], [0.0, -float("inf")]]]])
        output, _ = attention(inputs, inputs, inputs, attn_mask=mask)
        torch.testing.assert_close(output, inputs.flip(1))

        # Incremental MusicGen attention must still see the cached causal prefix.
        causal = StreamingMultiheadAttention(2, 1, bias=False, memory_efficient=True, causal=True).eval()
        causal.load_state_dict(attention.state_dict())
        full, _ = causal(inputs, inputs, inputs)
        with causal.streaming():
            first, second = inputs.split(1, dim=1)
            causal(first, first, first)
            last, _ = causal(second, second, second)
        torch.testing.assert_close(last, full[:, -1:])
    print(RUNTIME_PROTOCOL, flush=True)


def write_wav(output, pcm):
    with wave.open(str(output), "wb") as wav:
        wav.setparams((1, 2, SAMPLE_RATE, 0, "NONE", "not compressed"))
        wav.writeframes(pcm)


def generate(args, checkpoints, encoder):
    os.environ["AUDIOCRAFT_LOCAL_T5_BASE"] = str(encoder)
    torch, musicgen, magnet = load_runtime()
    torch.set_num_threads(min(8, os.cpu_count() or 1))
    model_type = musicgen if args.profile == "musicgen-small" else magnet
    model = model_type.get_pretrained(str(checkpoints), device="cpu")
    if (model.sample_rate, model.audio_channels, model.frame_rate) != (SAMPLE_RATE, 1, CODEC_FRAME_RATE):
        raise RuntimeError("The checkpoint did not supply the expected mono 32 kHz EnCodec")
    if model.max_duration != 30:
        raise RuntimeError("The checkpoint did not supply the expected 30-second context")
    if args.profile == "musicgen-small":
        model.set_generation_params(duration=args.duration)

    torch.manual_seed(args.seed)
    waveform = model.generate([args.prompt]).detach().cpu()
    # The model truncates requested duration to whole 20 ms EnCodec frames.
    expected_samples = int(args.duration * CODEC_FRAME_RATE) * (SAMPLE_RATE // CODEC_FRAME_RATE)
    if waveform.shape != (1, 1, expected_samples) or not waveform.isfinite().all():
        raise RuntimeError("The AudioCraft checkpoint returned invalid audio")
    pcm = (waveform.clamp(-1, 1) * 32767).round().numpy().astype("<i2").tobytes()
    write_wav(args.output, pcm)


def main(argv=None):
    args = parse_args(argv)
    configure_offline()
    if args.self_test:
        self_test()
        return
    checkpoints, encoder = model_paths(args.models_dir, args.profile)
    generate(args, checkpoints, encoder)


if __name__ == "__main__":
    main()
