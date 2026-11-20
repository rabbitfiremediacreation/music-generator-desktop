#!/usr/bin/env python3
"""Measure a Mimetic WAV independently of the generating runtime."""

import argparse
import cmath
import hashlib
import json
import math
import statistics
import wave
from array import array
from functools import lru_cache
from pathlib import Path


def read_wav(path):
    with wave.open(str(path), "rb") as wav:
        rate = wav.getframerate()
        width = wav.getsampwidth()
        channels = wav.getnchannels()
        frames = wav.getnframes()
        pcm = wav.readframes(frames)
    samples = [
        array("i", (
            int.from_bytes(pcm[offset:offset + width], "little", signed=True)
            for offset in range(channel * width, len(pcm), channels * width)
        ))
        for channel in range(channels)
    ]
    if width not in (2, 3, 4) or not pcm or any(len(s) != frames for s in samples):
        raise ValueError(f"unexpected or incomplete signed PCM WAV: {path}")
    return rate, width, channels, frames, pcm, samples


def median_diff(samples, position, window):
    jumps = [
        abs(channel[index] - channel[index - 1])
        for channel in samples
        for index in range(max(1, position - window), min(len(channel), position + window))
        if index != position
    ]
    return statistics.median(jumps)


def transitions(samples, rate, width, bars, bpm):
    frames = len(samples[0])
    points = [("loop", 0)] + [
        (f"bar {bar + 1}", expect_frames(rate, bar, bpm)) for bar in range(1, bars)
    ]
    for label, point in points:
        if point >= frames:
            yield {"transition": label, "seconds": round(point / rate, 6), "present": False}
            continue
        jump = max(abs(channel[point] - channel[point - 1]) for channel in samples)
        baseline = median_diff(samples, point, rate // 100)
        if point == 0:
            baseline = (baseline + median_diff(samples, frames, rate // 100)) / 2
        full_scale = 1 << (width * 8 - 1)
        yield {
            "transition": label,
            "seconds": round(point / rate, 6),
            "peak_step_dbfs": round(20 * math.log10(jump / full_scale), 2) if jump else None,
            "local_median_step_multiple": round(jump / baseline, 2) if baseline else None,
        }


def normalized_similarity(left, right):
    numerator = sum(a * b for a, b in zip(left, right))
    denominator = math.sqrt(sum(a * a for a in left) * sum(b * b for b in right))
    return numerator / denominator if denominator else 0.0


def rhythm(samples, rate, bpm, bars):
    hop = rate // 200
    previous = 0
    envelope = []
    for start in range(0, len(samples[0]) - hop + 1, hop):
        # Average absolute sample derivative across both channels emphasizes attacks.
        energy = sum(
            abs(channel[i] - channel[i - 1]) for channel in samples
            for i in range(max(1, start), start + hop)
        )
        envelope.append(max(0, math.log1p(energy) - math.log1p(previous)))
        previous = energy
    # Exclude the leading comparison with digital zero from tempo identification.
    if envelope:
        envelope[0] = 0
    hop_seconds = hop / rate
    nearby = []
    for candidate in range(max(1, round(bpm * 0.82)), round(bpm * 1.18) + 1):
        lag = round(60 / (candidate * hop_seconds))
        if 0 < lag and len(envelope) > lag * 2:
            corr = normalized_similarity(envelope[:-lag], envelope[lag:])
            nearby.append((corr, candidate))
    beat_step = 60 / bpm / hop_seconds
    expected_lag = max(1, round(beat_step))
    measured = max(nearby, default=(0, None))
    strongest_onset = max(envelope, default=0)
    # Each value is the strongest relative onset +/-40 ms around a requested beat.
    # A quiet beat may be musically intentional (e.g., bass syncopation).
    around_beats = []
    tolerance = round(0.040 / hop_seconds)
    for beat in range(1, 4 * bars):
        step = round(beat * beat_step)
        lo, hi = max(0, step - tolerance), min(len(envelope), step + tolerance + 1)
        if lo < hi and strongest_onset:
            peak = max(range(lo, hi), key=envelope.__getitem__)
            around_beats.append({
                "beat": beat + 1,
                "offset_ms": round((peak - step) * hop_seconds * 1000, 1),
                "relative_attack": round(envelope[peak] / strongest_onset, 2),
            })
    return {
        "candidate_bpm_within_18pct": measured[1],
        "candidate_similarity": round(measured[0], 3),
        "requested_bpm_similarity": round(
            normalized_similarity(envelope[:-expected_lag], envelope[expected_lag:]), 3),
        "expected_beat_windows": around_beats,
    }


@lru_cache(maxsize=None)
def fft_basis(size):
    bits = size.bit_length() - 1
    reverse = [int(f"{index:0{bits}b}"[::-1], 2) for index in range(size)]
    factors = [cmath.exp(-2j * math.pi * index / size) for index in range(size // 2)]
    return reverse, factors


def spectrum(signal, size):
    reverse, factors = fft_basis(size)
    half_window = [0.5 - 0.5 * math.cos(2 * math.pi * i / (len(signal) - 1))
                   for i in range(len(signal))]
    data = [0j] * size
    for i, (sample, w) in enumerate(zip(signal, half_window)):
        data[reverse[i]] = complex(sample * w)
    stride = 2
    while stride <= size:
        half = stride // 2
        for i in range(0, size, stride):
            for offset in range(half):
                a, b = i + offset, i + offset + half
                rotated = data[b] * factors[offset * size // stride]
                data[a], data[b] = data[a] + rotated, data[a] - rotated
        stride *= 2
    return [abs(x) for x in data[:size // 2]]


NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
SCALES = {
    "C-minor": {0, 2, 3, 5, 7, 8, 10},
    "A-minor": {0, 2, 4, 5, 7, 9, 11},
    "C-major": {0, 2, 4, 5, 7, 9, 11},
    "D-minor": {0, 2, 4, 5, 7, 9, 10},
}


def pitches(samples, rate, part, scale):
    downsample = rate // 8000
    decimated_rate = rate / downsample
    mono = [
        sum(sum(channel[i:i + downsample]) for channel in samples)
        for i in range(0, len(samples[0]), downsample)
    ]
    size = 8192
    window = round(decimated_rate * 0.20)
    hop = round(decimated_rate * 0.20)
    low, high = (32.7, 246.94) if part == "bass" else (130.81, 1046.5)
    segments = [(i, mono[i:i + window]) for i in range(0, len(mono) - window + 1, hop)]
    max_energy = max((sum(sample * sample for sample in segment) for _, segment in segments), default=0)
    frames = []
    for i, segment in segments:
        energy = sum(sample * sample for sample in segment)
        if not energy or energy < max_energy / 16:
            continue
        power = spectrum(segment, size)
        start = math.ceil(low * size / decimated_rate)
        end = math.floor(high * size / decimated_rate)
        bin_index = max(range(start, end + 1), key=power.__getitem__)
        left, center, right = [math.log(max(value, 1e-10)) for value in power[bin_index - 1:bin_index + 2]]
        denominator = left - 2 * center + right
        shift = max(-0.5, min(0.5, (left - right) / (2 * denominator))) if denominator else 0.0
        frequency = (bin_index + shift) * decimated_rate / size
        midi = 69 + 12 * math.log2(frequency / 440)
        note = round(midi)
        frames.append({
            "seconds": round((i + window / 2) / decimated_rate, 3),
            "hz": round(frequency, 2),
            "note": f"{NOTES[note % 12]}{note // 12 - 1}",
            "cents": round((midi - note) * 100),
            "in_requested_scale": note % 12 in SCALES[scale],
        })
    return {
        "scale": scale,
        "frames_with_pitch_evidence": len(frames),
        "frames_in_scale": sum(value["in_requested_scale"] for value in frames),
        "dominant_passband_peaks": frames,
    }


def expect_frames(rate, bars, bpm):
    return rate * bars * 240 // bpm


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("clip", type=Path)
    parser.add_argument("--bpm", type=int, required=True)
    parser.add_argument("--bars", type=int, choices=(1, 2, 4), required=True)
    parser.add_argument("--part", choices=("drum", "bass", "melody"), required=True)
    parser.add_argument("--scale", choices=SCALES)
    parser.add_argument("--repeat", type=Path)
    args = parser.parse_args()
    if not 1 <= args.bpm <= 300 or args.bars * 240 > 16 * args.bpm:
        parser.error("expected positive BPM and at most 16 seconds")
    if args.part != "drum" and not args.scale:
        parser.error("pitch assessment requires --scale")
    rate, width, channels, frames, pcm, samples = read_wav(args.clip)
    if rate != 48000 or width != 3 or channels != 2:
        parser.error("expected stereo 48 kHz 24-bit PCM")
    target = expect_frames(rate, args.bars, args.bpm)
    result = {
        "file": str(args.clip),
        "sha256": hashlib.sha256(args.clip.read_bytes()).hexdigest(),
        "pcm_sha256": hashlib.sha256(pcm).hexdigest(),
        "sample_rate": rate,
        "channels": channels,
        "pcm_bits": width * 8,
        "frames": frames,
        "target_frames": target,
        "frame_error": frames - target,
        "seconds": round(frames / rate, 9),
        "requested_bpm": args.bpm,
        "requested_bars": args.bars,
        "transitions": list(transitions(samples, rate, width, args.bars, args.bpm)),
        "rhythm": rhythm(samples, rate, args.bpm, args.bars),
    }
    if args.scale:
        result["pitch"] = pitches(samples, rate, args.part, args.scale)
    if args.repeat:
        rerun = read_wav(args.repeat)
        result["repeat_file"] = str(args.repeat)
        result["repeat_pcm_sha256"] = hashlib.sha256(rerun[4]).hexdigest()
        result["repeat_same_pcm"] = rerun[:5] == (rate, width, channels, frames, pcm)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
