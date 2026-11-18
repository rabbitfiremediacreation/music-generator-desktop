"""Run the issue #105 matrix against an isolated ACE-Step desktop runtime."""

import argparse
from array import array
from contextlib import contextmanager
import csv
from email import policy
from email.parser import BytesParser
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import wave


MODELS = {
    size: f"acestep-5Hz-lm-{size}-Q8_0.gguf"
    for size in ("0.6B", "1.7B", "4B")
}
SYNTH = "acestep-v15-sft-Q8_0.gguf"
LANGUAGES = {"de": "German", "en": "English", "es": "Spanish"}
SEEDS = ((12345, 3), (67890, 7))
CAPTION = "midtempo synth-pop, warm analog keys, steady drums, round bass"
VOCALS = f"{CAPTION}, one clear lead singing voice"
CONTROL = f"{CAPTION}, instrumental arrangement, keys carry the melody"


def matrix(size):
    for seed, lm_seed in SEEDS:
        for code, language in [*LANGUAGES.items(), ("instrumental", None)]:
            request = {
                "caption": VOCALS if language else CONTROL,
                "bpm": 110,
                "duration": 30,
                "seed": seed,
                "lm_seed": lm_seed,
                "lm_temperature": 0.85,
                "use_cot_caption": False,
                "inference_steps": 80,
                "lm_model": MODELS[size],
                "synth_model": SYNTH,
                "output_format": "wav16",
                "peak_clip": 0,
            }
            if language:
                request["vocal_language"] = language
            else:
                request["lyrics"] = "[Instrumental]"
            yield f"{size}-{code}-{seed}", code, request


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def save_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def item(value):
    value = value[0] if isinstance(value, list) and len(value) == 1 else value
    if not isinstance(value, dict):
        raise ValueError("Expected one engine result")
    return value


def synthesis_parts(content_type, body):
    if not content_type.lower().startswith("multipart/"):
        raise ValueError(f"Synthesis needs both audio and step evidence, got {content_type}")
    header = f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n"
    message = BytesParser(policy=policy.default).parsebytes(header.encode("ascii") + body)
    audio = [part.get_payload(decode=True) for part in message.iter_parts()
             if part.get_content_maintype() == "audio"]
    metadata = [part.get_payload(decode=True) for part in message.iter_parts()
                if part.get_content_type() == "application/json"]
    if len(audio) != 1 or len(metadata) != 1:
        raise ValueError("Expected one audio and one JSON part")
    return audio[0], item(json.loads(metadata[0]))


def signal(path):
    with wave.open(str(path), "rb") as wav:
        channels, rate, frames = wav.getnchannels(), wav.getframerate(), wav.getnframes()
        if wav.getsampwidth() != 2 or not frames:
            raise ValueError("Expected nonempty PCM16 WAV")
        samples = array("h")
        samples.frombytes(wav.readframes(frames))
    if len(samples) != channels * frames:
        raise ValueError("PCM data is shorter than the WAV header declares")
    if sys.byteorder != "little":
        samples.byteswap()
    peak = max(abs(min(samples)), abs(max(samples)))
    rms = math.sqrt(sum(sample * sample for sample in samples) / len(samples))
    return {
        "sha256": sha256(path),
        "duration_seconds": frames / rate,
        "channels": channels,
        "sample_rate_hz": rate,
        "peak_dbfs": round(20 * math.log10(peak / 32768), 2) if peak else None,
        "rms_dbfs": round(20 * math.log10(rms / 32768), 2) if rms else None,
        "pcm_endpoint_samples": samples.count(-32768) + samples.count(32767),
    }


