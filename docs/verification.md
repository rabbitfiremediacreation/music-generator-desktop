# PR #5 review corrections — 2026-10-25

The Standards and Spec reviews identified three material issues, now fixed:

- Settings and admission repeatedly ran synchronous hardware detection, including inside the queue status mutex. Hardware is now one immutable process-session snapshot; generation/retry prime it before queue admission. A cross-thread test verifies that callers share it.
- Background title-model events and delayed Creator activation/settings responses could overwrite a restored song profile. Local selection intent is now tracked separately from permission metadata: older results cannot replace a newer choice, and older catalogs cannot restore an outdated Expert Mode. Returning from setup preserves the form choice; successfully completing setup explicitly adopts the tested profile.
- Reopening setup in Expert Mode after the normal single-size view could clear a stored 4B language model. The wizard now builds its available options before applying the stored choice or recommendation.

Nine DOM regression cases exercise the actual frontend modules against the application HTML using happy-dom as a development-only dependency. The failing state-loss, stale-mode and language-selection cases were reproduced before their respective corrections; all now pass. Local validation passed: **106 Rust tests, 47 frontend tests, 28 desktop-script tests, TypeScript/Vite, ESLint, Rustfmt and Clippy with warnings as errors**. Both review axes were checked again without remaining material findings. Existing screenshots remain representative; this correction did not add a packaged-app or real-model inference run.

# Expert Mode and hardware-recommended selection — 2026-10-25

Normal mode offers Standard SFT Q8_0 and, only within the complete-profile RAM budget, XL SFT Q8_0. Each receives one automatic Q8_0 language-model recommendation from the existing hardware guidance. Settings → Expert Mode persistently unlocks other families, precisions and language sizes. The same policy guards backend admission and setup; accepted queue snapshots continue after disabling the mode, including after restart.

Local validation passed: **105 Rust tests, 38 frontend tests, 28 desktop-script tests, TypeScript/Vite, ESLint, Rustfmt and Clippy with warnings as errors**. New coverage includes missing-key defaults, persistence, all catalog family/precision combinations, 8/16/32 GiB recommendations and exact XL RAM boundaries, blocked installation without side effects, generation/analysis/retry admission, live preference writes and ordering with queue admission, write failure, immutable queued snapshots, and retained audio/export.

