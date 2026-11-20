# ModelPicker

The Creator view has a model drop-down for recommended Standard/XL profiles and displays the automatically assigned language model. **Settings → Models and hardware** initially lists installed local model files, their roles, sizes and verification status. Verified compatible profiles can be activated from this list without downloading. **Add model** opens extended selection, verification and downloads in an additional dialog above Settings. **Choose models** in the Creator opens the settings page with the requested profile ready for the add dialog. ACE-Step provides the starter profiles. The picker checks each optional profile's native runtime and hardware requirements before activation. See [Mimetic A0](mimetic-a0.md) for the short-clip profile.

The additional downloader dialog uses a split catalog and detail view. Search and **All / Installed / Recommended** filters browse sound-model families on the left; Installed requires a verified local file, and Recommended uses the actual hardware recommendations. The detail pane shows quantization variants for the chosen family, its companion language model, file size, total profile download, memory estimate, required files and the explicit download/activation action. Choosing a family only changes the preview. On narrow layouts the catalog appears above the details. Escape closes only the add dialog and returns focus to Add model; Settings and its unsaved drafts remain open. Download progress and cancellation stay available on the installed-models page when the additional dialog is closed.

**Hardware test in setup wizard…** on the settings models page opens the full setup flow for storage locations, model downloads and a function test. Completing the wizard activates a recommended Standard or XL starter profile; use the settings models page for regular model changes.

## Simple selection and Expert Mode

When no XL recommendation fits this computer's RAM budget, a visible hint beside the Creator drop-down explains that XL requires more memory and is not recommended. This also appears in Expert Mode: installing an XL file or enabling that mode does not add an XL recommendation or remove the backend's memory checks. The hint and all Settings labels/status messages are localized in all twelve UI languages and update when the language changes.

For ACE-Step, the Creator drop-down offers **Standard** and, only when its complete profile fits the detected RAM budget, **XL**. These use SFT Q8_0. Each profile has exactly one automatically recommended Q8_0 language model; there is no manual size selector. Recommendations use the existing RAM/VRAM language-size guidance (0.6B, 1.7B or 4B), lowering the size if needed to fit synthesis, language weights, fixed dependencies and runtime headroom together. If no starter profile fits, the drop-down explains that no recommendation is available. The first-run assistant follows the same rules.

The Creator drop-down uses `select_models`, which activates only already verified local files and persists the choice without downloading. If files are missing or need verification, the previous selection stays active and an inline hint links to Settings. The requested profile is preselected in the model manager, where download/verification needs an explicit action. Advanced profiles selected in Settings or restored from songs remain visible as the current drop-down entry; the Creator does not expand into a full catalog when Expert Mode is enabled.

Enable **Expert Mode** on **Settings → Models and hardware**, then click **Apply Expert Mode** to save that preference without closing settings or saving other draft edits. This reveals the full family/precision catalog, manual language-model choices, RAM filter, auxiliary title-model management and sampling recommendations. Choose a synthesis model and language model, then select **Use selection**, **Verify and use**, or **Download and use**. These actions apply immediately and preserve other settings drafts. Missing base files are included automatically. In Expert Mode, an existing choice stays visible even when it exceeds the budget; a new combination above the estimate cannot be activated. This is resource guidance rather than an inference certification: duration, GPU memory and runtime buffers can impose further limits.

The boolean `expert_mode` is stored in the existing SQLite settings table. New installations and old configurations without the key default to `false`. Saving the switch updates availability immediately without restarting. Pure Expert Mode changes are serialized with queue admission and can be saved while generation or analysis runs; mixed settings edits keep the existing exclusive configuration rules.

Every ACE-Step profile outside this computer's recommendations requires Expert Mode in the backend too: other families (including all seven Turbo families), other quantizations and non-recommended language sizes. The policy guards activation/download, generation, retry, analysis and wizard requests. `models/catalog.json` centrally declares starter assets and Turbo-family membership; the backend supplies the actual hardware-specific profiles to the UI. RAM filtering cannot reveal a restricted saved choice.