def http(base, path, request=None):
    payload = None if request is None else json.dumps(request).encode("utf-8")
    req = urllib.request.Request(base + path, payload, {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as response:
        return response.headers["Content-Type"], response.read()


def run_job(base, stage, request):
    _, body = http(base, f"/{stage}", request)
    query = "/job?" + urllib.parse.urlencode({"id": json.loads(body)["id"]})
    deadline = time.monotonic() + 600
    while time.monotonic() < deadline:
        status = json.loads(http(base, query)[1])
        if status["status"] == "done":
            return http(base, query + "&result=1")
        if status["status"] in ("failed", "cancelled", "error"):
            raise RuntimeError(f"{stage} {status}")
        time.sleep(0.25)
    raise TimeoutError(f"{stage} {query}")


@contextmanager
def server(engine, models, output):
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    env = {**os.environ, "XDG_CACHE_HOME": str(output / "cache")}
    for key in ("GGML_BACKEND", "GGML_METAL_DEVICES"):
        env.pop(key, None)
    with (output / "engine.log").open("w") as log:
        process = subprocess.Popen(
            [str(engine), "--models", str(models), "--host", "127.0.0.1",
             "--port", str(port), "--max-batch", "1", "--keep-loaded"],
            cwd=engine.parent, env=env, stdout=log, stderr=log,
        )
        try:
            for _ in range(120):
                if process.poll() is not None:
                    raise RuntimeError(f"Engine exited with {process.returncode}")
                try:
                    http(base, "/health")
                    break
                except urllib.error.URLError:
                    time.sleep(0.5)
            else:
                raise TimeoutError("Engine startup")
            yield base
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


def synth_request(request, lm, code):
    payload = dict(lm)
    if code in LANGUAGES:
        payload["vocal_language"] = code
    else:
        payload.pop("vocal_language", None)
        payload["lyrics"] = "[Instrumental]"
    for key in ("duration", "seed", "inference_steps", "synth_model", "output_format", "peak_clip"):
        payload[key] = request[key]
    for key in ("inference_steps_limit", "effective_inference_steps"):
        payload.pop(key, None)
    return payload


def probe(base, case, output):
    name, code, request = case
    record = {"id": name, "requested_language": code if code in LANGUAGES else None,
              "lm_request": request}
    path = output / f"{name}.json"
    save_json(path, record)
    started = time.monotonic()
    lm = item(json.loads(run_job(base, "lm", request)[1]))
    record["lm_seconds"] = round(time.monotonic() - started, 2)
    record["lm_result"] = lm
    record["synth_request"] = synth_request(request, lm, code)
    save_json(path, record)
    started = time.monotonic()
    audio, meta = synthesis_parts(*run_job(base, "synth", record["synth_request"]))
    record["synth_seconds"] = round(time.monotonic() - started, 2)
    record["synth_result"] = meta
    if meta.get("effective_inference_steps") != request["inference_steps"]:
        save_json(path, record)
        raise ValueError(f"{name}: synth did not confirm requested steps: {meta}")
    wav = output / f"{name}.wav"
    wav.write_bytes(audio)
    record["signal"] = signal(wav)
    save_json(path, record)
    print(name, record["lm_seconds"], record["synth_seconds"], record["signal"], flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("engine", "models", "output"):
        parser.add_argument(f"--{name}", required=True, type=Path)
    parser.add_argument("--size", required=True, choices=MODELS, nargs="+")
    args = parser.parse_args()
    engine, models, output = (p.resolve() for p in (args.engine, args.models, args.output))
    output.mkdir(parents=True, exist_ok=False)
    versions = json.loads((engine.parent / "VERSION.desktop.json").read_text())
    manifest = json.loads((Path(__file__).resolve().parents[3] / "models/manifest.json").read_text())
    pinned = {model["file"]: model["sha256"] for model in manifest["models"]}
    files = [SYNTH, "vae-BF16.gguf", "Qwen3-Embedding-0.6B-Q8_0.gguf"]
    files.extend(MODELS[size] for size in dict.fromkeys(args.size))
    hashes = {name: sha256(models / name) for name in files}
    if any(pinned[name] != digest for name, digest in hashes.items()):
        raise ValueError(f"Model checksums differ from models/manifest.json: {hashes}")
    save_json(output / "environment.json", {
        "platform": platform.platform(),
        "python": platform.python_version(),
        "engine": {key: versions[key] for key in ("revision", "source_revision", "max_inference_steps")},
        "models": hashes,
        "model_source": manifest["base_url"],
        "sizes": list(dict.fromkeys(args.size)),
    })
    cases = [case for size in dict.fromkeys(args.size) for case in matrix(size)]
    with (output / "listening.csv").open("w", newline="", encoding="utf-8") as file:
        writer = csv.writer(file)
        writer.writerow(["sample", "requested_language", "audible_language", "vocals",
                         "intelligibility", "repetitions", "audible_defects", "timestamps", "listener"])
        writer.writerows((name, code, "pending", "pending", "pending", "pending", "pending", "", "")
                         for name, code, _ in cases)
    with server(engine, models, output) as base:
        for case in cases:
            probe(base, case, output)


if __name__ == "__main__":
    main()
