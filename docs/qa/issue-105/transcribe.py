"""Write supplemental Whisper hypotheses for locally stored QA WAV files."""

import argparse
import csv
from pathlib import Path

from probe import sha256


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True, type=Path, help="Local Whisper model directory")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("wavs", nargs="+", type=Path)
    args = parser.parse_args()
    if not args.model.is_dir():
        parser.error("--model must point to a local Whisper model directory")
    if len({wav.stem for wav in args.wavs}) != len(args.wavs):
        parser.error("WAV basenames must be unique")

    from faster_whisper import WhisperModel

    model = WhisperModel(str(args.model), device="cpu", compute_type="int8",
                         cpu_threads=4, local_files_only=True)
    with args.output.open("x", encoding="utf-8", newline="") as output:
        writer = csv.writer(output, lineterminator="\n")
        writer.writerow(["sample", "wav_sha256", "asr_language", "asr_language_probability",
                         "asr_timestamped_hypothesis"])
        for wav in sorted(args.wavs):
            segments, info = model.transcribe(
                str(wav), language=None, task="transcribe", beam_size=5, temperature=0,
                condition_on_previous_text=False, vad_filter=False,
            )
            hypothesis = " | ".join(
                f"{segment.start:.2f}–{segment.end:.2f} s {segment.text.strip()}"
                for segment in segments if segment.text.strip()
            )
            writer.writerow([wav.stem, sha256(wav), info.language,
                             f"{info.language_probability:.4f}", hypothesis])
            output.flush()


if __name__ == "__main__":
    main()
