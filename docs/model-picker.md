# ModelPicker

The Creator view has a model drop-down for recommended Standard/XL profiles and displays the automatically assigned language model. **Settings → Models and hardware** initially lists installed local model files, their roles, sizes and verification status. Verified compatible profiles can be activated from this list without downloading. **Add model** opens extended selection, verification and downloads in an additional dialog above Settings. **Choose models** in the Creator opens the settings page with the requested profile ready for the add dialog. The picker also shows optional profiles and checks their native runtime and hardware requirements before activation.

The additional downloader dialog uses a split catalog and detail view. Search and **All / Installed / Recommended** filters browse sound-model families on the left; Installed requires a verified local file, and Recommended uses the actual hardware recommendations. The detail pane shows quantization variants for the chosen family, its companion language model, file size, total profile download, memory estimate, required files and the explicit download/activation action. Choosing a family only changes the preview. On narrow layouts the catalog appears above the details. Escape closes only the add dialog and returns focus to Add model; Settings and its unsaved drafts remain open. Download progress and cancellation stay available on the installed-models page when the additional dialog is closed.

**Hardware test in setup wizard…** on the settings models page opens the full setup flow for storage locations, model downloads and a function test. Completing the wizard activates a recommended Standard or XL starter profile; use the settings models page for regular model changes.

## Simple selection and Expert Mode

When no XL recommendation fits this computer's RAM budget, a visible hint beside the Creator drop-down explains that XL requires more memory and is not recommended. This also appears in Expert Mode: installing an XL file or enabling that mode does not add an XL recommendation or remove the backend's memory checks. The hint and all Settings labels/status messages are localized in all twelve UI languages and update when the language changes.

By default, the Creator drop-down offers **Standard** and, only when its complete profile fits the detected RAM budget, **XL**. These use SFT Q8_0. Each profile has exactly one automatically recommended Q8_0 language model; there is no manual size selector. Recommendations use the existing RAM/VRAM language-size guidance (0.6B, 1.7B or 4B), lowering the size if needed to fit synthesis, language weights, fixed dependencies and runtime headroom together. If no starter profile fits, the drop-down explains that no recommendation is available. The first-run assistant follows the same rules.

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

## Downloads and persistence

The existing Rust streaming downloader provides checked HTTP ranges, `.part` resumption, disk-space checks, SHA-256 verification and promotion only after success. Progress includes filename, verification phase, bytes and MiB/s. The picker stays open on errors and supports cancel/retry. Downloads and activation run under the existing operation lock, so they cannot race an engine operation or wizard. Only a complete verified profile replaces the saved default; failure/cancel leaves the previous profile and completed setup intact. The engine is stopped before activation and scans the expanded model folder on its next lazy start. Cached proofs avoid rehashing unchanged files when browsing or reusing installed models; verified offline selection needs no network or extra model-sized disk space.

New jobs store `model_selection` and `generation_profile` in their parameter JSON. The latter records the provider, runtime revision, capabilities and model file pins. ACE-Step uses its synthesis and language filenames. Fixed profiles use a profile ID and list their required files in the catalog. Worker execution and retries resolve that snapshot rather than a later global default. Reusing a new song restores its profile without changing that song or its sampling values. Analysis also sends the selected model filenames in the engine's multipart `request` field alongside the original audio. Existing settings fall back to their original Standard/XL and language model. Existing database rows and audio are preserved. Older jobs without a snapshot use the current ACE-Step selection or the last saved ACE-Step selection when another provider is active.

The first-run assistant offers hardware-recommended ACE-Step starter profiles. Enable Expert Mode in Settings to use the wider catalog afterwards.

## Shared automatic-title model

The picker also shows the Qwen3-0.6B Q8 text model, its approximately 640 MB footprint, verification state and a separate download/verify button. This common auxiliary asset is independent of music-provider profiles. Downloading it never switches the provider or changes existing songs or sampling controls. The assistant includes it with the music models; existing installations can fetch it here or lazily for their first blank-title ACE-Step job. Alternate providers use a locally available title model or fall back to a generated placeholder title. It uses the shared resumable, checksum-verified downloader and cancellation control. See [automatic titles](desktop.md#automatic-song-titles) for lyric priority, offline behavior and error handling.

## Verification

Automated tests cover the 52/8/2 catalog inventory, starter-manifest hash agreement, invalid paths/roles/providers, complete-profile RAM boundaries, persisted selection and immutable queue/retry parameters, checksum failure/cancellation leaving defaults unchanged, successful activation and offline reuse of verified files, plus selected filenames and original audio in analysis multipart requests. Existing downloader tests cover ignored/incorrect Range responses, interruption/resumption, checksum rejection and insufficient disk space.

A browser UI check with simulated Tauri responses passed at 1440×960 and 500×800: RAM filtering, all 52/8 choices, memory rejection, network error/retry, cancellation, successful selection, unchanged sampling until the explicit recommendation and the submitted job snapshot. This checks UI behavior, not real model downloads or native inference. Real inference with every new quantization/family and clean-system GUI/accessibility acceptance on all platforms remain manual checks.
