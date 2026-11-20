# Text2midi runtime

The inference architecture adapts AMAAI Lab’s MIT-licensed Text2midi at
`f3245ee`. `decoder.py` implements the published dense decoder in evaluation mode. It
computes the caption encoder output once and preserves the released checkpoint’s
attention layout, positional embedding and sampling at temperature 1.
[Pinned reference implementation](https://github.com/AMAAI-Lab/Text2midi/tree/f3245ee402b29ba00b86c6eb9813032f3f05954f)

The model checkpoint includes the FLAN-T5 encoder tensors. The runtime builds the
architecture from the pinned Google FLAN-T5 Base configuration and strictly
loads the full Text2midi state dict, including the encoder. The tokenizer uses
the local FLAN-T5 SentencePiece and tokenizer configuration files. The Google
model repository’s separate weights are redundant for this checkpoint. The
catalog records the SHA-256 and size of each downloaded file.
[Model catalog](../../../models/catalog.json)

## Install and use

Open **Settings → Models and hardware test → Text2midi**. On Apple silicon with
macOS 14 or later,
install an arm64 CPython 3.12, run the one-time command shown in the ModelPicker,
and reopen it. The command installs the hash-pinned Python wheels into the
app’s data directory. It uses PyPI by default and accepts a local wheel directory
as its second argument for an offline installation. In a development checkout
run the following command with the app data directory.

```sh
bash src-tauri/resources/text2midi/install.sh /path/to/app-data
```

The virtual environment uses the CPython installation that created it. If a
Python upgrade removes that installation, move the affected
`runtimes/text2midi-v1` directory aside and run the terminal command again.

Read the upstream terms shown in the ModelPicker before choosing **Download and
use**. To import instead, place all five files in the model directory using
their listed paths and choose **Verify and use**. Both actions check the file
sizes and SHA-256 hashes. Once installed, select Text2midi in the studio, enter
a caption, and click **Generate MIDI**. The library row offers **Export MIDI**.
MIDI tracks and notes can be edited in a DAW with a Standard MIDI File import.
Audio rendering requires a separate instrument or renderer.

## Reproduce the JSON vocabulary

The bundled `vocab_remi.json` contains the REMI configuration and the 524 tokens
in checkpoint ID order. Its SHA-256 is
`ba7c3f890496896bd22f67b9be11e645126791c45a8a5b59ff75c3cb3b941843` and its size is
13,691 bytes. It is a derived artifact from AMAAI Lab’s Apache-2.0 model package.
The conversion changes the serialization and omits state that MidiTok rebuilds
from the configuration.

Obtain the official 27,256-byte `vocab_remi.pkl` with SHA-256
`877d4511d6b9d5eea1c706199fe13a0de3d984c8f5d09c75d727ffe7f6f54ee6`.
The converter verifies the exact bytes before deserializing. Recognized class and reducer
references are mapped to inert local placeholders. Inference consumes the
bundled JSON and verifies that MidiTok rebuilds the same token IDs.
[Pinned vocabulary source](https://huggingface.co/amaai-lab/text2midi/resolve/9bc91479c4a9b08a9a28a7dcfb3f1a56ee2ded36/vocab_remi.pkl)

```sh
python3 convert_vocab.py /path/to/vocab_remi.pkl /tmp/vocab_remi.json
cmp ../../../src-tauri/resources/text2midi/vocab_remi.json /tmp/vocab_remi.json
```

## Local verification

Use the app’s pinned Python environment and the model directory produced by its
model downloader or local import. This directory contains the `text2midi`
subdirectory. Install `mido==1.3.3` in a test environment to read generated MIDI
independently of the runtime. Optionally supply the original pinned pickle to
check byte-for-byte conversion as part of the tests.

```sh
TEXT2MIDI_TEST_PICKLE=/path/to/vocab_remi.pkl python3 -m unittest test_runtime
python3 ../../../src-tauri/resources/text2midi/text2midi.py --model-dir /path/to/models \
  --prompt 'A melodic electronic piece with piano, acoustic guitar, alto saxophone, strings and electric bass. G minor, 4/4, medium tempo around 120 BPM.' \
  --seed 133 --output /tmp/arrangement.mid
```

The default CPU generation budget is 512 REMI tokens. Each MIDI note can require
several tokens. The caption can request tempo, instrumentation and harmony, and
the resulting tracks and duration depend on the sampled composition.

### Queue acceptance on macOS

With the model files and runtime already installed, the opt-in Rust test runs
the ModelDownloader’s local verification, the real worker, an in-flight
cancellation, and byte-for-byte MIDI export. Use the debug supervisor alongside
the test executable:

```sh
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --no-run --lib
cargo build --manifest-path src-tauri/Cargo.toml --bin music-engine-supervisor
ln -s ../music-engine-supervisor src-tauri/target/debug/deps/music-engine-supervisor
TEXT2MIDI_TEST_MODELS=/path/to/models \
TEXT2MIDI_TEST_RUNTIME=/path/to/app-data/runtimes/text2midi-v1 \
TEXT2MIDI_TEST_EXPORT=/tmp/text2midi-acceptance.mid \
  sandbox-exec -p '(version 1) (allow default) (deny network*)' \
  cargo test --offline --manifest-path src-tauri/Cargo.toml --lib \
  text2midi_offline_queue_import_cancel_and_export -- --ignored --nocapture
```

### Hardware verification

On 2026-11-19 the pinned CPython 3.12.16 and PyTorch 2.8.0 CPU runtime ran on
an Apple M5 Pro with 64 GiB of RAM and macOS 26.6.2 (25G83). macOS
`sandbox-exec` denied network access for the runtime and its child processes.
The default 512-token run used the verified five-file model set and produced a
Standard MIDI File type 1 with 9 note tracks, 116 notes, two tempo events at
121.29 BPM and a 4/4 time signature. The file is 1,171 bytes with SHA-256
`d3cb599d6e324163f7ee2abc3dd8bf1f1514151430cd626681d308b4a7f2663c`.
Mido 1.3.3 independently parsed it, changed the first note from pitch 46 to
45, saved the copy, and reopened it.

The network-denied queue test verified and activated the local files, cancelled
one running job, and exported a second result byte for byte. That job used seed
337 and completed inference in 299.91 seconds. Its 1,308-byte MIDI file has 13
tracks, 118 notes and one tempo event at 121.29 BPM. Its SHA-256 is
`405c77a277bf38f635dc667a8482913d9050d20436f231248fbc4073d4fc0384`.
Mido changed one note from pitch 69 to 68 in a copy and verified that only
its note-on and note-off events had changed.

GarageBand verification is pending because the computer-control tool denied
access to the app.

The catalog's 8 GiB memory floor is an estimate. The verified configuration
above used CPU inference on macOS arm64.
