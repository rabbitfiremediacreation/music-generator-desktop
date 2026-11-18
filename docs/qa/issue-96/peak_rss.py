"""Run from this checkout with Python 3 on macOS or Linux."""

import os
from pathlib import Path
from statistics import median
import subprocess
import sys
from tempfile import TemporaryDirectory

BASELINE = "c982d54c7abff35463c6c31517a3b3f69389b963"


def measure(binary, seconds, mode):
    samples = []
    for _ in range(3):
        pid = os.posix_spawn(binary, [binary, str(seconds), mode], os.environ)
        _, status, usage = os.wait4(pid, 0)
        if os.waitstatus_to_exitcode(status) != 0:
            raise RuntimeError(f"{mode} failed at {seconds} seconds")
        # Darwin reports bytes and Linux reports KiB.
        samples.append(usage.ru_maxrss / (2**20 if sys.platform == "darwin" else 2**10))
    values = ", ".join(f"{sample:.2f}" for sample in samples)
    print(f"{seconds:3}s {mode:8s} {values} MiB | median {median(samples):.2f} MiB")


def main():
    here = Path(__file__).resolve().parent
    repo = here.parents[2]
    response = Path("src-tauri/src/engine/response.rs")
    baseline = subprocess.check_output(
        ["git", "show", f"{BASELINE}:{response}"], cwd=repo
    )
    with TemporaryDirectory(prefix="music-issue-96-") as temp:
        root = Path(temp)
        source = root / "src"
        source.mkdir()
        (source / "main.rs").write_bytes((here / "peak_rss.rs").read_bytes())
        (source / "baseline.rs").write_bytes(baseline)
        (source / "current.rs").write_bytes((repo / response).read_bytes())
        (root / "Cargo.lock").write_bytes((repo / "src-tauri/Cargo.lock").read_bytes())
        (root / "Cargo.toml").write_text(
            '[package]\nname = "peak-rss"\nversion = "0.0.0"\nedition = "2021"\n'
            '[dependencies]\nmailparse = "=0.16.1"\nserde_json = "=1.0.154"\n'
        )
        subprocess.run(["cargo", "build", "--release", "--jobs", "2"], cwd=root, check=True)
        binary = str(root / "target/release/peak-rss")
        for seconds in (120, 600):
            for mode in ("body", "baseline", "current"):
                measure(binary, seconds, mode)


if __name__ == "__main__":
    main()