Disabling the mode preserves an advanced selection and shows a recovery hint. Enable Expert Mode or explicitly adopt a recommendation; neither the switch nor opening the picker changes models or downloads anything. Reusing a song keeps its saved profile and sampling values and shows the same hint if necessary. Background model events and delayed activation replies cannot replace a newer form choice; only a subsequent explicit selection or completed setup replaces it. New jobs and retries are rejected with `expert_mode_required` when restricted. Already accepted running/queued jobs finish with their original snapshots, including after restart. Existing files, songs, playback and exports remain available.

The estimate sums both selected model weights, the fixed text encoder and VAE, plus 3 GiB of OS/runtime headroom (4 GiB for XL). It does not mistake unknown VRAM for an unsupported GPU. The engine's existing CPU language-model preference/fallback remains available in Settings. A small GPU may require a smaller synthesis model; the picker does not promise automatic CPU synthesis fallback on every GPU configuration.

## Screenshots of the Creator and Settings flows

Browser UI verification with **simulated Tauri responses and 16 GiB RAM**, captured on 2026-10-25. The files, download sizes and installed status shown here are test data; no model download or inference is demonstrated.

**Creator drop-down:** Standard and XL use an automatically assigned 1.7B language model on this simulated computer. Switching verified local profiles uses the separate download-free activation command.

![Creator model drop-down with XL selected and its automatic language model](screenshots/creator-model-dropdown.jpg)

**Missing model:** choosing unavailable XL keeps Standard active and links to Settings instead of downloading in the Creator.

![Creator hint that verification or downloading must happen in Settings](screenshots/creator-model-download-needed.jpg)

**Download through Settings:** Settings → Manage and download models retains the requested XL profile. Download and use requires an explicit click.

![Settings model manager with XL preselected and Download and use](screenshots/settings-model-download.jpg)

**Expert view through Settings:** Expert Mode unlocks family/precision and language-model selectors in the model manager. The Creator drop-down stays compact.

![Extended Settings model manager with Expert Mode enabled](screenshots/settings-expert-models.jpg)

## Pinned ACE-Step catalog

