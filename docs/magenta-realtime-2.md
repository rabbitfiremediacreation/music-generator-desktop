# Magenta RealTime 2 `mrt2_small`

The optional `mrt2_small` profile records a local text-conditioned stream as 48 kHz stereo PCM WAV. In Studio, set **Recording duration** between 10 and 120 seconds and enter a prompt or style. The normal queue and cancellation controls apply. Each recording starts a fresh native process and produces its own WAV in the library. A finished take shows time to first audio, the number of missing 40 ms blocks, peak resident RAM of the recorder and whether it kept pace with the capture clock. The library measures WAV duration separately from elapsed job time.

The recorder targets Apple Silicon on macOS 14 or newer using C++ and MLX. Profile admission is limited to the verified Apple Silicon path with at least 64 GiB of unified memory and the recorder files in the app bundle. `mrt2_base`, other platforms, live controls and MIDI are disabled.

## Acquire the weights

Open **Settings → Models and hardware → Add model**, then choose **Magenta RealTime 2 Small**. The profile shows the source, license, publisher terms and file list before the download action. The downloader fetches nine verified files totaling 1,526,097,299 bytes. Each file's path, revision, byte count and SHA-256 are in [`models/catalog.json`](../models/catalog.json). The download resumes from `.part` files when supported by the server. [Pinned Google model repository](https://huggingface.co/google/magenta-realtime-2/tree/010aa0dcb0dfd27b24f0ad07b4dad63e8f9521cc)

For a local import, copy the nine files to the paths shown under the model folder, preserving `magenta-realtime-2/models/mrt2_small`, `magenta-realtime-2/resources/musiccoca` and `magenta-realtime-2/resources/spectrostream`. Select **Verify and use**. The downloader verifies existing files before activating the profile. The MLX graph contains the SpectroStream decoder. The separate SpectroStream encoder, the initial state and the MusicCoCa resources complete the native bundle. [Pinned upstream export](https://github.com/magenta/magenta-realtime/blob/694a545e4ba0b88bf1150137b129582166d3e07f/magenta_rt/mlx/export.py)

## License and attribution

The native code is Apache-2.0. The weights and required model resources are © 2026 Google LLC under CC BY 4.0, which permits private and commercial use, modification and redistribution. When sharing the files or modifications, credit Google LLC, keep the provided license and notices, link to the source and identify changes. Google claims no rights in generated output and requires that use and outputs respect the rights of others. Users are responsible for their inputs, outputs and subsequent use. [Pinned runtime license](https://github.com/magenta/magenta-realtime/blob/694a545e4ba0b88bf1150137b129582166d3e07f/LICENSE) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) · [Publisher terms](https://huggingface.co/google/magenta-realtime-2/blob/010aa0dcb0dfd27b24f0ad07b4dad63e8f9521cc/README.md#terms-of-use)

## Build and verify on Apple Silicon

Use `MUSIC_GENERATOR_MAGENTA=1 npm run bundle` with CMake, Ninja and Xcode's Metal toolchain installed. The build packages the native recorder and its Metal library in `engine/magenta`, beside the other engine resources. Model acquisition remains a separate step. Installed apps run the recorder without Python or Node. A blank title uses the locally installed title model or the existing title fallback.

The ignored Rust test `jobs::magenta_qa::magenta_offline_queue` drives the real queue and library with local weights. Build the test and supervisor with `cargo test --manifest-path src-tauri/Cargo.toml --no-run` after `npm run build`. Copy `src-tauri/target/debug/music-engine-supervisor` beside the library test executable reported by Cargo. Point `MUSIC_MAGENTA_QA_MODELS` to the model folder and `MUSIC_MAGENTA_QA_RESOURCES` to development resources with the ad-hoc linked recorder, Metal library and runtime manifest. The production recorder inherits the sandbox of the signed app.

Run the test executable with macOS networking denied. `APP_TEST_BIN` is the library test executable path.

```sh
/usr/bin/sandbox-exec -p '(version 1) (allow default) (deny network*)' \
  "$APP_TEST_BIN" --ignored --exact jobs::magenta_qa::magenta_offline_queue --nocapture
```

## Hardware acceptance

On 2026-11-19, an Apple M5 Pro with 64 GiB unified memory and macOS 26.6.2 ran the native recorder and the app queue with networking denied. First audio is measured from recorder entry until the first non-silent PCM block. Peak RAM is the recorder's maximum resident size. A missed 40 ms block is filled with silence to preserve the requested recording time.

| Run | WAV length | First audio | Underrun blocks | Peak resident RAM | Real-time |
| --- | ---: | ---: | ---: | ---: | --- |
| Relocated recorder | 4.400 s | 19.603 s | 31 | 1,050,624,000 B | No |
| First queued recording | 10.000 s | 19.044 s | 150 | 560,840,704 B | No |
| Queued recording after cancellation | 12.400 s | 2.063 s | 144 | 1,054,179,328 B | No |

The app's ModelDownloader verified and activated the nine imported files under network denial. The queue saved the first WAV, cancelled the second request after its recorder started writing, then saved a distinct WAV from the third request. Both saved files are 48 kHz stereo PCM16. The cancellation left no audio or temporary job directory. The library generated fallback titles with the title model absent. These runs established the offline recording path and showed audible-length gaps in the recordings. Real-time capture remains unverified.

The separate native style probe used the pinned upstream `RealtimeRunner` with the same local bundle and networking denied. In a 20-second stream it requested a switch at 8 seconds from `quiet sparse ambient piano trio with brushes` to `fast distorted industrial techno with a heavy kick drum`. MusicCoCa confirmed the new prompt and quantized conditioning after 6.365 seconds, producing a different token sequence. Audio was present in both measured windows, with RMS 0.0260 at 4–8 seconds and 0.0721 at 16–20 seconds. The probe measured first audio at 18.242 seconds, 47 underruns in 500 blocks and peak resident RAM of 694,190,080 bytes. Studio live controls and MIDI remain disabled.

A trial with four buffered blocks and the upstream GPU keepalive produced 33 underruns on the same 4.4-second input. The Studio recorder uses the two-block buffer measured in the table.

The relocated recorder ran with reads from its original build directory denied. The signed arm64 staging directory passed code-signature and file-inventory verification, and the recorder links only macOS system libraries. Its Mach-O deployment target is macOS 14.0. The network-denied queue check used the development signature with the same C++ binary and Metal assets.
