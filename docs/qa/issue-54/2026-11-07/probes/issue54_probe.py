import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import time
import urllib.request


def http(url, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)


def free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def run_job(base, request):
    job = http(base + "/lm", request)
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        status = http(base + "/job?id=" + str(job["id"]))
        if status.get("status") == "done":
            return http(base + "/job?id=" + str(job["id"]) + "&result=1")
        if status.get("status") in ["failed", "cancelled"]:
            raise RuntimeError(status)
        time.sleep(0.25)
    raise TimeoutError(job)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", required=True)
    parser.add_argument("--models", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    port = free_port()
    base = "http://127.0.0.1:" + str(port)
    env = dict(os.environ, XDG_CACHE_HOME=str(output / "cache"))
    env.pop("GGML_BACKEND", None)
    env.pop("GGML_METAL_DEVICES", None)
    with (output / "engine.log").open("w") as log:
        process = subprocess.Popen([args.engine, "--models", args.models, "--host", "127.0.0.1", "--port", str(port), "--max-batch", "1", "--keep-loaded"], cwd=Path(args.engine).parent, env=env, stdout=log, stderr=log)
        try:
            for _ in range(120):
                if process.poll() is not None:
                    raise RuntimeError("engine exited: " + str(process.returncode))
                try:
                    http(base + "/health")
                    break
                except Exception:
                    time.sleep(0.5)
            else:
                raise TimeoutError("engine startup")
            cases = [("en-before-3", "en", 1.2, 3), ("en-current-3", "English", 0.85, 3), ("en-current-6", "English", 0.85, 6), ("en-current-7", "English", 0.85, 7), ("de-before-3", "de", 0.85, 3), ("de-current-3", "German", 0.85, 3), ("de-current-6", "German", 0.85, 6), ("de-current-7", "German", 0.85, 7)]
            for name, language, temperature, seed in cases:
                request = {"caption": "synthwave, retro pop, layered female vocals, analog synths, driving bass, wide reverb", "duration": 120, "bpm": 110, "vocal_language": language, "lm_temperature": temperature, "seed": 12345, "lm_seed": seed, "lm_model": "acestep-5Hz-lm-4B-Q8_0.gguf", "synth_model": "acestep-v15-sft-Q8_0.gguf", "output_format": "wav16", "peak_clip": 0, "inference_steps": 5, "use_cot_caption": True}
                (output / (name + "-request.json")).write_text(json.dumps(request, ensure_ascii=False, indent=2) + "\n")
                started = time.monotonic()
                result = run_job(base, request)
                (output / (name + "-response.json")).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
                item = result[0] if isinstance(result, list) else result
                print(name, "seconds", round(time.monotonic() - started, 2), "codes", len(item.get("audio_codes", "").split(",")), "lyrics", repr(item.get("lyrics", "")), flush=True)
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


if __name__ == "__main__":
    main()