`models/catalog.json` is a versioned, offline catalog based on the [GGUF repository](https://huggingface.co/Serveurperso/ACE-Step-1.5-GGUF/tree/666ac70204440867d8c01ba4b119cc79c95b370a), revision `666ac70204440867d8c01ba4b119cc79c95b370a`. Every asset has its exact published byte size and LFS SHA-256. The native adapter uses the existing pinned [acestep.cpp](https://github.com/ServeurpersoCom/acestep.cpp) engines; their revisions are unchanged.

| Role | Variants |
| --- | --- |
| Standard synthesis | base, sft, turbo, turbo-continuous, turbo-shift1, turbo-shift3 in BF16/Q8_0/Q6_K/Q5_K_M/Q4_K_M; sftturbo50 in BF16/Q8_0 (32 files) |
| XL synthesis | xl-base, xl-sft, xl-sftturbo50, xl-turbo in all five precisions (20 files) |
| Language | 0.6B and 1.7B in BF16/Q8_0; 4B in BF16/Q8_0/Q6_K/Q5_K_M (8 files) |
| Fixed dependencies | Qwen3-Embedding-0.6B-Q8_0 and vae-BF16 (2 files) |

With Expert Mode enabled, ACE-Step has 60 selectable generative weights and two fixed dependencies. No nonexistent Q4 language model is invented. BF16 text encoding is deliberately not selectable: both bundled server revisions use `text_enc[0]`, with no per-request text-encoder selector. Downloading both encoders would make selection ambiguous. The optional BF16 encoder in the source repository is not a separate music-generation model. Imported folders containing additional text encoders still follow the engine's own registry order; use a model folder with only the supported Q8 encoder for reproducible text encoding.

Turbo families offer eight recommended iterations; SFT/Base retain the app's 80-iteration default. Switching models does not alter sampling controls. **Apply recommended steps** is an explicit action for the currently selected model and updates only the new-song form. The range supports individual values from 1 to 200, including saved eight-step songs.

## HeartMuLa 3B Happy New Year

Open **Settings → Models and hardware → Add model** and select HeartMuLa. The model card shows runtime, model and codec licenses, platform requirements, and the individual file pins. Download and use verifies all twelve files before switching the active profile. The full download is 22,400,063,577 bytes (20.86 GiB). The downloader stores the files under `heartmula/` in the selected models directory. The installer contains the native helper for the supported package and the model files are stored separately. [Pinned catalog](../models/catalog.json) · [Runtime package pins](../models/audio-cpp-runtime.json)

Enter your own lyrics and comma-separated style tags such as `acoustic, indie pop, warm vocals`. Specify a duration cap and optionally a seed from 0 to 4,294,967,295. The model can finish early and the codec rounds to audio frames. The library reads the stored WAV to determine its playback duration and keeps native runtime separately. Studio, phone access and MCP share the same limits and use the existing queue and cancellation controls. The first-run assistant continues to install the ACE-Step starter profile.

The initial HeartMuLa profile accepts 5–30 requested seconds per vocal track and is offered on macOS arm64 with Metal and at least 64 GiB of unified memory. The tested computer and WAV measurements are recorded in the hardware acceptance report. [Hardware acceptance](qa/issue-125/README.md)

- **Runtime.** The app uses the audio.cpp v0.9.5 C ABI and a native launcher. Audio.cpp is licensed under Apache-2.0. The app includes the upstream runtime license with the bundled library. [audio.cpp release](https://github.com/0xShug0/audio.cpp/releases/tag/v0.9.5) · [Pinned runtime license](https://github.com/0xShug0/audio.cpp/blob/61c7838baf1f7f34769b5b7bd369c0d78edf9535/LICENSE)
- **Weights and dependencies.** The native adapter reads the official F32 Safetensors in their upstream layout. The HNY generator, January 23 decoder, and tokenizer and generation configuration are Apache-2.0. [HNY checkpoint](https://huggingface.co/HeartMuLa/HeartMuLa-oss-3B-happy-new-year/tree/41d4faafc5bde6990bf8505daa70840fb3c4a3e7) · [HeartCodec](https://huggingface.co/HeartMuLa/HeartCodec-oss-20260123/tree/58ec14fd02a123316e4fdaa9fe49fa7a902d1a6f) · [HeartMuLaGen](https://huggingface.co/HeartMuLa/HeartMuLaGen/tree/6f76e891c10ef8ae50fa6f2fb48fab783f3ce1d7)
- **Use and redistribution.** Apache-2.0 permits local private and commercial model use. Redistribution requires the full license text, retention of applicable notices and any NOTICE, and identification of modified files. The upstream cards impose no separate output-attribution or noncommercial condition. Assess the rights to supplied lyrics and generated music separately. [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)

## YuE2 3B

YuE2 combines written lyrics and style descriptors into stereo PCM16 WAV at 48 kHz. Set a duration limit from 10 to 60 seconds. The model can end the song earlier, and the library displays the duration measured from the WAV. The same song seed controls both token sampling and acoustic noise. The app uses the native `yue-synth` executable, pinned to `yue2.cpp` revision `e646d5228911ae1b81ac2a261115a255848ce85f` (MIT) and its GGML submodule at `ef4555b7aede4467a5de803b103615e0a5f30dd8`. [Runtime source](https://github.com/ServeurpersoCom/yue2.cpp/tree/e646d5228911ae1b81ac2a261115a255848ce85f)

The 3B GGUF contains the autoregressive and acoustic stages and the text tokenizer. The VAE decodes the resulting latents. Those two files total 4,340,729,408 bytes (4.04 GiB). The reference-audio tokenizer, SheetSage2, and MERT are for cover or transcription paths. This profile offers lyrics and style to WAV. [GGUF model card](https://huggingface.co/Serveurperso/YuE2-GGUF/blob/e630f2b8f6aedf8254c3186438633c1b5eeaf80a/README.md)

Open **Add model → YuE2 3B** to see the licenses and **Download and use**. For an offline import, place both GGUFs in the `yue2` subfolder of the model folder displayed there. Refresh the file list and select **Verify and use**. Both files go through the same byte and SHA-256 checks. The workspace keeps the verified files outside the app bundle. The first-run assistant continues to use an ACE-Step starter profile.

| Repository | Commit | Path | Bytes | SHA-256 |
| --- | --- | --- | ---: | --- |
| Serveurperso/YuE2-GGUF | `e630f2b8f6aedf8254c3186438633c1b5eeaf80a` | `YuE2-3B-Q8_0.gguf` | 3,810,232,064 | `41121ce97786d7795a325bcf123ca196956c03bb252c9e75384cfc1f2fc19e6b` |
| Serveurperso/YuE2-GGUF | `e630f2b8f6aedf8254c3186438633c1b5eeaf80a` | `YuE2-Vae-F32.gguf` | 530,497,344 | `93e49dfb1970e89ad64cacb17cf13b5d05f6bb30ef7ed3adae3050bcb728638a` |

The source checkpoints used for the conversion are listed separately. The app acquires the two GGUFs above. [Official YuE2 3B](https://huggingface.co/m-a-p/YuE2-3B/tree/1a96eca688d6ae5d7f0feb88573fec89920fcd19) · [Official YuE2 VAE](https://huggingface.co/m-a-p/YuE2-Vae/tree/95535e72a97bc0f09b8ada125d26b4009428c0e8)

| Official repository | Commit | Path | Bytes | SHA-256 |
| --- | --- | --- | ---: | --- |
| m-a-p/YuE2-3B | `1a96eca688d6ae5d7f0feb88573fec89920fcd19` | `model.safetensors` | 7,261,441,640 | `1d55c42c1a9875c34f5d736e15078449992b044e807ce2a138e6cf289a1e59e9` |
| m-a-p/YuE2-3B | `1a96eca688d6ae5d7f0feb88573fec89920fcd19` | `config.json` | 959 | `ad3477bbef890bf98ae196c1e4b44779494a6231c4ab66f32708eabadf265329` |
| m-a-p/YuE2-3B | `1a96eca688d6ae5d7f0feb88573fec89920fcd19` | `qwen.tiktoken` | 2,561,218 | `b2b1b8dfb5cc5f024bafc373121c6aba3f66f9a5a0269e243470a1de16a33186` |
| m-a-p/YuE2-Vae | `95535e72a97bc0f09b8ada125d26b4009428c0e8` | `model.safetensors` | 530,512,720 | `807ce9d5149fa27c5ad3e6582058469852e908f6c5acc8c8aa338e7ab7751346` |

Both downloaded GGUFs were hashed locally and matched the pinned Hugging Face LFS objects. Both official `model.safetensors` files were also downloaded and checked against the SHA-256 values above. The original converter reproduced the complete VAE GGUF byte for byte. The historical GGML quantizer reproduced the 3B weights from the converted BF16 checkpoint. The published 3B GGUF adds the 32-byte `yue2.block_count` metadata entry with `uint32` value `28`, taken from `num_hidden_layers` in the pinned official `config.json`. Adding that entry after `yue2.config_json` and updating the metadata count reproduced the published BF16 and Q8_0 files byte for byte. [Original converter at `858d799`](https://github.com/ServeurpersoCom/yue2.cpp/tree/858d79952553d19182636ed31afd9f8a70fcc5e8) · [Historical GGML quantizer dependency at `7d02410`](https://github.com/ServeurpersoCom/ggml/tree/7d0241063b6dad00972a69565445dffb91dc3bc9)

MAP licenses both model checkpoints under **CC BY-NC 4.0**. Noncommercial sharing requires attribution, a license notice and identification of modifications such as conversion and quantization. Companies need a separate license for commercial use of the weights. Commercial redistribution of weights is outside the creator permission. The GGUF distributor names MAP and the source repositories, identifies its modifications, and includes a `LICENSE` identical to the 20,309-byte license files at both official Hugging Face revisions. [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) · [GGUF's license copy](https://huggingface.co/Serveurperso/YuE2-GGUF/blob/e630f2b8f6aedf8254c3186438633c1b5eeaf80a/LICENSE)

The embedded text vocabulary and merge table were converted from MAP's `qwen.tiktoken`, the same Git blob `9b9b0e0416d84d7c88333eb261c77e5fe2d7f7be` published by Qwen Agent under Apache-2.0. This attribution applies separately from the model-weight terms. [Qwen tokenizer source](https://github.com/QwenLM/Qwen-Agent/blob/31a4d36d123688581a9e9744427272b33ce940e0/qwen_agent/utils/qwen.tiktoken) · [Qwen Agent license](https://github.com/QwenLM/Qwen-Agent/blob/31a4d36d123688581a9e9744427272b33ce940e0/LICENSE)

MAP separately permits individuals acting in a personal creative capacity to generate, publish, sell and license their songs, including client work, without license fees or mandatory output attribution. This permission includes responsible-use terms and applies to rights MAP can grant. Users are responsible for the rights and consents for their inputs and outputs. The GGUF card describes the base license, and the pinned upstream license records the separate permission. [MAP weight license and creator permission](https://github.com/multimodal-art-projection/YuE/blob/cbb3b060725ddd95ac6e6237cfb709e153da5988/MODEL_LICENSE)

### Platform and offline checks

The available build target is macOS arm64 with Metal. On 19 November 2026 the two GGUFs were read from local disk and the Rust adapter ran the pinned native executable with networking denied by the macOS sandbox profile. The host was an Apple M5 Pro with 64 GiB unified memory and macOS 26.6.2 (25G83). The profile requires 16 GiB of unified RAM. A machine with that configuration or on the minimum supported macOS 14 release still needs a hardware check. Intel macOS, Windows, Linux and separate CUDA, Vulkan, and CPU inference are outside the tested profile.

| Duration limit | Measured WAV | Wall time | Peak RSS |
| ---: | ---: | ---: | ---: |
| 10 s | 9.998667 s | 37.40 s | 5.52 GiB |
| 60 s | 59.998667 s | 65.64 s | 5.55 GiB |

Both results were 48 kHz stereo PCM16. The requests used English lyrics, indie-folk style, seed 128 and 32 flow-matching steps. Runtime includes process startup and the native render. RSS is the process measurement on a unified-memory host. A local Whisper Small run on the 60-second WAV recognized the supplied lines “Morning light across the floor” and “Carry me home through the wind and rain.” On the 10-second WAV it recognized “Music” only. The transcripts are machine hypotheses. Human listening for style, intelligibility, and artifacts remains open. [Listening procedure used for #105](qa/issue-105/README.md#hörprotokoll)

The generated WAVs for the two probes were recorded locally. Their SHA-256 values were `7e1cf0d485153c242f9eed2e6d54d7ea215e7d78acaca26a2c398b2209c7299d` (10-second limit) and `facc2b700f160ae46b70386d4b88bf2944149618df0ee418007c416a40eddd64` (60-second limit). The adapter exposes WAV output only. The runtime's internal symbolic planning does not add an exported score to the library.

The offline queue test verified both manually placed files through the same installer as the ModelPicker, then created a 10-second-limit job through desktop admission. The native job took 109.38 seconds for that request. The library contained one stereo WAV with duration measured from its samples, the YuE2 runtime pin, and an offline fallback title. A second job was cancelled after synthesis began and produced no library file. The test used a temporary model folder, database, and Tauri test runtime. The native executable was copied and ad-hoc signed for the headless test under an explicit network-denial profile. [Hardware acceptance test](../src-tauri/src/jobs/yue2_tests.rs)

The live Hugging Face test resumed a VAE `.part` file with 65,536 bytes remaining. The same downloader appended the last range, verified the full SHA-256 and promoted the file. [Resume test](../src-tauri/src/jobs/yue2_tests.rs)

The compiled arm64 helper targets macOS 14.0 and links to system libraries and frameworks. It started inside a relocated, signed local test app with inherited App Sandbox restrictions. An earlier local package attempt stalled at the ACE-Step registry probe before YuE2 staging. The existing Rust CPU device probe also exceeded its five-second timeout on this host. [CPU probe test](../src-tauri/tests/device.rs)

The Apple Silicon GitHub Actions job for `d885f52` built the native runtime without a shared runtime cache and verified the relocated portable ZIP and the DMG. Both package checks started the bundled YuE2 helper and confirmed that App Sandbox denied access to an unselected file. The inference, timing, and cancellation results above come from the local M5 Pro. Clean-system GUI acceptance remains open. [Apple Silicon build and package checks](https://github.com/rabbitfiremediacreation/music-generator-desktop/actions/runs/44562989623/job/135697059987)
## Magenta RealTime 2

The optional `mrt2_small` profile records prompted instrumentals as timed 48 kHz stereo WAVs. The ModelPicker shows the pinned downloads and license terms. The verified Apple Silicon path and its measured dropouts are documented separately. [Magenta RealTime 2](magenta-realtime-2.md)

## DiffRhythm 2

DiffRhythm 2 is an opt-in profile for noncommercial evaluation in Expert Mode. It uses English or Mandarin lyrics and a text style description to generate a mono WAV. The optional Linux x86-64 CUDA evaluation build includes the local runner. The picker shows the model licenses and publisher guidance before download or local verification. [Sources, runtime and acceptance procedure](qa/issue-131/README.md)

## AudioCraft

MusicGen Small and MAGNeT Small 30s are optional text-to-music profiles in the Apple Silicon AudioCraft bundle. The ModelPicker displays the CC BY-NC terms and requires explicit selection. [AudioCraft runtime, model requirements and acceptance](qa/issue-132/README.md)


## Text2midi

Choose **Text2midi** in the add-model catalog. The profile shows both model sources, file sizes and checksums, usage terms, and the tested CPU backend. On macOS arm64 the picker shows the one-time terminal command when its Python 3.12 environment is missing. Download the models or verify a local copy using the listed file paths. The studio uses a text prompt and the library provides a separate MIDI result with `.mid` export. [Text2midi setup and verification](../scripts/desktop/text2midi-runtime/README.md)

## Downloads and persistence

The existing Rust streaming downloader provides checked HTTP ranges, `.part` resumption, disk-space checks, SHA-256 verification and promotion only after success. Progress includes filename, verification phase, bytes and MiB/s. The picker stays open on errors and supports cancel/retry. Downloads and activation run under the existing operation lock, so they cannot race an engine operation or wizard. The saved default changes once the complete profile is verified. Failure or cancellation preserves the previous profile and completed setup. Activation stops the active engine. ACE-Step scans the model folder on its next lazy start. Cached proofs avoid rehashing unchanged files when browsing or reusing installed models. Verified offline selection needs no network or extra model-sized disk space.

New jobs store `model_selection` and `generation_profile` in their parameter JSON. The latter records the provider, runtime revision, capabilities and model file pins. ACE-Step uses its synthesis and language filenames. Fixed profiles use a profile ID and list their required files in the catalog. Worker execution and retries resolve that snapshot rather than a later global default. Reusing a new song restores its profile without changing that song or its sampling values. Analysis also sends the selected model filenames in the engine's multipart `request` field alongside the original audio. Existing settings fall back to their original Standard/XL and language model. Existing database rows and audio are preserved. Older jobs without a snapshot use the current ACE-Step selection or the last saved ACE-Step selection when another provider is active.

The first-run assistant offers hardware-recommended ACE-Step starter profiles. Enable Expert Mode in Settings to use the wider catalog afterwards.

## Shared automatic-title model

The picker also shows the Qwen3-0.6B Q8 text model, its approximately 640 MB footprint, verification state and a separate download/verify button. This common auxiliary asset is independent of music-provider profiles. Downloading it never switches the provider or changes existing songs or sampling controls. The assistant includes it with the music models; existing installations can fetch it here or lazily for their first blank-title ACE-Step job. Alternate providers use a locally available title model or fall back to a generated placeholder title. It uses the shared resumable, checksum-verified downloader and cancellation control. See [automatic titles](desktop.md#automatic-song-titles) for lyric priority, offline behavior and error handling.

## MuLaCover

Choose **MuLaCover** in **Add model** to review the noncommercial model and output terms, the pinned native checkpoint and the tested platform. The desktop Creator uses a local WAV reference with lyrics and style. [MuLaCover workflow, sources and hardware verification](mulacover.md)

## Verification

Automated tests cover the 52/8/2 catalog inventory, starter-manifest hash agreement, invalid paths/roles/providers, complete-profile RAM boundaries, persisted selection and immutable queue/retry parameters, checksum failure/cancellation leaving defaults unchanged, successful activation and offline reuse of verified files, plus selected filenames and original audio in analysis multipart requests. Existing downloader tests cover ignored/incorrect Range responses, interruption/resumption, checksum rejection and insufficient disk space.

A browser UI check with simulated Tauri responses passed at 1440×960 and 500×800: RAM filtering, all 52/8 choices, memory rejection, network error/retry, cancellation, successful selection, unchanged sampling until the explicit recommendation and the submitted job snapshot. This checks UI behavior, not real model downloads or native inference. Real inference with every new quantization/family and clean-system GUI/accessibility acceptance on all platforms remain manual checks.
