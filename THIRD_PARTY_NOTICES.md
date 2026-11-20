# Third-party components

Music Generator is distributed under the MIT license; see LICENSE.

- acestep.cpp by ServeurpersoCom: https://github.com/ServeurpersoCom/acestep.cpp (MIT). Upstream licenses are preserved. Platform source revisions and Windows archive checksums are in models/manifest.json; final bundled-file checksums are in engine/VERSION.desktop.json. The macOS source build includes the project's small Objective-C++ sandbox bookmark bridge; its SHA-256 and build-recipe hash are recorded in that provenance file.
- GGML and its CPU/GPU backends: https://github.com/ggml-org/ggml (MIT). See the engine's bundled license files.
- wavesurfer.js by katspaugh and contributors: https://github.com/katspaugh/wavesurfer.js (BSD-3-Clause). Its full license is in `vendor/wavesurfer.LICENSE` in the bundled frontend assets and `static/vendor/wavesurfer.LICENSE` in the source tree.
- qrcode-generator 1.4.4 by Kazuhiko Arase: https://github.com/kazuhikoarase/qrcode-generator (MIT). Bundled into the frontend for the phone-access QR code.
- jsQR 1.4.0 by Cosmo Wolfe and contributors: https://github.com/cozmo/jsQR (Apache-2.0). Used for camera-based pairing in the mobile PWA. The full license is served as `mobile/jsqr.LICENSE.txt`.
- Tauri: https://github.com/tauri-apps/tauri (MIT or Apache-2.0). JavaScript packages retain license files in their source distributions; Rust dependencies and versions are recorded in Cargo.lock.
- React/React DOM, TanStack Router/Query and their bundled JavaScript dependencies, and Tailwind CSS: license texts are included in `static/vendor/frontend-dependencies.LICENSE.txt` (shipped as `vendor/frontend-dependencies.LICENSE.txt`). Exact versions are recorded in package-lock.json.
- Microsoft WebView2 Fixed Version Runtime, Windows only: https://developer.microsoft.com/microsoft-edge/webview2/ — distributed under Microsoft's WebView2 Runtime terms. Its runtime license files remain inside the WebView2 directory. The exact download and SHA-256 are in models/webview2.json. It is not installed globally.
- Microsoft Visual C++ runtime DLLs, Windows only: redistributed app-locally from the Visual Studio build tools' redistributable directory under Microsoft's redistribution terms.
- Magenta RealTime 2 by Google LLC (Apache-2.0) can be bundled as the optional Apple Silicon recorder. It uses MLX, TensorFlow Lite and SentencePiece. The runtime licenses and file checksums accompany the recorder under `engine/magenta/`. The separately acquired Google model files are licensed under CC BY 4.0. See [model sources and usage](docs/magenta-realtime-2.md#license-and-attribution).

The GGUF models are downloaded separately from the pinned Hugging Face revision in models/manifest.json. Model cards and license information: https://huggingface.co/Serveurperso/ACE-Step-1.5-GGUF. Models are not included in the application download.

Linux AppImage media support includes the GStreamer base/good plugins supplied by the build distribution. Additional proprietary codecs and GStreamer ugly plugins are not deliberately bundled.

## Linux CUDA AppImage

The separate NVIDIA build bundles CUDA Runtime and cuBLAS/cuBLASLt from CUDA Toolkit 12.8.1 under the [NVIDIA CUDA EULA](https://docs.nvidia.com/cuda/archive/12.8.1/eula/index.html). Exact component versions, official archive URLs, SHA-256 checksums and runtime SONAMEs are pinned in `models/cuda-linux.json`. The component license files accompany the libraries under `engine/cuda/licenses/`. The NVIDIA driver, driver stubs and compiler are not distributed in the AppImage. The Vulkan/CPU build contains no CUDA redistributables.

## Shared local title model

- llama.cpp v0.7.0 (MIT): https://github.com/ggml-org/llama.cpp. The statically linked CPU-only `music-title` helper uses the pinned source revision and archive checksum in `models/title-model.json`. Its runtime checksums and build recipe are in `engine/title/TITLE_RUNTIME.json`; the llama.cpp/ggml and nlohmann/json MIT license texts accompany the helper.
- Qwen3-0.6B-GGUF (Apache-2.0): https://huggingface.co/Qwen/Qwen3-0.6B-GGUF. Model weights are downloaded separately to the selected model folder, never fetched by the inference helper. The exact Q8 model revision, byte size and SHA-256 are pinned in `models/title-model.json`. Upstream license: https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/blob/main/LICENSE.

## Optional AudioCraft runtime

- AudioCraft 1.3.0 by Meta Platforms, Inc. and affiliates (MIT). The optional macOS arm64 bundle includes the locally patched inference code, its full MIT license and the pinned Python distribution and wheel license files. The archives and SHA-256 locks are in `scripts/desktop/audiocraft-runtime/`. [AudioCraft source and license](https://github.com/facebookresearch/audiocraft/tree/72cb16f9fb239e9cf03f7bd997198c7d7a67a01c)
- Meta's MusicGen Small and MAGNeT Small 30s checkpoints and their EnCodec weights use CC BY-NC 4.0. The ModelPicker displays the terms before download. The shared Google T5-base encoder and SentencePiece vocabulary use Apache-2.0. These files are acquired separately using the exact source, revision, byte count and SHA-256 in `models/catalog.json`. [MusicGen Small](https://huggingface.co/facebook/musicgen-small) · [MAGNeT Small 30s](https://huggingface.co/facebook/magnet-small-30secs) · [AudioCraft weights license](https://github.com/facebookresearch/audiocraft/blob/72cb16f9fb239e9cf03f7bd997198c7d7a67a01c/LICENSE_weights) · [T5-base](https://huggingface.co/google-t5/t5-base)

## Optional HeartMuLa profile

- audio.cpp v0.9.5 by 0xShug0 and contributors (Apache-2.0). The Apple Silicon package includes the upstream C ABI library and its license under `engine/providers/audio.cpp/`. The app supplies the launcher and uses the sandbox bookmark bridge described above. [Pinned runtime source and license](https://github.com/0xShug0/audio.cpp/tree/61c7838baf1f7f34769b5b7bd369c0d78edf9535) · [SDK archive and spec pins](models/audio-cpp-runtime.json)
- HeartMuLa HNY, HeartCodec 20260123 and HeartMuLaGen (Apache-2.0). These files are acquired separately through the ModelPicker. [Model revisions and licenses](docs/model-picker.md#heartmula-3b-happy-new-year)

## MuLaCover

- MuLaCover by MuLa Labs. The quantized checkpoint is acquired separately by the user. The weights are CC BY-NC 4.0, and MuLa Labs restricts generated outputs to noncommercial use. [Official project](https://github.com/HeartMuLa/MuLaCover) · [Weight and output terms](https://huggingface.co/HeartMuLa/MuLaCover/blob/0f5ca612a41134738a14a28f95ed80bfa9b52adc/MODEL_LICENSE)
- SoXR 0.1.3 by Rob Sykes is used for reference-audio resampling. The Apple Silicon runtime includes the dynamically loaded `libsoxr.dylib`, `LICENSE.soxr` (LGPL-2.1-or-later), and the corresponding `soxr-0.1.3-Source.tar.xz`. [SoX Resampler project](https://sourceforge.net/projects/soxr/)
- The native GGUF carries its upstream component notices. See the checkpoint pins, source comparison, and YourMT3 source-license status in [MuLaCover provenance](docs/mulacover.md).

## MiniMax-Music3 development profile

- The local adapter targets audio.cpp v0.9.4 by ShugoAI LLC under Apache-2.0. [Runtime release](https://github.com/0xShug0/audio.cpp/releases/tag/v0.9.4) · [Runtime license](https://github.com/0xShug0/audio.cpp/blob/f7ac446fb75e594a6913c846bea6c85b637f6ac0/LICENSE)
- The separately acquired MiniMax-Music3 GGUF weights retain the MiniMax-Music3 Community License and Acceptable Use Policy. The publisher's `LICENSE` accompanies the verified model set. The third-party release decision is pending. [Pinned GGUF weights](https://huggingface.co/audio-cpp/MiniMax-Music3-GGUF/tree/46fe77f8bb395ccdbe797d784225f7b84866e7ce) · [Model license](https://huggingface.co/audio-cpp/MiniMax-Music3-GGUF/blob/46fe77f8bb395ccdbe797d784225f7b84866e7ce/LICENSE) · [Distribution notes](docs/qa/issue-129/README.md)

## Mimetic A0 short clips

- Mimetic A0 runtime and weights by Mick Grierson (MIT). The publisher's LICENSE and NOTICE accompany the runtime. The weights include the frozen ACE-Step 1.5 VAE (MIT), converted to the Stable Audio Tools layout. [Runtime source](https://github.com/micknoise/mimetic-a0/tree/c4331b95f2db653c6268973a3096c8f0a77a4a61) · [Weights license](https://huggingface.co/micknoisemachine/mimetic-a0/blob/5f21e1807517cda2e6d72051cdb81dafc3931077/LICENSE) · [Publisher NOTICE](https://huggingface.co/micknoisemachine/mimetic-a0/blob/5f21e1807517cda2e6d72051cdb81dafc3931077/NOTICE)
- Stable Audio Tools (MIT) and Google T5-base encoder/tokenizer (Apache-2.0). The model catalog pins the exact Hugging Face revisions, byte sizes and SHA-256 values for the separate weight and configuration downloads. [Stable Audio Tools license](https://github.com/Stability-AI/stable-audio-tools/blob/3241adba4fc2a85cf5b29d9eb68d42f40a28e820/LICENSE) · [T5-base model card](https://huggingface.co/google-t5/t5-base/tree/a9723ea7f1b39c1eae772870f3b547bf6ef7e6c1) · [T5 license](https://github.com/google-research/text-to-text-transfer-transformer/blob/42909aa15d1fbd16c69333aa474a00ae8ed9fde4/LICENSE)
- The Mimetic NOTICE attributes uploader-labelled CC0 Freesound clips and procedural synthetic music used for training. Some synthetic audio uses S. Christian Collins's GeneralUser GS SoundFont 2.0.3, whose author reports uncertainty about the origin of some samples. The model license contains no separate output clause. [Publisher NOTICE](https://huggingface.co/micknoisemachine/mimetic-a0/blob/5f21e1807517cda2e6d72051cdb81dafc3931077/NOTICE) · [GeneralUser GS](https://schristiancollins.com/generaluser)

## Text2midi

- Text2midi inference code by AMAAI Lab (MIT) is adapted from the pinned [upstream repository](https://github.com/AMAAI-Lab/Text2midi/tree/f3245ee402b29ba00b86c6eb9813032f3f05954f). Its original license accompanies the runtime in `text2midi/LICENSE.upstream`.
- MIDI file validation uses [midly](https://crates.io/crates/midly), distributed under the Unlicense.
- The Text2midi checkpoint and Google FLAN-T5 Base configuration and tokenizer (Apache-2.0) are obtained separately at the repository revisions and SHA-256 values in `models/catalog.json`. The bundled REMI vocabulary is a JSON conversion of the original tokenizer. The license and change notice accompany it in `text2midi/LICENSE.vocab` and `text2midi/NOTICE`.
