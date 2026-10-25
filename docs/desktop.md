# Music Generator Desktop

## Start

Download the bundle for your platform from [Releases](https://github.com/rabbitfiremediacreation/music-generator-desktop/releases):

| Platform | Bundle | Requirements |
| --- | --- | --- |
| macOS | `Music-Generator-VERSION-macos-arm64.dmg` or `.zip` | Apple Silicon, macOS 14+ |
| macOS Intel (experimental) | `Music-Generator-VERSION-macos-x64.dmg` or `.zip` | Intel x64, macOS 13.3+, at least 8 GiB RAM; CPU only |
| Windows | `Music-Generator-VERSION-windows-x64.zip` | Windows 10/11 x64, current GPU driver |
| Linux Vulkan/CPU | `Music-Generator-VERSION-linux-x64.AppImage` | x64; Ubuntu 22.04 or compatible newer distribution, current GPU driver |
| Linux NVIDIA CUDA/CPU | `Music-Generator-VERSION-linux-x64-cuda.AppImage` | x64; same Linux baseline, supported NVIDIA GPU and driver 570.124.06+ for CUDA |

Extract the complete ZIP and open Music Generator. Keep the Windows EXE, `engine` and `WebView2` directories together. On Linux run `chmod +x Music-Generator-*.AppImage` once and open the AppImage. If FUSE is unavailable, run `./Music-Generator-VERSION-linux-x64.AppImage --appimage-extract`, then `./squashfs-root/AppRun`.

On macOS you can instead open the DMG and drag Music Generator onto its Applications shortcut (or copy it into another folder). Eject the disk image and open the copied app. The DMG contains the same sealed `.app` as the ZIP and does not run an installer. Both downloads include a SHA-256 file. CI verifies the read-only disk image, copies its app into a relocated folder, ejects the image and tests the copied app's signature, engine files, engine startup and shutdown.

macOS uses its native red/yellow/green window controls on the left. Windows and Linux use the custom minimize/maximize/close controls on the right. The title bar is draggable, and the layout fills the window at every supported size.

Apple Silicon builds target macOS 14.0 (Sonoma), including the Rust app, supervisor, ACE-Step engine and title helper. Metal acceleration remains enabled. The CI runner is macOS 15; its OS/SDK version is separate from the deployment target. Bundle verification rejects any Mach-O binary whose minimum OS exceeds the target and checks the app's `LSMinimumSystemVersion`. Engine recipe hashes include the target policy so cached binaries built for macOS 26 are rebuilt. A successful build on newer macOS does not replace GUI/audio and real generation acceptance on macOS 14 and 15. Existing release downloads must be rebuilt before they gain this compatibility.

The pinned ACE-Step source needs one compatibility patch with current Xcode: floating-point `std::from_chars` is available only on macOS 26+, even when the newer libc++ headers declare it. The macOS preparation step applies `scripts/desktop/patches/acestep-macos-compat.patch` to select the engine's existing locale-independent parser for older deployment targets. Patch changes invalidate the engine cache; an upstream source mismatch fails the build rather than silently omitting the fix.

Intel Macs use a separate native x64 bundle; no Rosetta, Python, Node.js or local compilation is needed. Both language-model inference and synthesis run on the CPU, even when an old profile requests a separate CPU language model. One engine process handles both tasks to avoid duplicating model memory. The Intel engine excludes Metal and includes runtime-selected portable CPU variants rather than instructions tied to the build host. macOS 13.3 is the deployment target (including Accelerate's newer LAPACK API); native CI runs on macOS 15. Actual generation, GUI/audio and minimum-OS acceptance remain manual checks: this is experimental support, not a claim of tests on every Intel Mac or on macOS 13.3.

Expect many minutes per song on older Intel CPUs. Start with a ten-second song, the 0.6B language model and standard sound model; XL remains optional and needs more memory/time. Setup verifies model checksums and engine startup/health, skips the inapplicable GPU benchmark and saves completion normally. It does not claim to have generated a song during setup. CPU performance guidance appears in the assistant and settings in all twelve languages.

These first builds are unsigned test builds. macOS Gatekeeper and Windows SmartScreen can display warnings. There is no installer or requirement to install Python, Node.js, Git, compilers or package managers. GPU drivers are supplied by the operating system/vendor, not by this app. Windows ships WebView2 app-locally. On Windows 10 the app applies Microsoft's required read/execute permissions to that runtime directory; application data is not included in this permission change. Extract onto a local writable drive, not a network share.

## Automatic song titles

Leave the title empty to name the finished song with a shared local Qwen3-0.6B Q8 text model. Actual generated lyrics take priority over the music prompt, including their language; instrumental songs use the prompt. Manual titles, later renames and saved generation parameters remain unchanged. Audio analysis no longer inserts a random title. The title dice still explicitly chooses a random title.

The assistant downloads the approximately 640 MB title model alongside the chosen music models. Existing installations keep their saved fast startup: download/verify the title model separately in the ModelPicker, or let the first blank-title job fetch it. Download failures occur before music generation and can be retried; cancellation and partial downloads use the same checksum-verified resume path as music weights. Once downloaded, naming works offline. A manual title needs neither the title model nor its download. Downloading it does not change the active provider or sampling settings.

After music generation the app releases resident music weights, then runs a bounded CPU-only native `music-title` subprocess. It uses the same macOS sandbox inheritance and owned-process shutdown mechanism as the music engines. It has no network client or Python/Node dependency. If title inference fails, the song is still saved with a visible warning and can be renamed manually. Existing completed songs are never renamed or backfilled. The immutable model URL, revision and SHA-256, plus the pinned llama.cpp source archive hash, are recorded in `models/title-model.json`.

## First-run assistant

1. Choose the interface language. The app keeps all twelve existing languages.
2. Optionally select an old Music Generator project directory to copy its library and songs. Import requires an empty library. The source database is opened read-only and backed up through SQLite, including committed WAL data; original songs are preserved. There is no library merge.
3. Review RAM/GPU information, language model recommendation and folders. A different model directory can be chosen, including an old installation's model folder. Existing model files must pass SHA-256 verification. A damaged existing final model is preserved: remove that damaged file manually or select a fresh folder, then retry.
4. Choose 0.6B, 1.7B or 4B. XL is optional and downloads in addition to the standard sound model. Download and free-space figures are estimates; the downloader checks actual response size and disk space again before writing.
5. Download and run the hardware test. Downloads can be cancelled and resumed. The app does not activate incomplete or unverified files. If the accelerated language model fails its audio-code test, a separate CPU language-model process is tested and used.

The first setup needs several GB and internet access. Model URLs, immutable revisions and SHA-256 checksums are in `models/manifest.json`. Generation, recording, analysis and playback are local after setup. Update checks only contact GitHub when requested.

The assistant saves its completion status in SQLite only after downloads, integrity checks, the hardware test and folder access have succeeded. Later launches use that saved result and open the studio directly, without a model scan or waiting for the engine. Existing completed installations use this behavior without repeating setup. The engine starts when generation or analysis needs it; pending jobs also resume in the background. Models are checked at that point, using their saved checksum results where possible. Missing or invalid models report an error directing you to model management; the library remains accessible. Repeat setup and hardware testing explicitly through Settings → Models and hardware test.

When repeating setup with a different song folder, the app keeps the existing folder and settings until the hardware test succeeds and the new folder is authorized for playback. Cancelling or failing that validation leaves the existing library playable.

Settings → Language model runs on offers Automatic and CPU only. The choice is saved in SQLite and survives setup, restarts and bundle replacement. CPU only keeps synthesis on the accelerated engine and starts a separate CPU language-model process; Automatic still respects a CPU fallback detected by the hardware test. Changes take effect at the next generation/analysis without an app restart. Newer engines receive `--device CPU` when supported; older engines retain `GGML_BACKEND=CPU`. Engine readiness allows up to two minutes, with cancellation and process supervision intact.

Settings → Export selects lossless WAV or MP3 at 192 kbit/s for both individual songs and ZIPs. Playback and the library keep their original audio. MP3 uses the bundled `mp3-codec` through the same owned-process supervisor. The parent copies source audio into temporary container storage before conversion; no external folder grants are needed by the converter. Converted copies are cached by source size/modification time and deleted with their song. Incomplete conversions never replace originals or existing export destinations. If conversion fails, choose WAV and inspect `logs/export.log`. The native save dialog uses the selected extension. All twelve languages include the upstream labels and conversion errors, with desktop-specific device-change instructions.

On macOS, ZIP exports use Foundation's temporary item replacement directory so the save dialog's grant to the chosen file is sufficient. An existing ZIP is replaced only after the new archive is complete; no permission to create sibling files in the destination folder is required.

ACE-Step shows **IT** for synthesis iterations and **VAR** for language-model variance/temperature. New forms start at 80 and 1.2; saved songs retain their previous values. More iterations take longer; higher variance gives freer output, lower variance follows the style and prompt more closely. Use the explicit ModelPicker recommendation for other families, such as Turbo.

## Data and updates

Songs can be 10 seconds to 10 minutes long. Above five minutes the form shows a localized time/memory warning. The language model may occasionally return extra audio codes; the outgoing synthesis payload is capped at the requested duration × 5 and at 3000 codes (600 seconds). This does not rewrite saved song parameters. Synthesis failures inspect only new lines in the combined stdout/stderr engine log; memory exhaustion and the model's maximum-length error get specific explanations. Earlier jobs' memory errors are ignored. Ten-minute generation remains untested on Intel Macs and 8 GiB machines; start with a short song on those systems.

Since 0.2.7, new generations normalize to the actual audio peak instead of the engine's percentile clipping. Rust sends `peak_clip: 0` to both generation stages and reapplies it after LM enrichment. Existing library audio and stored parameters are retained. This addresses that normalization step; it is not a claim that every possible audible distortion has been eliminated.

- macOS: `~/Library/Containers/de.alphatester.music-generator/Data/Library/Application Support/de.alphatester.music-generator/`
- Windows: `%LOCALAPPDATA%\de.alphatester.music-generator\`
- Linux: `$XDG_DATA_HOME/de.alphatester.music-generator/` (normally `~/.local/share/…`)

The database is `music.db`. Models and songs default to subdirectories there; their locations are selectable. Logs are in `logs/desktop.log`, `logs/ace-server.log`, and, in split mode, `logs/ace-lm.log`.

Packaged macOS builds enable Apple's App Sandbox. Network client/server entitlements permit model downloads, update checks and the internal loopback engine connection; microphone and user-selected file access are enabled separately. There are no blanket home-directory or temporary-exception grants. Pick external model/song folders through Browse so macOS can authorize them. Security-scoped bookmarks restore those grants after restarting. The engine receives a transferable bookmark for its model folder and runs under the inherited sandbox through a dedicated supervisor. Both child executables carry only the sandbox and inheritance entitlements.

The current ad-hoc test signatures have no stable Developer ID identity. Replacing the app with a different test build can require selecting external folders again; model and song files remain intact. Folder grants survive restarting the same build, which has been tested. Stable signing and notarization remain a separate release step.

To import an existing library, use **Import existing library** in an empty installation and select the directory containing `music.db` through the native folder dialog.

Import copies SQLite/WAL data and songs, keeping original song parameters and source files. It does not merge populated libraries or change the previous installation. Existing models can be reused after checksum verification; authorize external model/song folders again through the native Browse dialog when required. The new app cannot silently inherit another identifier's sandbox permissions. Legacy browser-project imports still use the same button.

The studio and Settings include a [ModelPicker](model-picker.md) for 52 ACE-Step synthesis weights and eight language weights, with a RAM-budget filter and verified resumable downloads. New jobs retain a model snapshot; existing songs keep their saved values.

The app does not write into the program bundle. Replace the complete app/bundle for updates; models and library remain available. Setup → Version checks releases in this fork and opens the platform's new bundle. The app does not perform Git pulls or replace its own running files. Setup → Models and hardware test can download another model or repeat the test. Changing the song folder copies files first and switches the saved path only after successful copying; queued/running songs must finish or be cancelled before moving.

Closing while work is pending asks for confirmation. Running jobs and pending jobs are resumed on the next start. Cancelling a song explicitly leaves it cancelled until Retry. A control-pipe supervisor terminates the owned engine when the GUI exits, including an unexpected GUI crash. Other programs/processes are never stopped based on a port number.

If an engine job exceeds its time limit, the app cancels that job and reports the phase and elapsed minutes. For long songs, raise Timeout in Settings (gear); the existing default remains 30 minutes per engine operation. The song-list summary gives this guidance in all twelve languages, including for older stored German/English timeout messages. Retry retains the song's saved generation parameters; updating the app does not change them or overwrite your timeout setting.

Since 0.2.6, the creation-time display measures each attempt from queue claim to completion, excluding waiting behind earlier variants. An additive nullable `started_at` column stores the start; old completed songs retain their previous display using the existing creation timestamp. Retry and restart recovery record a fresh start when the job is claimed. Existing generation parameters and timestamps are preserved during migration. Import supports both schema versions without changing the original library.

## Rust architecture

`AppState` composes the database, runtime and engine manager. `runtime.rs` owns operation admission, cancellation, configured readiness and job progress behind private fields. Its owned operation permit clears transient state on return, error or task cancellation. Configuration blocks new queue entries; generation still allows more songs to be queued. Stopping an engine does not clear completed setup. `engine/manager.rs` owns resident processes and timing updates; health checks clone the client before awaiting network responses. `jobs.rs` owns the generation worker.

`configuration.rs` provides the shared setup/settings commit path. Commands supply native folder authorization and publish UI events; setup supplies downloaded and hardware-tested settings, while normal edits use a typed `SettingsPatch`. Both validate and authorize before copying songs, then save the complete settings in one SQLite transaction. `configuration/library_move.rs` owns copying and rollback, while the database supplies queries and persistence. Copy or commit failures remove only this attempt's new copies and preserve originals. Originals are removed only after the settings commit. This handles reported errors; it is not a crash-atomic transaction across SQLite and the filesystem.

Blocking configuration work owns its operation permit until completion, even if the awaiting task is aborted. Tests exercise this with a blocked SQLite writer, plus authorization failure, SQL rollback, task cancellation, scoped cancellation and stable readiness. No schema migration or frontend command-name changes are required.

## Build

Development needs Node.js 24+, stable Rust, and Tauri's native build prerequisites. End users do not need these tools.

```sh
npm ci
npm run engine:prepare
npm run dev
```

The development app embeds built frontend assets, so it works without a development webserver. Restart `npm run dev` after changing frontend sources. For production bundles:

```sh
npm run lint
npm run build
npm test
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run bundle
```

`release/` contains the platform bundle and its SHA-256 file. `npm run bundle` verifies/prepares the engine first. The Rust release build also refuses missing, mismatched or modified engine resources, including the required MP3 codec and native title runtime. `npm run build` builds only the frontend.

The desktop app icons use the waveform and colors from `static/favicon.svg`, matching the studio header: beige bars (`#ddc8aa`) on an anthracite gradient (`#434445` to `#2b2c2c`). Generate them with `npm run tauri -- icon static/favicon.svg --output PATH`, then copy the five configured PNG/ICNS/ICO files into `src-tauri/icons/`.

The preparation script builds the pinned Mac/Linux engine source revisions and checks the pinned Windows archive hash. The Mac revision adds the small `engine-sandbox.mm` bookmark bridge; its patch and build-recipe hashes are recorded alongside runtime-file hashes. Mac CPU code targets portable Apple Silicon or Intel variants and uses relative library paths. The app, supervisor and engine are signed from the inside out with separate parent/child entitlements. Linux builds Vulkan and CPU variants; the CI image installs build dependencies, users do not. Windows includes app-local Visual C++ runtime DLLs from the build tools' redistributable directory and a Fixed Version WebView2 runtime pinned in `models/webview2.json`. Updating that manifest requires downloading the official Microsoft CAB and verifying its checksum. Ship a new bundle to update the fixed browser runtime.

The `Desktop bundles` GitHub Actions workflow builds only macOS ARM on pushes to `main` or `codex/desktop-bundles` and on manual dispatch. Publishing a GitHub Release, including a pre-release, triggers the full native matrix: macOS ARM/Intel, Windows, Linux Vulkan/CPU and Linux CUDA/CPU. Pushing a tag alone does not start the full matrix. Each platform stores its tested CI artifacts, then automatically attaches its packages and SHA-256 files to the triggering release after all its bundle checks pass, including the macOS DMG check. Downloads appear as individual platforms finish, so a release can temporarily be incomplete while builds are running or if a job fails. Pushes and manual builds only store CI artifacts. Linux uses a checksummed Vulkan SDK 1.4.309.0 for its shader compiler, since Ubuntu 22.04 does not provide `glslc` in its standard package archive.

Compiled native runtimes and WebView2 use target-specific Actions caches keyed by engine/toolchain pins and native build recipes, independently of the application version and frontend/package-test changes. A second cache stores verified runtime tar archives as workflow artifacts for 90 days. This lets a new release tag reuse a successful earlier release's runtime despite GitHub's branch/tag cache isolation. Restores accept only successful runs of this repository's desktop workflow and verify the archive checksum, engine inventory/provenance and title runtime before copying it into the build. A missing, expired or incompatible cache falls back to a normal build. Vulkan and CUDA remain separate. CUDA compiler components and Rust/npm dependencies also retain their own caches; a verified runtime hit skips the CUDA Toolkit restore/preparation entirely. The first build after a native recipe/pin change still compiles the engine.

After packaging, `node scripts/desktop/verify-bundle.mjs` checks the artifact checksum, extracts it into a different directory containing spaces, verifies all engine resource hashes and starts the packaged supervisor/engine in CPU mode. A tiny tensor-free GGUF fixture permits an HTTP health check without model downloads or inference. The test also checks shutdown when the supervisor control pipe closes, plus the Windows runtime files. macOS additionally checks signing entitlements and actual OS denial of unselected file reads/writes by the main app and a read by the inherited engine. It repeats those checks after copying the app from a read-only DMG and ejecting it (`--dmg`). These checks do not generate music.

Release uploads require a `vVERSION` tag matching the versions in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`. The uploader validates the exact platform file set and checksums before uploading. Identical existing assets are skipped; conflicting contents fail the job without replacing any files. A retry fills only missing assets. Upload failures fail the platform job while its CI artifacts remain available for recovery. To recover an older release without rebuilding, download its verified platform artifact from the successful release run, confirm its source commit matches the tag, and run `node scripts/desktop/publish-release.mjs --repository rabbitfiremediacreation/music-generator-desktop --tag vVERSION --target PLATFORM --directory ARTIFACT_DIRECTORY` with GitHub CLI authenticated and matching application versions checked out. `PLATFORM` is `macos-arm64`, `macos-x64`, `windows-x64`, `linux-x64` or `linux-x64-cuda`. Each directory must contain only that platform's packages and SHA-256 files.

Both the latest-release API request and the allowed asset-download URL prefix use [rabbitfiremediacreation/music-generator-desktop](https://github.com/rabbitfiremediacreation/music-generator-desktop) for in-app update discovery.

For signed macOS releases configure the standard Tauri secrets `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`. Keep certificates and passwords out of source control. Windows signing can be added to the portable packaging step once a certificate is available; current Windows builds are unsigned.

## Linux build variants

The default Vulkan/CPU AppImage retains its filename and backend. The separate CUDA/CPU AppImage uses ACE-Step's CUDA backend and bundles only the pinned CUDA Runtime and cuBLAS/cuBLASLt libraries. End users need a compatible NVIDIA driver, not a CUDA Toolkit. This build targets SM 61, 75, 80, 86, 89, 90 and 120a; driver 570.124.06 or newer is the supported baseline for CUDA Toolkit 12.8.1 ([NVIDIA release notes](https://docs.nvidia.com/cuda/archive/12.8.1/cuda-toolkit-release-notes/index.html)). Choose the Vulkan/CPU image for other GPUs. CPU execution remains available in both variants.

Build and verify natively on Linux x64:

```sh
MUSIC_GENERATOR_LINUX_BACKEND=vulkan npm run bundle
MUSIC_GENERATOR_LINUX_BACKEND=vulkan node scripts/desktop/verify-bundle.mjs
MUSIC_GENERATOR_LINUX_BACKEND=cuda npm run bundle
MUSIC_GENERATOR_LINUX_BACKEND=cuda node scripts/desktop/verify-bundle.mjs
```

The CUDA compiler is installed only in `.cache/desktop/cuda/` from official component archives with pinned SHA-256 checksums. No NVIDIA driver is installed. Build targets, runtime provenance and CI cache keys separate the variants; switching the environment variable rebuilds incompatible resources. The app embeds its build variant so update checks keep the installed backend.

Both CI jobs run on Ubuntu 22.04 without an NVIDIA GPU. Before packing and again after relocated extraction, package checks reject missing ELF dependencies, absolute build-machine search paths, CUDA libraries resolved outside the package and bundled NVIDIA driver/stub files. They also check variant-specific backend libraries and run the CPU supervisor/engine health and MP3/title-helper tests without a system CUDA Toolkit in the loader path. CUDA virtual-memory management is disabled to avoid a startup link dependency on `libcuda.so.1`; CUDA Runtime loads the installed driver when using a GPU. Real CUDA generation, GPU memory limits and the supported SM targets still require acceptance on NVIDIA hardware; a successful CPU CI run does not certify GPU inference.

HeartMuLa has been removed from the application, model catalog, setup, runtime packages and build pipeline. Existing audio and downloaded model files are not deleted. A saved retired-provider selection restores an ACE-Step profile in memory and returns to the setup assistant; it does not rewrite old song parameters.

## Release acceptance

Automated tests cover serial queue behavior, stable seeds/variants, cancellation against late results, retry/restart, folders/favorites, lookup beyond 500 visible rows, imports with WAL and import rollback, path validation, HTTP-Range continuation/restart, checksum rejection, disk-space rejection, engine JSON/multipart results, timeout/cancellation and supervisor shutdown.

Before calling a platform release supported, test the actual bundle on a clean system without development tools: setup, at least one real generated song, file analysis, microphone permission/recording, waveform playback, WAV/TXT/ZIP exports, keyboard and screenreader operation, close during a job, reopen, offline operation and moving/replacing the program bundle. Linux needs additional current Ubuntu and Arch smoke tests. Windows needs a test with no preinstalled WebView2/VC++ runtime. CI compilation alone is not equivalent to these checks.
