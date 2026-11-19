"""Generate an editable MIDI composition from a caption using local model files."""

import argparse
from base64 import b64decode
from contextlib import contextmanager
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory


VOCABULARY = Path(__file__).with_name("vocab_remi.json")
DEFAULT_MAX_TOKENS = 512
MAX_TOKENS = 2000


@contextmanager
def model_access():
    bookmark = os.environ.get("MUSIC_MODEL_BOOKMARK")
    if not bookmark:
        yield
        return

    from Foundation import NSData, NSURL, NSURLBookmarkResolutionWithoutUI

    data = b64decode(bookmark, validate=True)
    encoded = NSData.dataWithBytes_length_(data, len(data))
    resolve = NSURL.URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error_
    url, _, error = resolve(encoded, NSURLBookmarkResolutionWithoutUI, None, None, None)
    if url is None:
        message = error.localizedDescription() if error is not None else "invalid model folder bookmark"
        raise ValueError(f"Model folder access: {message}")
    access_started = url.startAccessingSecurityScopedResource()
    try:
        yield
    finally:
        if access_started:
            url.stopAccessingSecurityScopedResource()


def load_vocabulary():
    from miditok import REMI, TokenizerConfig

    vocab = json.loads(VOCABULARY.read_bytes())
    config = vocab["config"]
    for key in ("beat_res", "beat_res_rest"):
        config[key] = {
            tuple(map(int, span.split("_"))): value for span, value in config[key].items()
        }
    config["time_signature_range"] = dict(config["time_signature_range"])
    tokenizer = REMI(TokenizerConfig.from_dict(config))
    tokens = vocab["tokens"]
    if tokenizer.vocab != {token: index for index, token in enumerate(tokens)}:
        raise ValueError("The installed REMI decoder disagrees with the model vocabulary")
    return tokenizer


def run(model_dir, prompt, output, seed, max_tokens):
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ.setdefault("HF_HOME", str(output.parent / "huggingface"))

    print("Text2midi: loading local CPU runtime", file=sys.stderr, flush=True)
    import torch
    from transformers import T5Config, T5EncoderModel, T5Tokenizer

    from decoder import Text2Midi

    weights_dir = model_dir / "text2midi"
    flan_dir = weights_dir / "flan-t5-base"
    if not flan_dir.is_dir():
        raise ValueError("The local FLAN-T5 files are missing")
    torch.set_num_threads(min(4, os.cpu_count() or 1))
    remi = load_vocabulary()
    tokenizer = T5Tokenizer.from_pretrained(str(flan_dir), local_files_only=True, legacy=True)
    config = T5Config.from_json_file(flan_dir / "config.json")

    # The upstream Text2midi checkpoint includes all FLAN-T5 encoder tensors and
    # replaces the separately loaded encoder. The strict load enforces that layout.
    with torch.device("meta"):
        model = Text2Midi(len(remi), T5EncoderModel(config))
    weights = torch.load(
        weights_dir / "pytorch_model.bin", map_location="cpu", weights_only=True, mmap=True,
    )
    model.load_state_dict(weights, strict=True, assign=True)
    model.eval()
    inputs = tokenizer(prompt, return_tensors="pt", truncation=True, max_length=512)
    print(f"Text2midi: generating {max_tokens} REMI tokens", file=sys.stderr, flush=True)
    generator = torch.Generator().manual_seed(seed)
    with torch.inference_mode():
        tokens = model.generate(inputs, remi.vocab["BOS_None"], max_tokens, generator)

    score = remi.decode(tokens)
    if not any(track.notes for track in score.tracks):
        raise ValueError("Text2midi generated no MIDI notes for this prompt and seed")
    with TemporaryDirectory(dir=output.parent) as staging:
        staged_output = Path(staging) / "output.mid"
        score.dump_midi(staged_output)
        staged_output.replace(output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", required=True, type=Path)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--seed", required=True, type=int)
    parser.add_argument("--max-tokens", default=DEFAULT_MAX_TOKENS, type=int)
    args = parser.parse_args()
    if not args.prompt.strip():
        parser.error("--prompt must contain a caption")
    if args.output.suffix.lower() != ".mid":
        parser.error("--output must have a .mid extension")
    if not 1 <= args.max_tokens <= MAX_TOKENS:
        parser.error(f"--max-tokens must be between 1 and {MAX_TOKENS}")
    if not 0 <= args.seed < 2**32:
        parser.error("--seed must be between 0 and 4294967295")
    try:
        with model_access():
            run(args.model_dir, args.prompt, args.output, args.seed, args.max_tokens)
    except Exception as error:
        print(f"Text2midi: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
