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

The GGUF models are downloaded separately from the pinned Hugging Face revision in models/manifest.json. Model cards and license information: https://huggingface.co/Serveurperso/ACE-Step-1.5-GGUF. Models are not included in the application download.

Linux AppImage media support includes the GStreamer base/good plugins supplied by the build distribution. Additional proprietary codecs and GStreamer ugly plugins are not deliberately bundled.

## Linux CUDA AppImage

The separate NVIDIA build bundles CUDA Runtime and cuBLAS/cuBLASLt from CUDA Toolkit 12.8.1 under the [NVIDIA CUDA EULA](https://docs.nvidia.com/cuda/archive/12.8.1/eula/index.html). Exact component versions, official archive URLs, SHA-256 checksums and runtime SONAMEs are pinned in `models/cuda-linux.json`. The component license files accompany the libraries under `engine/cuda/licenses/`. The NVIDIA driver, driver stubs and compiler are not distributed in the AppImage. The Vulkan/CPU build contains no CUDA redistributables.

## Shared local title model

- llama.cpp v0.7.0 (MIT): https://github.com/ggml-org/llama.cpp. The statically linked CPU-only `music-title` helper uses the pinned source revision and archive checksum in `models/title-model.json`. Its runtime checksums and build recipe are in `engine/title/TITLE_RUNTIME.json`; the llama.cpp/ggml and nlohmann/json MIT license texts accompany the helper.
- Qwen3-0.6B-GGUF (Apache-2.0): https://huggingface.co/Qwen/Qwen3-0.6B-GGUF. Model weights are downloaded separately to the selected model folder, never fetched by the inference helper. The exact Q8 model revision, byte size and SHA-256 are pinned in `models/title-model.json`. Upstream license: https://huggingface.co/Qwen/Qwen3-0.6B-GGUF/blob/main/LICENSE.

## Text2midi

- Text2midi inference code by AMAAI Lab (MIT) is adapted from the pinned [upstream repository](https://github.com/AMAAI-Lab/Text2midi/tree/f3245ee402b29ba00b86c6eb9813032f3f05954f). Its original license accompanies the runtime in `text2midi/LICENSE.upstream`.
- MIDI file validation uses [midly](https://crates.io/crates/midly), distributed under the Unlicense.
- The Text2midi checkpoint and Google FLAN-T5 Base configuration and tokenizer (Apache-2.0) are obtained separately at the repository revisions and SHA-256 values in `models/catalog.json`. The bundled REMI vocabulary is a JSON conversion of the original tokenizer. The license and change notice accompany it in `text2midi/LICENSE.vocab` and `text2midi/NOTICE`.
