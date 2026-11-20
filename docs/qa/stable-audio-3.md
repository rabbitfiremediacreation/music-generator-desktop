# Stable Audio 3 desktop acceptance

Small Music accepts 5–120 s and Medium accepts 5–380 s of local instrumental generation per request. Both profiles use the audio.cpp C SDK launcher shared with HeartMuLa. The provider renders one seeded stereo WAV per job. The shared queue supervises cancellation and stores measured WAV duration separately from wall-clock generation time. [Issue #126](https://github.com/rabbitfiremediacreation/music-generator-desktop/issues/126)

## Sources and local import

Accept the publisher’s terms on the official [Small Music](https://huggingface.co/stabilityai/stable-audio-3-small-music) or [Medium](https://huggingface.co/stabilityai/stable-audio-3-medium) page. The ModelPicker links each required file at its pinned revision and displays its destination under the model folder. Preserve the listed layout, including the `t5gemma-b-b-ul2` subfolder. The import sends no requests and takes no credentials.

The catalog records exact file sizes and SHA-256 for all seven files per profile. Publisher Git LFS metadata supplies the four large-file digests per profile. The remaining configuration digests were calculated from authorized downloads after matching their bytes to the original Git blob IDs. [Small Music revision](https://huggingface.co/stabilityai/stable-audio-3-small-music/tree/8bdfb53c6b0fbc62113cd571fd37373efe15fa14) · [Medium revision](https://huggingface.co/stabilityai/stable-audio-3-medium/tree/d4d3579395a8ac0df4ab13b5b1d7138ce7290f81) · [audio.cpp model specification](https://github.com/0xShug0/audio.cpp/blob/61c7838baf1f7f34769b5b7bd369c0d78edf9535/model_specs/stable_audio.json)

The complete imports occupy 3,492,070,634 bytes for Small Music and 10,443,802,373 bytes for Medium. The two profiles keep their original Hugging Face folder layouts.

The model sources include the [Stability AI Community License](https://huggingface.co/stabilityai/stable-audio-3-optimized/blob/30cb2644da54bfa63275d1bc7f1fa67fc718680f/LICENSE.md), [required NOTICE](https://huggingface.co/stabilityai/stable-audio-3-optimized/blob/30cb2644da54bfa63275d1bc7f1fa67fc718680f/NOTICE), and [Gemma Terms of Use](https://huggingface.co/stabilityai/stable-audio-3-optimized/blob/30cb2644da54bfa63275d1bc7f1fa67fc718680f/LICENSE_GEMMA.md). The app links the terms, displays the redistribution requirements, and leaves acceptance on the publisher’s site.

Stability AI licenses its reference runtime code under MIT. The bundled audio.cpp code is licensed under Apache-2.0. [Official runtime license](https://github.com/Stability-AI/stable-audio-3/blob/790793b89ddceea612be9ce42ff6830d18f6fa57/LICENSE) · [audio.cpp license](https://github.com/0xShug0/audio.cpp/blob/61c7838baf1f7f34769b5b7bd369c0d78edf9535/LICENSE)

## Runtime comparison

| Runtime | Upstream device path | Scope for this integration |
| --- | --- | --- |
| audio.cpp v0.9.5 C SDK | macOS arm64 Metal in the shared desktop bundle. Upstream also offers CUDA builds. | The app adapter loads the official standard Safetensors, forwards a prompt, seed and duration, and checks stereo WAV output. |
| Stability AI MLX | Apple Silicon Metal | The optimized repository publishes separate weights and a Python runtime. Upstream also supports audio editing. |
| Stability AI LiteRT | macOS, Linux and Windows CPUs with XNNPACK | The optimized repository publishes separate TFLite components. Upstream also supports audio editing. |
| Stability AI TensorRT | Linux with supported NVIDIA GPUs | TensorRT plans and plugins target a GPU compute capability. ONNX graphs are inputs for building those plans. |

The ModelPicker lists the pinned [Optimized repository](https://huggingface.co/stabilityai/stable-audio-3-optimized/tree/30cb2644da54bfa63275d1bc7f1fa67fc718680f) as a reference. The standard importer resolves only the files required by the audio.cpp adapter. [Official optimized runtimes](https://github.com/Stability-AI/stable-audio-3/tree/790793b89ddceea612be9ce42ff6830d18f6fa57/optimized) · [TensorRT build guide](https://github.com/Stability-AI/stable-audio-3/tree/790793b89ddceea612be9ce42ff6830d18f6fa57/optimized/tensorRT/build)

## Hardware evidence

The test host was an Apple M5 Pro with 64 GiB unified memory on macOS 26.6.2. The native launcher ran under a macOS sandbox that denied networking. Its trace confirmed Metal buffers for the T5Gemma encoder, DiT and SAME decoder. All four renders used the same prompt and seed and returned non-silent 44.1 kHz stereo PCM16 WAV.

| Profile | Requested | WAV | Wall time | Peak process footprint | Max RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| Small Music | 5.5 s | 5.5 s | 26.88 s | 4.29 GiB | 5.97 GiB |
| Small Music | 120 s | 120 s | 49.79 s | 2.81 GiB | 3.31 GiB |
| Medium | 5.5 s | 5.5 s | 128.26 s | 9.31 GiB | 9.72 GiB |
| Medium | 380 s | 380 s | 148.73 s | 9.32 GiB | 10.60 GiB |

The memory columns show process measurements from `/usr/bin/time -l` on a unified-memory host. Dedicated VRAM and lower-RAM configurations are untested. All four WAVs contain distinct left and right samples. RMS ranged from −23.94 to −16.04 dBFS. The short Medium sample reached a PCM limit in four samples, while the other three contained zero PCM limit samples.

Cancellation was exercised for both profiles with the shared native supervisor and networking denied. Closing the control pipe after the DiT Metal buffer was allocated reaped the Small Music process in 0.136 s and the Medium process in 0.073 s. Neither cancelled run produced a WAV.

The official optimized MLX trial used the pinned public Apple Silicon weights and hash-checked MLX 0.32.4 dependencies. All three model files passed size and SHA-256 checks. On this host the macOS loader stalled during `import mlx.core` before Metal enumeration or inference, including in a separate import probe. Timing, memory and WAV results are therefore available for the audio.cpp path.

## Desktop queue and library

The isolated desktop app used loopback for the test client and denied external network access. Both profiles verified and activated their seven imported files. They each rendered a 12.34567 s request as 544,444 stereo PCM16 frames at 44.1 kHz on Metal. Both WAV exports matched the library audio byte for byte.

| Profile | App generation time | Rejected request | Cancelled during generation | Temporary output removed in |
| --- | ---: | ---: | ---: | ---: |
| Small Music | 38.50 s | 120.01 s | 120 s | 0.238 s |
| Medium | 60.45 s | 380.01 s | 380 s | 0.233 s |

Small Music also completed a request with a blank title using the local fallback. Both cancelled jobs ended without a library audio file. On the combined Worktree, 541 frontend tests, 370 Rust tests, and 39 desktop build tests passed. Platform-specific and opt-in hardware tests retained their existing skips.

## Reproduction

After import, disconnect the test computer from the network and exercise each supported profile through the Creator and queue. Record the selected backend, device, peak memory, elapsed time and WAV channels and duration. Generate a short clip and a clip at the stated maximum, then cancel another job during inference and verify that no audio is added to the library. Use the same prompt and seed when rechecking a build. Leave profiles unavailable until the generation path and its device are verified.
