# ModelPicker

The Creator view has a model drop-down for recommended Standard/XL profiles and displays the automatically assigned language model. Extended selection, verification and downloads are available through **Settings → Manage and download models**. The initial picker shipped in [0.2.8](https://github.com/frankhildebrandt/music-generator/releases/tag/v0.2.8-test.1). ACE-Step is the supported music provider.

The separate **Settings → Reopen setup wizard…** entry opens the full setup flow for storage locations, model downloads and a function test. The same entry is available inside the model manager. Completing the wizard activates a recommended Standard or XL starter profile; use the model manager for regular model changes.

## Simple selection and Expert Mode

By default, the Creator drop-down offers **Standard** and, only when its complete profile fits the detected RAM budget, **XL**. These use SFT Q8_0. Each profile has exactly one automatically recommended Q8_0 language model; there is no manual size selector. Recommendations use the existing RAM/VRAM language-size guidance (0.6B, 1.7B or 4B), lowering the size if needed to fit synthesis, language weights, fixed dependencies and runtime headroom together. If no starter profile fits, the drop-down explains that no recommendation is available. The first-run assistant follows the same rules.

The Creator drop-down uses `select_models`, which activates only already verified local files and persists the choice without downloading. If files are missing or need verification, the previous selection stays active and an inline hint links to Settings. The requested profile is preselected in the model manager, where download/verification needs an explicit action. Advanced profiles selected in Settings or restored from songs remain visible as the current drop-down entry; the Creator does not expand into a full catalog when Expert Mode is enabled.

Enable **Settings → Expert Mode** and save to show the full family/precision catalog in the Settings model manager and manual language-model choices, plus the existing RAM filter, auxiliary title-model management and sampling recommendations. Choose a synthesis model and language model, then select **Use selection**, **Verify and use**, or **Download and use**. Missing base files are included automatically. In Expert Mode, an existing choice stays visible even when it exceeds the budget; a new combination above the estimate cannot be activated. This is resource guidance rather than an inference certification: duration, GPU memory and runtime buffers can impose further limits.

The boolean `expert_mode` is stored in the existing SQLite settings table. New installations and old configurations without the key default to `false`. Saving the switch updates availability immediately without restarting. Pure Expert Mode changes are serialized with queue admission and can be saved while generation or analysis runs; mixed settings edits keep the existing exclusive configuration rules.

Every profile outside this computer's recommendations requires Expert Mode in the backend too: other families (including all seven Turbo families), other quantizations and non-recommended language sizes. The policy guards activation/download, generation, retry, analysis and wizard requests. `models/catalog.json` centrally declares starter assets and Turbo-family membership; the backend supplies the actual hardware-specific profiles to the UI. RAM filtering cannot reveal a restricted saved choice.

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

## Downloads and persistence

The existing Rust streaming downloader provides checked HTTP ranges, `.part` resumption, disk-space checks, SHA-256 verification and promotion only after success. Progress includes filename, verification phase, bytes and MiB/s. The picker stays open on errors and supports cancel/retry. Downloads and activation run under the existing operation lock, so they cannot race an engine operation or wizard. Only a complete verified profile replaces the saved default; failure/cancel leaves the previous profile and completed setup intact. The engine is stopped before activation and scans the expanded model folder on its next lazy start. Cached proofs avoid rehashing unchanged files when browsing or reusing installed models; verified offline selection needs no network or extra model-sized disk space.

New jobs store `model_selection` (provider, synthesis filename, language filename) in their parameter JSON. Worker execution and retries resolve that snapshot rather than a later global default. Reusing a new song restores its profile without changing that song or its sampling values. Analysis also sends the selected model filenames in the engine's multipart `request` field alongside the original audio. Existing settings fall back to their original Standard/XL and language model. Existing database rows and audio are not rewritten; older jobs without a snapshot retain their previous settings-based behavior.

The first-run assistant offers hardware-recommended ACE-Step starter profiles. Enable Expert Mode in Settings to use the wider catalog afterwards.

## Shared automatic-title model

The picker also shows the Qwen3-0.6B Q8 text model, its approximately 640 MB footprint, verification state and a separate download/verify button. This common auxiliary asset is independent of music-provider profiles. Downloading it never switches the provider or changes existing songs or sampling controls. The assistant includes it with the music models; existing installations can fetch it here or lazily for their first blank-title job. It uses the shared resumable, checksum-verified downloader and cancellation control. See [automatic titles](desktop.md#automatic-song-titles) for lyric priority, offline behavior and error handling.

## Verification

Automated tests cover the 52/8/2 catalog inventory, starter-manifest hash agreement, invalid paths/roles/providers, complete-profile RAM boundaries, persisted selection and immutable queue/retry parameters, checksum failure/cancellation leaving defaults unchanged, successful activation and offline reuse of verified files, plus selected filenames and original audio in analysis multipart requests. Existing downloader tests cover ignored/incorrect Range responses, interruption/resumption, checksum rejection and insufficient disk space.

A browser UI check with simulated Tauri responses passed at 1440×960 and 500×800: RAM filtering, all 52/8 choices, memory rejection, network error/retry, cancellation, successful selection, unchanged sampling until the explicit recommendation and the submitted job snapshot. This checks UI behavior, not real model downloads or native inference. Real inference with every new quantization/family and clean-system GUI/accessibility acceptance on all platforms remain manual checks.