A browser check using simulated Tauri responses verified Standard/XL plus automatic 1.7B on 16 GiB, Standard only plus 0.6B on 8 GiB, the full 52/8 expert catalog with the RAM filter off, Save/Cancel behavior, a failed save preserving the stored mode, and a retained Turbo selection with blocked activation and explicit recommendation recovery. This exercises UI behavior; it does not claim a packaged GUI run or real-model generation on the simulated hardware. Rust tests ran outside the execution sandbox for their loopback servers and existing nested macOS sandbox test. The Creator drop-down additionally passed verified offline switching (two selections with no additional simulated download), missing-XL rollback with an inline Settings link, and preservation of the requested XL profile until explicit download in Settings. The extended 52/8 selectors remain in Settings. [Screenshots and flow documentation](model-picker.md#screenshots-of-the-creator-and-settings-flows) are committed with the change.

# Runtime and configuration encapsulation — 2026-10-25

Runtime operation admission, cancellation, progress and configured readiness now have a single owner. Owned permits clean up on errors and task aborts; engine ownership and the generation worker are separate modules. Releasing engine memory preserves configured readiness. Setup and settings share validation, native folder authorization and a complete settings commit, with file copying and rollback outside the database and async executor.

Local validation passed: **92 Rust tests, 28 frontend tests, 14 desktop-script tests, TypeScript/Vite, ESLint, Rustfmt and Clippy with warnings as errors**. Thirteen added Rust tests cover exclusive admission, scoped cancellation, shutdown, aborted async/blocking callers, settings authorization and validation failures, SQLite rollback, and engine timing/device updates. The six setup commit regressions now exercise the shared configuration path. Startup and folder-collision integration tests use the encapsulated APIs.

The Rust suite ran outside the agent execution sandbox for loopback servers and the nested macOS sandbox regression. No new packaged GUI or real-model inference run is claimed; the PR push triggers the configured macOS ARM bundle CI.

# PR #1 review regressions — 2026-10-25

The three review findings are fixed:

- Windows version detection parses the build separately from its update revision. Representative Windows 10 outputs such as `10.0.19045.6456` activate the fixed-WebView2 ACL path; Windows 11, older Windows and invalid output do not. The regression failed before the parser fix and passes afterwards.
- macOS ZIP export stages archives in Foundation's same-volume item replacement directory, then moves or replaces only the selected destination. Temporary storage is cleaned on success and failure. A macOS `sandbox-exec` regression grants writes to exactly one destination while denying writes to its siblings: creating and replacing the ZIP succeed, and a failed export preserves the existing ZIP. This test failed with the former sibling `.part` file. It models save-panel filesystem permissions; it does not drive a GUI save panel.
- Reconfiguration finishes the hardware test and grants playback access before moving the song folder. Tests retain existing audio/settings after test failure, cancellation during/following the test, and denied playback access; successful setup grants access before moving and saving. Setup without a folder change still accepts existing queued jobs.

Local validation passed: **79 Rust tests, 28 frontend tests, 14 desktop-script tests, TypeScript/Vite, ESLint, Rustfmt and Clippy with warnings as errors**. The Rust suite runs outside the agent's execution sandbox to permit its loopback HTTP servers and the nested macOS filesystem-sandbox test. Windows GUI startup and a packaged-app save-panel check were not repeated locally; the new push triggers the configured macOS ARM bundle CI.

# Separate Linux CUDA build and ACE-Step-only application — 2026-10-25

The Linux matrix now has independent Vulkan/CPU and NVIDIA CUDA/CPU jobs. The existing `linux-x64.AppImage` name is preserved; CUDA uses `linux-x64-cuda.AppImage`. Target flags, runtime provenance, cache keys, release-build validation and embedded update selection distinguish the variants. CUDA Toolkit 12.8.1 compiler components and Runtime/cuBLAS/cuBLASLt redistributables are pinned to official archive SHA-256 values in `models/cuda-linux.json`. The CUDA build disables direct VMM driver linkage and uses an explicit SM list, so the configured build and CPU package checks do not require a GPU or driver installation.

HeartMuLa has been removed from the UI, catalog, adapter, setup, sampling controls, manifests, packaging and runtime probes. Regression tests reject its new job requests, restore supported settings without rewriting stored settings/song parameters, and preserve existing model files. Cached or bundled retired-provider resources are rejected. A freshly rebuilt arm64 macOS ZIP and DMG contain no HeartMuLa runtime and both pass portable resource, minimum-OS, signing, sandbox, CPU engine health/shutdown, title-helper and WAV/MP3/ZIP checks.

Local checks passed on macOS 26.6.2: TypeScript/Vite, ESLint, 28 frontend tests, 12 desktop build/runtime-policy tests, 69 Rust tests plus doc-test phase, Rustfmt, Clippy with warnings as errors, script syntax and actionlint. Existing user-data checksums remain unchanged. The desktop tests cover distinct filenames/backend flags, cache separation, stale recipes, unrecorded/retired resources, relative loader paths, missing/external CUDA dependencies, forbidden driver stubs and runtime/license copying. The CUDA pin was compared with NVIDIA's official redistribution manifest, and the downloaded cudart archive layout was checked.

[Native CI run 40140255235](https://github.com/frankhildebrandt/music-generator/actions/runs/40140255235), source `4775cd8bfda58df8f386ad34dd0861b1f5e9cd58`, passed all five jobs: Apple Silicon macOS 14.0 target, Intel macOS 13.3 target, Windows x64, Linux Vulkan/CPU and Linux CUDA/CPU. Both Linux jobs passed the final AppImage checksum, extraction into a relocated directory with spaces, resource provenance, title-helper startup, CPU engine HTTP health, supervised shutdown and MP3 conversion while preserving the original WAV. CUDA dependency checks passed both before packaging and after extraction without a system CUDA Toolkit or bundled NVIDIA driver. The CUDA compiler used the pinned architecture list on a runner without an NVIDIA GPU. Both macOS ZIP/DMG pairs passed their native package checks too.

The [Vulkan/CPU AppImage artifact](https://github.com/frankhildebrandt/music-generator/actions/runs/40140255235/artifacts/12579345920) and [CUDA/CPU AppImage artifact](https://github.com/frankhildebrandt/music-generator/actions/runs/40140255235/artifacts/12580804333) are CI artifacts, not published releases. Real generation on supported NVIDIA hardware remains required before publishing the CUDA artifact; the CPU smoke test uses a tiny metadata-only GGUF fixture and does not perform model inference. Actual GUI/audio and inference acceptance on the minimum supported macOS versions also remains open.

# macOS 14 release packages — 2026-10-25

Built version 0.2.9 for Apple Silicon from the separated desktop base `6f5774d95218bc7c7dbb86658d9ed09511a807b7` plus the local macOS-14 target/cache/parser changes. HeartMuLa is absent from this source and from the sealed app/resource manifest.

Both `Music-Generator-0.2.9-macos-arm64.zip` and `.dmg` pass `verify-bundle.mjs` (including `--dmg`): archive SHA-256, relocated resource/provenance checks, arm64 architecture and deployment target of every Mach-O, app plist, deep strict signatures, actual sandbox read/write denial in parent and engine, title-runtime startup, loopback engine health, supervised shutdown, MP3/ZIP export, unchanged original WAV and deleted export cache. All 22 packaged Mach-O files declare minimum macOS 14.0. The DMG additionally passes integrity, read-only mount, Applications shortcut, copy, detach and relocated-app tests.

ESLint, TypeScript/Vite, 28 frontend tests, four desktop policy tests and 65 Rust tests with deployment target 14.0 pass. Builds and bundle checks ran on macOS 26.6.2 with the macOS 27 SDK. These local bundles are ad-hoc signed and not notarized. Actual GUI/audio and model inference acceptance on macOS 14/15 remains open.

The checked files and logs were also copied to `release/local-0.2.9-macos14/`, with a detailed `verification-macos14.txt` report. ZIP SHA-256: `2996876cff777250efff3ffe4eba4d5f8c47f8df1e9755acb29181433161b1e8`. DMG SHA-256: `1768f872375a726aa90c81803c93f7442b705372b547ac32f2c8af6e51724bd6`.

# Desktop provider separation — 2026-10-24

The desktop branch now contains ACE-Step music generation and the shared local title model. The provider-specific runtime, model catalog entries, setup controls, sampling, tests, build requirements and notices have been extracted from this branch. Realtime progress, automatic titles, model snapshots and existing saved-song behavior remain covered by the desktop suite.

Local macOS validation after separation: TypeScript/Vite, ESLint, 28 frontend tests, one Node build-policy test, 65 Rust tests, Rustfmt and Clippy with warnings as errors passed. This split has not yet received new native Windows/Linux/Intel bundle or GUI acceptance; earlier results below describe their historical source versions.

# ModelPicker follow-up — 0.2.8 development, 2026-10-24

The published 0.2.7 assets below remain tied to their original source. The subsequent ModelPicker implementation is documented in [model-picker.md](model-picker.md). Local checks passed: TypeScript/Vite, ESLint, 20 frontend tests, one Node build-policy test, 53 Rust tests on Apple Silicon, Rustfmt and Clippy with warnings as errors. Additional native CI results are recorded in the PR after the build completes. Browser checks use simulated Tauri responses and cover 1440×960 / 500×800 layouts, download error/cancel/retry and selection persistence without changing sampling. They do not replace real inference on each target.

# Desktop verification — 2026-10-24

Release 0.2.7 (2026-10-24, original main through `854afb9`): Rust explicitly sends numeric `peak_clip: 0` to LM and synthesis. The HTTP generation contract supplies stored input with 17 and LM metadata with 10, verifies that both requests use 0, and checks unchanged complete input plus preserved binary audio/metadata. Both pinned engine parsers support the setting; their resource versions are unchanged. The old Python Git-updater compatibility fix is documented as inapplicable to bundle updates. Local checks passed: 47 Rust tests, fifteen frontend tests, one Node build-policy test, TypeScript/Vite, ESLint, Rustfmt and Clippy. Existing saved-value, migration, import, queue timing and timeout regressions pass. No new acoustic clipping measurements or real inference acceptance is claimed; historical measurements below retain their original scope.

Release 0.2.6 follow-up (2026-10-23, original main through `ad6c98d`): nullable SQLite `started_at` is added without rewriting stored parameter bytes or existing song timestamps. Queue claims set it atomically for each attempt; retries and restart recovery receive a new start when claimed. Import uses explicit column names, preserves existing starts and upgrades only the staged copy of an old source library. Fifteen frontend tests include generation-time display without queue waiting, old-song fallback and invalid timestamps; 47 Rust tests include migration, queue retry/resume and imports with/without start times. Existing saved-value and timeout regressions pass. TypeScript/Vite, ESLint, Node build-policy, Rustfmt and Clippy also pass locally. Published 0.2.5 bundles remain unchanged; this source prepares a new 0.2.6 test release.

Timeout-message follow-up (2026-10-23, `b5b1670`): Rust reports the timed-out engine phase, rounded elapsed minutes and guidance to raise Timeout in Settings. The engine is still cancelled on timeout, while user cancellation retains its own error. A fresh synthesis memory log cannot replace the timeout guidance. Tests cover minute formatting/serialization, actual HTTP job cancellation and full stored parameters after error persistence, SQLite restart and retry. Frontend cases cover old/new German and English timeout messages, unrelated failures, and settings guidance in all twelve translations. No schema, stored generation parameters, request defaults or timeout setting/default changes. Published 0.2.5 assets remain unchanged.

Local checks passed: TypeScript/Vite, ESLint, twelve frontend tests, one Node build-policy test, 44 Rust tests, Rustfmt and Clippy with warnings as errors. All 60 timeout/length/sampling strings match current upstream exactly; the existing old/custom/new reuse and SQLite restart/error/retry regressions still pass.

The settings path applies validated poll/timeout durations to the cached client rather than replacing it, so saving a higher timeout preserves synthesis-log diagnostics. Device changes retain their existing engine-restart behavior.

0.2.5 ten-minute follow-up (2026-10-23, `0e64bc7`): the duration slider now reaches 600 seconds with a localized warning above five minutes. Rust limits LM overproduction to requested duration × 5 and at most 3000 codes before synthesis, leaving saved parameters unchanged. New tests cover code bounds and a real LM → synthesis mock contract, plus fresh-log memory explanations for failed jobs, HTTP errors and missing audio while ignoring earlier errors. Unit tests cover missing/truncated logs and length-error precedence. stdout/stderr share the same owned-engine log on all desktop platforms. Local TypeScript/Vite, ESLint, ten frontend tests, one Node build-policy test, 43 Rust tests, Rustfmt and Clippy passed; all 48 localized length/sampling strings match the original main. Real ten-minute inference on Intel or 8 GiB systems remains untested.

Upstream defaults follow-up (2026-10-23, `3374648`): fresh forms use 80 iterations and variance 1.2; saved song parameters and legacy model defaults remain unchanged. Ten frontend tests include explicit old/custom/new song reuse, omitted/sentinel fallback, fresh HTML values and all twelve localized tooltips while retaining desktop MP3/device messages. A new SQLite regression verifies complete parameter objects survive restart and a real error → retry → queued execution cycle alongside newly queued 80/1.2 songs. Backend request defaults, schema and storage code are unchanged. The previously published 0.2.4 test-release binaries are not replaced by this merge.

Intel desktop follow-up (0.2.4, 2026-10-22):

- Separate native x64 DMG/ZIP with a macOS 13.3 deployment target, CPU-only pinned engine, portable runtime-selected CPU variants, sandbox inheritance and native window controls. A `macos-15-intel` CI job builds/tests the Intel packages alongside the existing three platform jobs.
- Local checks passed: TypeScript/Vite, ESLint, six frontend tests, one Node build-policy test, 37 Rust tests, Rustfmt and Clippy with warnings as errors. The new Rust cases verify that Intel uses one CPU server even with saved split/CPU preferences, and that update assets are selected by architecture.
- Bundle verification additionally checks every Mach-O architecture/deployment target, the app's minimum-OS plist value and absence of a Metal backend in Intel packages. The packaged sandbox probe checks a shared CPU LM/synthesis server on Intel, while retaining the separate-CPU-LM assertion on Apple Silicon. Existing actual sandbox enforcement and WAV/MP3/ZIP checks apply to both architectures.
- [Native bundle verification run 39850148957](https://github.com/frankhildebrandt/music-generator/actions/runs/39850148957), source `355746fc126098b61dab89dafba596320c1f819e`: Intel macOS 15 passed all 37 Rust tests, frontend/build-policy tests, Clippy and the final ZIP and DMG probes. Both Intel distributions passed Mach-O architecture/deployment-target checks, plist minimum version 13.3, no Metal backend, strict signatures, actual main/engine sandbox denial, shared CPU server health/shutdown, MP3 conversion/ZIP and cache deletion. The other three platform packages passed their native verification too. The [Intel DMG/ZIP artifact](https://github.com/frankhildebrandt/music-generator/actions/runs/39850148957/artifacts/12459467664) includes both SHA-256 files. The downloaded Intel files passed SHA-256 locally, ZIP archive integrity and `hdiutil verify`.
- This host is Apple Silicon; no local Intel hardware inference or macOS 13.3 GUI/audio acceptance is claimed. CPU setup checks engine startup/health and skips the GPU correctness benchmark; it does not perform music inference. Older Intel machines can take many minutes per song. Existing 0.2.3 release artifacts are unchanged.

Upstream synchronization (0.2.3, 2026-10-22): see [upstream-sync.md](upstream-sync.md) for the original commits, Rust/Tauri adaptations and new verification coverage. Local checks pass: 35 Rust tests, six frontend tests, TypeScript/Vite, ESLint, Rustfmt and Clippy. Earlier sections below describe the corresponding historical test versions.

Persistent first-run completion (0.2.2):

- Startup now trusts the existing SQLite `setup_complete` flag. It neither scans model files nor waits for the engine. Existing completed installations need no migration or repeated hardware test.
- Generation/analysis starts the engine on demand and validates model availability/integrity then. Pending jobs resume through the existing worker. The health command treats a configured, idle app as healthy rather than incorrectly showing it as offline.
- Completion is committed only after successful folder scoping and a final cancellation check. Failures during later model use do not erase a previously completed setup or prevent access to the library.
- A real SQLite restart regression verifies that unfinished setup remains unfinished, completed setup restores readiness without models or engine resources, no engine is started, and missing models are reported on first use while completion stays saved.
- Local TypeScript/Vite, ESLint, three frontend tests, 30 Rust integration tests, Rustfmt and Clippy passed. No new end-to-end GUI startup timing is claimed here.

Setup verification optimization (0.2.1):

- On the same M5 Pro, checking the same five real models (12.51 GiB, including 4B and XL) with an empty verification cache took 26.351 seconds before and 6.444 seconds after enabling ARM SHA-256 acceleration and increasing the read buffer. This is about 4.1× faster (76% less time). The OS file cache was not cleared; these figures measure model verification, not engine startup or the language-model self-test.
- Reusing the existing 0.2.0 verification cache took 0.813 ms after the change. Successful downloads and checks now populate the same persistent cache immediately, including after promoting a `.part` file. Subsequent setup attempts and launches no longer hash those files again while their canonical path, checksum, length and modification time match.
- Verification progress now reports actual bytes, including during startup, and engine startup is displayed separately. Startup phase timings are written to the desktop log. Hardware detection refreshes RAM only instead of collecting process and CPU statistics.
- Local TypeScript/Vite, ESLint, three frontend tests, 29 Rust integration tests, Rustfmt and Clippy passed. Added regressions cover persistent reuse, changed content/checksums, a damaged cache, cancellation during verification and reuse of downloaded files without another checksum pass.
- Portable-bundle verification selects the current application version explicitly, so an older package in `release/` cannot accidentally satisfy the check.

Local environment: macOS 26.6.2, Apple M5 Pro, 64 GiB RAM; application version 0.2.0.

App Sandbox and DMG follow-up:

- [Successful native Mac CI job](https://github.com/frankhildebrandt/music-generator/actions/runs/39598450971/job/119216542103), source commit `d2299c8`: ZIP and DMG both pass their sandbox and packaged-engine checks.
- The [complete native CI run](https://github.com/frankhildebrandt/music-generator/actions/runs/39598450971) is green for macOS, Windows and Linux. The new import case brings Rust integration coverage to 25 tests on macOS/Linux and 24 on Windows, plus the three frontend tests on every platform.
- Packaged Mac app enables App Sandbox; supervisor and engine use the two inheritance entitlements. There are no blanket filesystem exceptions.
- Local ZIP and read-only DMG checks passed: SHA-256, strict/deep signature verification, engine resource hashes, Applications shortcut, copying the app out of the DMG and ejecting the image.
- Actual OS enforcement passed in both distributions: main app cannot read an unselected file or write into its directory; the inherited engine cannot read that file either. Container storage, loopback health and supervisor shutdown work.
- TypeScript/Vite, ESLint, three frontend tests, 25 Rust integration tests and Clippy pass locally. The added import case preserves an earlier unsandboxed desktop profile and its model location.
- The sandboxed GUI imported the existing three-song desktop library through the native folder dialog. The originals remain in the previous profile; models are read from the authorized external folder without copying their large files.
- The 4B Metal hardware self-test passed. Restarting the app then restored the folder grants and reached the studio without selecting folders again; a real short music generation succeeded after that restart with models outside the sandbox container.
- The downloaded CI DMG passed SHA-256 and `hdiutil verify`; the corresponding ZIP passed SHA-256 and archive integrity checks. Developer ID signing and notarization are not claimed for these ad-hoc test builds.

Passed automated checks:

- TypeScript checking, Vite production build, ESLint.
- 3 frontend command-contract tests.
- 24 Rust integration tests covering downloads, engine contracts, process supervision, library and legacy import.
- Rust formatting and Clippy with warnings treated as errors.
- Native macOS release build with bundled engine, engine checksum verification, ZIP and SHA-256 generation.

Native GitHub Actions verification:

- [Successful run 39573303203](https://github.com/frankhildebrandt/music-generator/actions/runs/39573303203), source commit `82ddf1f`, all three native jobs green.
- macOS 26 / Apple Silicon: ZIP containing the `.app`, native window traffic lights and bundled Metal/CPU engine; valid ad-hoc bundle signature.
- Windows Server 2022 / x64: portable ZIP containing the EXE, CUDA/Vulkan/CPU engine, app-local Visual C++ DLLs and pinned Fixed Version WebView2 runtime.
- Ubuntu 22.04 / x64: AppImage containing the Vulkan/CPU engine and media framework. A pinned Vulkan SDK supplies the shader compiler. Final packaging with checksummed appimagetool 1.9.1 preserves the original verified engine files after linuxdeploy's ELF processing.
- Each job passed TypeScript/Vite, ESLint, three frontend tests, Rust formatting, integration tests and Clippy with warnings treated as errors. Windows runs 23 Rust tests; macOS/Linux also run the Unix process-supervisor test, for 24.
- Each final artifact passed SHA-256 verification, extraction into a relocated directory with spaces, all bundled engine-file checksums, packaged supervisor/engine startup in CPU mode, HTTP health and shutdown on control-pipe closure. The smoke test uses a tiny metadata-only GGUF fixture; it does not perform inference.
- All three downloaded artifacts passed SHA-256 checks locally. Windows and macOS ZIPs also passed ZIP-integrity checks; the downloaded Mac app's ad-hoc signature passed strict/deep verification.

Passed in the actual `.app` bundle:

- First-run assistant, hardware detection, checksummed downloads of the base models, optional XL and 4B language model.
- Accelerated 4B language-model self-test: 50 audio codes for the ten-second test.
- A real ten-second instrumental generated with standard SFT and the 4B LM; finished in approximately sixteen seconds.
- Waveform display and playback with advancing play time.
- Native WAV save dialog; exported file SHA-256 matches the source audio.
- Local analysis of the exported WAV; caption, tempo, key and style populated the form.
- App close terminates its engine/supervisor; reopening preserves the library and reuses models.
- Launch from a copied/moved `.app` directory preserves the library and reaches the studio without downloading models again.
- Final ZIP integrity, SHA-256 verification and the ad-hoc macOS bundle signature pass.
- Responsive layout at 480 px width, approximately 1013×560, and maximized; full client width, stacked layout when narrow, independent panes when wide, accessible library after scrolling.
- Native macOS close/full-screen/minimize controls are present and accessible; custom right-side controls are hidden on Mac. Restoring old saved window state no longer removes the native decorations.

Not verified on this host:

- Full Windows/Linux GUI and inference acceptance on clean machines without development tools, including current Ubuntu and Arch. Native CI builds and packaged-engine smoke tests have passed, but do not replace those checks.
- GPU/driver combinations other than this Mac; CPU fallback is covered by contract/self-test logic, not a hardware run on this host.
- Physical microphone recording, actual VoiceOver/NVDA/JAWS operation and notarization/Developer ID signing.

The old browser-installation PDFs have been removed. Follow the release acceptance checklist in desktop.md before publishing a supported cross-platform release.

## Shared automatic-title model (0.2.9 development)

Blank titles use a shared pinned Qwen3-0.6B Q8 model (639,446,688 bytes) and native CPU-only llama.cpp helper. Both music providers use the finished lyrics first; instrumental songs use their prompt. Manual titles and renames during inference win atomically at SQLite completion. Completed songs and saved generation parameters are not rewritten. The assistant and ModelPicker expose the shared checksum-verified download; saved setup still skips model scans at startup. Title inference errors preserve finished audio and show a warning.

Local validation on Apple Silicon: 72 Rust tests, 28 frontend tests, one Node build-policy test, TypeScript/Vite, ESLint, Rustfmt and Clippy passed. Added cases cover generated-lyrics priority, instrumental fallback, bounded multilingual input, output validation, manual-title preservation including rename races, unchanged parameters, a saved song after title failure/restart, both setup plans and cancelled title-model installation. The existing downloader suite continues to cover resume, ignored/invalid HTTP ranges, checksum errors, cached offline reuse and disk-space rejection.

The actual 640 MB model was downloaded and SHA-256 checked. Native CPU inference with synthetic German lyrics about hope/light and a conflicting English beach/reggae prompt returned **Licht und Hoffnung in der Nacht**. The finished sandboxed macOS app repeated this through Rust's supervised native helper and additionally generated **Neon midnight city** for a prompt-only instrumental case. Temporary request/output files were removed. A private fixture copy inside the app's container and a temporary library were removed afterwards; user songs/settings were not modified. `MUSIC_TITLE_SMOKE_MODEL` optionally enables this real-model check in the existing `--sandbox-probe` harness; the fixture must already be inside the app container.

The local ARM ZIP and DMG pass SHA-256, relocation, architecture/deployment-target, signature, native helper startup, real sandbox read/write denial, supervised shutdown, MP3 export and ZIP regressions. The title helper carries only the inherited child sandbox entitlements. Source/archive hashes, build recipe and runtime-file checksums are checked by preparation, release build and bundle verification. Windows/Linux bundle verification starts the title runtime; macOS does so inside the real app sandbox. Real title inference on Intel/Windows/Linux and full clean-system GUI/accessibility acceptance remain additional checks.

## Issue #8 — library import and song-storage assistant (2026-10-25)

The import preview and execution now receive the selected destination explicitly, independently of model setup. Regression coverage includes project/data-folder discovery, an accidentally selected song folder, separate and corrected audio sources, read-only source/WAL preservation, old-schema migration only in the snapshot, partial import with retained metadata, audio/ZIP exclusion, source/target symlinks, collisions, insufficient space using a sparse fixture, permission denial, cancellation within a file, database-commit rollback and moving partial libraries. UI tests exercise explicit partial-import consent, native selection grants, destination changes, rechecking after failure, cancellation and measured progress for both import and move. All new messages are supplied in the twelve supported UI languages.

Native acceptance used an ad-hoc-signed, packaged **debug** macOS app with the actual App Sandbox entitlements and a separate `de.alphatester.music-generator.import-test` identity/profile. No existing user library was modified. Fixture: an old web-project database, an external sibling audio directory, one available WAV and one missing WAV. The song destination was selected in setup before model configuration. The preview denied access to the separate old audio until its native folder selection, then required explicit partial-import consent. Import copied the available WAV byte-for-byte to the selected external destination, retained both metadata records, marked the missing audio and left the source schema unchanged. Only destination access was bookmarked.

After restarting the app, the external song played through the asset protocol. For the library-view and move acceptance only, the isolated fixture profile's setup flag was set directly, avoiding unrelated multi-GB model downloads. Settings exposed the new move assistant; it moved available audio, retained the missing metadata and removed the previous copied audio only after commit. Removing the test destination bookmark while the app was stopped reproduced a lost grant: the assistant blocked copying and offered direct source-folder authorization. Native reselection restored access. A second move using a temporarily enlarged 2-GiB fixture visibly displayed the determinate progress bar at **904 MiB / 2 GiB** and completed successfully; the fixture was then shrunk back to its original size. This verifies the native import/move permission and progress paths, not release notarization or all supported macOS versions. Actual VoiceOver narration has not been verified.
