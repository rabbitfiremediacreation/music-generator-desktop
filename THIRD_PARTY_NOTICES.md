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

## Optional DiffRhythm 2 evaluation package

- ASLP Lab's DiffRhythm 2 source and published generation and decoder checkpoints are Apache-2.0. The bundled source includes NVIDIA's MIT-licensed BigVGAN implementation and Amphion-derived G2P code with its original notices. The Mandarin ONNX phonemizer is the copy distributed in the pinned DiffRhythm 2 source. [Source and notices](https://github.com/ASLP-lab/DiffRhythm2/tree/7804f821b797b4f276090e1a9dcd37e97d9915d5), [Amphion Mandarin phonemizer](https://github.com/open-mmlab/Amphion/tree/main/models/tts/maskgct/g2p/sources/g2p_chinese_model)
- OpenMuQ's MuQ and MuQ-MuLan model weights are CC BY-NC 4.0. Credit the OpenMuQ authors and retain the licence and source links when sharing these weights noncommercially. The MuQ Python package is MIT. [MuQ-MuLan model card](https://huggingface.co/OpenMuQ/MuQ-MuLan-large), [MuQ model card](https://huggingface.co/OpenMuQ/MuQ-large-msd-iter), [MuQ source](https://github.com/tencent-ailab/MuQ)
- Meta's XLM-RoBERTa base weights and tokenizer are MIT. The picker downloads the four repositories' runtime model files separately, using the commit, byte count and SHA-256 listed per file in `models/catalog.json`. [XLM-RoBERTa model card](https://huggingface.co/FacebookAI/xlm-roberta-base)
- eSpeak NG 1.52.0 and phonemizer 3.3.0 are GPL-3.0-or-later. The package carries eSpeak NG's corresponding source, build recipe and data alongside the shared library. Python wheel metadata and license files accompany their packages. [eSpeak NG](https://github.com/espeak-ng/espeak-ng/tree/4870adfa25b1a32b4361592f1be8a40337c58d6c), [phonemizer](https://github.com/bootphon/phonemizer/tree/v3.3.0)
- Standalone CPython 3.11.16 and the PyTorch and torchaudio 2.7.0 wheels supply the interpreter and inference runtime. Preserve the bundled package notices, including the NVIDIA license terms for PyTorch's CUDA dependencies. [Python Build Standalone](https://github.com/astral-sh/python-build-standalone/releases/tag/20260825), [PyTorch](https://github.com/pytorch/pytorch/tree/v2.7.0)
