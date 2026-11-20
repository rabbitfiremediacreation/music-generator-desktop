"""Convert the one official Text2midi REMI pickle to canonical JSON."""

import argparse
import hashlib
import io
import json
import pickle
from pathlib import Path


SOURCE_BYTES = 27_256
SOURCE_SHA256 = "877d4511d6b9d5eea1c706199fe13a0de3d984c8f5d09c75d727ffe7f6f54ee6"
VOCAB_SIZE = 524


class _State:
    """Capture dictionary state on an inert object in place of a library class."""


class _Discarded:
    """Stand in for derived NumPy arrays and scalars rebuilt by MidiTok."""

    def __init__(self, *args):
        pass

    def __setstate__(self, state):
        pass


class _VocabularyUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        if (module, name) in {
            ("miditok.tokenizations.remi", "REMI"),
            ("miditok.classes", "TokenizerConfig"),
        }:
            return _State
        if (module, name) in {
            ("numpy.core.multiarray", "_reconstruct"),
            ("numpy.core.multiarray", "scalar"),
            ("numpy", "dtype"),
            ("numpy", "ndarray"),
        }:
            return _Discarded
        raise pickle.UnpicklingError(f"Unexpected vocabulary global: {module}.{name}")

    def persistent_load(self, pid):
        raise pickle.UnpicklingError("Unexpected vocabulary persistent ID")


def convert(source):
    with source.open("rb") as stream:
        data = stream.read(SOURCE_BYTES + 1)
    if len(data) != SOURCE_BYTES or hashlib.sha256(data).hexdigest() != SOURCE_SHA256:
        raise ValueError("Expected the pinned official Text2midi vocabulary")

    tokenizer = _VocabularyUnpickler(io.BytesIO(data)).load()
    vocab = tokenizer._vocab_base
    if tokenizer._model is not None or sorted(vocab.values()) != list(range(VOCAB_SIZE)):
        raise ValueError("Unexpected REMI vocabulary layout")

    config = vars(tokenizer.config).copy()
    for key in ("beat_res", "beat_res_rest"):
        config[key] = {f"{start}_{end}": value for (start, end), value in config[key].items()}
    # MidiTok creates TimeSig tokens in denominator insertion order.
    config["time_signature_range"] = list(config["time_signature_range"].items())
    tokens = sorted(vocab, key=vocab.__getitem__)
    return json.dumps({"config": config, "tokens": tokens}, indent=2, sort_keys=True) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.write_bytes(convert(args.source).encode("utf-8"))


if __name__ == "__main__":
    main()
