"""One-shot, local clip generation for Music Generator Desktop."""

import argparse
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from threading import RLock


SAMPLE_RATE = 48_000
MAX_SECONDS = 16
MODEL_PREFIX = "mimetic-a0-"
T5_FILES = ("config.json", "model.safetensors", "tokenizer.json")


def configure_environment():
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["TOKENIZERS_PARALLELISM"] = "false"
    # Eager inference does not need a pool that relaunches sys.executable as Python.
    os.environ["TORCHINDUCTOR_COMPILE_THREADS"] = "1"


def self_test():
    import torch
    from transformers import T5EncoderModel
    from stable_audio_tools.models import create_model_from_config
    import soundfile

    print(json.dumps({
        "runtime": "mimetic-a0",
        "python": sys.version.split()[0],
        "isolated": bool(sys.flags.isolated),
        "torch": torch.__version__,
        "soundfile": soundfile.__version__,
        "t5": T5EncoderModel.__name__,
        "factory": create_model_from_config.__name__,
        "mps": torch.backends.mps.is_available(),
        "cuda": torch.cuda.is_available(),
    }))


def arguments():
    parser = argparse.ArgumentParser(description="Generate a local 48 kHz stereo Mimetic A0 clip")
    parser.add_argument("--model-folder", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--bpm", required=True, type=int, choices=range(1, 301), metavar="BPM")
    parser.add_argument("--bars", required=True, type=int, choices=(1, 2, 4))
    parser.add_argument("--seed", required=True, type=int, metavar="SEED")
    parser.add_argument("--device", required=True, choices=("mps", "cpu", "cuda"))
    args = parser.parse_args()
    if args.bars * 240 > MAX_SECONDS * args.bpm:
        parser.error("The requested BPM and bar count exceed 16 seconds")
    if not 0 <= args.seed <= 2**32 - 1:
        parser.error("The seed must fit in an unsigned 32-bit integer")
    if not args.prompt.strip():
        parser.error("The prompt must contain text")
    return args


def model_asset(folder, name):
    asset = folder / (MODEL_PREFIX + name)
    if not asset.is_file():
        raise FileNotFoundError(f"Missing local model file: {asset.name}")
    return asset


def local_model_config(folder, encoder):
    for name in T5_FILES:
        (encoder / name).symlink_to(model_asset(folder, "t5-" + name))
    config = json.loads(model_asset(folder, "model_config.json").read_text(encoding="utf-8"))
    for conditioner in config["model"]["conditioning"]["configs"]:
        if conditioner["id"] == "prompt" and conditioner["type"] == "t5":
            conditioner["config"]["model_path"] = str(encoder)
            return config
    raise ValueError("The Mimetic A0 config does not define the expected T5 conditioner")


def conditioned_prompt(args, conditioner):
    description = args.prompt.strip()
    unit = "bar" if args.bars == 1 else "bars"
    meter = f"{args.bpm} BPM, {args.bars} {unit}"
    prompt = f"{description}, {meter}"
    tokenizer = conditioner.tokenizer
    if not tokenizer.is_fast:
        raise RuntimeError("Mimetic A0 requires the local fast T5 tokenizer")
    if len(tokenizer(prompt, verbose=False)["input_ids"]) > conditioner.max_length:
        return f"{meter}, {description}"
    return prompt


def generate(args, encoder):
    import soundfile
    import torch
    from mimetic_a0.generate import peak_normalise
    from mimetic_a0.model import _apg_on_cpu
    from stable_audio_tools.inference.generation import generate_diffusion_cond
    from stable_audio_tools.models import create_model_from_config
    from stable_audio_tools.models.utils import load_ckpt_state_dict
    from tqdm import tqdm

    # The launcher owns a single process. Avoid starting Python's resource
    # tracker for tqdm's default multiprocessing progress lock.
    tqdm.set_lock(RLock())

    if args.device == "mps" and not torch.backends.mps.is_available():
        raise RuntimeError("The PyTorch Metal backend is unavailable")
    if args.device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("The PyTorch CUDA backend is unavailable")

    folder = args.model_folder.resolve(strict=True)
    weights = model_asset(folder, "model.fp16.safetensors")
    config = local_model_config(folder, encoder)
    model = create_model_from_config(config)
    prompt = conditioned_prompt(args, model.conditioner.conditioners["prompt"])
    model.load_state_dict(load_ckpt_state_dict(str(weights)))
    if args.device != "cpu":
        model = model.half()
    model = model.to(args.device).eval().requires_grad_(False)
    if args.device == "mps":
        for module in model.modules():
            if hasattr(module, "apg_project"):
                module.apg_project = _apg_on_cpu(module.apg_project)

    beats = args.bars * 4
    seconds = beats * 60 / args.bpm
    frames = beats * 60 * SAMPLE_RATE // args.bpm
    with torch.no_grad():
        audio = generate_diffusion_cond(
            model,
            steps=50,
            cfg_scale=6.0,
            conditioning=[{"prompt": prompt, "seconds_start": 0, "seconds_total": seconds}],
            sample_size=config["sample_size"],
            seed=args.seed,
            device=args.device,
        )
    if config["sample_rate"] != SAMPLE_RATE or audio.shape[1] != 2 or audio.shape[2] < frames:
        raise ValueError("Mimetic A0 returned an unexpected sample rate, channel count or duration")
    clip = peak_normalise(audio[0, :, :frames].float().cpu())
    soundfile.write(args.output, clip.T.numpy(), SAMPLE_RATE, subtype="PCM_24")


def main():
    configure_environment()
    if sys.argv[1:] == ["--self-test"]:
        self_test()
        return
    args = arguments()
    with TemporaryDirectory(prefix="mimetic-t5-", dir=args.output.absolute().parent) as encoder:
        generate(args, Path(encoder))


if __name__ == "__main__":
    try:
        main()
    except SystemExit as exit_status:
        # argparse uses SystemExit for help and validation. Keep its status without
        # invoking interpreter finalization through the C API error handler.
        code = exit_status.code
        if code is None:
            code = 0
        elif not isinstance(code, int):
            print(code, file=sys.stderr)
            code = 1
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(code)
