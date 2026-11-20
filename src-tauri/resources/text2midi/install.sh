#!/bin/bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
    echo "Usage: bash install.sh APP_DATA_DIR [LOCAL_WHEEL_DIRECTORY]" >&2
    exit 2
fi
if [[ "$(uname -s)" != Darwin || "$(uname -m)" != arm64 ]]; then
    echo "Text2midi requires macOS on Apple silicon." >&2
    exit 2
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
python="${TEXT2MIDI_PYTHON:-python3.12}"
if ! "$python" -sEB -c 'import platform, sys; assert platform.machine() == "arm64" and sys.version_info[:2] == (3, 12)' 2>/dev/null; then
    echo "Install arm64 Python 3.12 and put python3.12 on PATH, or set TEXT2MIDI_PYTHON to its absolute path." >&2
    exit 2
fi

runtime_packages_present() {
    "$1" -sEB -c '
from importlib.util import find_spec
import sys

packages = ("Foundation", "miditok", "sentencepiece", "symusic", "torch", "transformers")
sys.exit(not all(find_spec(package) is not None for package in packages))
'
}

runtime_dir="$1/runtimes"
destination="$runtime_dir/text2midi-v1"
if [[ -e "$destination" ]]; then
    if runtime_packages_present "$destination/bin/python3" 2>/dev/null; then
        echo "Text2midi runtime is already installed."
        exit 0
    fi
    echo "Move the damaged runtime at $destination aside before reinstalling." >&2
    exit 1
fi
mkdir -p -- "$runtime_dir"
staging="$(mktemp -d "$runtime_dir/.text2midi-v1.XXXXXX")"
trap 'rm -rf -- "$staging"' EXIT
"$python" -sEB -m venv --copies "$staging"
pip_source=(--index-url https://pypi.org/simple)
if [[ $# -eq 2 ]]; then
    pip_source=(--no-index --find-links "$2")
fi
"$staging/bin/python3" -sEB -m pip --isolated --disable-pip-version-check install \
    --no-cache-dir --only-binary=:all: --require-hashes \
    "${pip_source[@]}" -r "$script_dir/requirements-macos-arm64-py312.txt"
"$staging/bin/python3" -sEB -m pip --isolated --no-cache-dir check
runtime_packages_present "$staging/bin/python3"
# An installation that finishes concurrently already has a non-empty destination.
"$python" -sEB -c 'import os, sys; os.rename(*sys.argv[1:])' "$staging" "$destination"
trap - EXIT
echo "Text2midi runtime installed. Reopen the ModelPicker."
