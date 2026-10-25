# Cross-platform startup splash (issue #12)

## Startup findings

The reported Windows 10 first launch (5–20 seconds of an empty window) has not
been reproduced on that machine. Source inspection identified several intervals
without useful feedback:

- `index.html` initially contained empty boot labels, populated only after the
  main JavaScript graph loaded.
- SQLite initialization and macOS folder-grant restoration ran synchronously in
  Tauri's setup hook.
- Bootstrap synchronously waited for hardware probes without a deadline
  (`nvidia-smi`, PowerShell/CIM, or `sysctl`).
- Windows runtime preparation also ran `cmd /C ver` and `icacls` before creating
  any WebView, without deadlines.
- The previous studio transition hid the waiting screen before loading its
  module and model picker; the initial library snapshot also ran in the background.

A frameless, non-resizable 480×440 splash now paints before data initialization
starts. Its static HTML contains the existing icon's SVG artwork, an
indeterminate progress bar, and the existing Alphatester logo. Only the six
waveform bars animate; the icon's background stays fixed. Reduced-motion mode
keeps both the waveform and progress segment static. Error states stop animation
and offer retry and quit. Retrying reloads the main frontend and reuses any
successfully initialized backend state.

The main window stays hidden until the wizard or studio (including the first
library snapshot, restored generation form values and model picker) is ready. Saved window visibility cannot
bypass this gate. Splash geometry is excluded from saved window state, and
second launches focus the splash while startup is pending. The macOS main
window retains its native traffic-light controls.

Hardware subprocesses have a three-second deadline; Windows version detection
has one second and each runtime ACL probe has two seconds. Timed-out children
are killed and reaped. Existing hardware fallback detection remains available.
The splash does not claim a percentage or predict remaining time.

## Timing and local acceptance

`desktop.log` records elapsed time since entering the desktop runtime, including
Windows runtime preparation. `Startup data initialization finished` includes
`splash_ms`, measured after the splash's first animation frames. Subsequent
`Startup phase` entries identify hardware, settings, interface and readiness.
OS launch/security checks before the process runs are outside these measurements.
A WebView-based splash cannot cover initialization of the WebView runtime itself.

On local Apple Silicon macOS, a fresh isolated debug profile reached the splash
paint handshake at **448 ms** and the finished wizard at **602 ms**. These are a
single local development observation, not Windows or release performance claims.

Native macOS acceptance used a debug-only data-directory override:

```sh
MUSIC_GENERATOR_DEV_DATA_DIR=/tmp/music-splash-native \
  src-tauri/target/debug/music-generator
```

An exclusive SQLite lock kept the real native splash visible, then produced an
actionable `database is locked` failure. Releasing the lock and selecting retry
opened the wizard successfully, with no native frame on the splash and native
macOS window controls on the main window. `loading.png` and `error.png` are
native captures of this controlled failure scenario; no mock backend was used
for those images. The default failure view uses a localized explanation and
retry/quit controls. Raw backend diagnostics are retained only in the collapsed,
localized technical-details disclosure.

Automated coverage checks delayed wizard/studio and saved-form readiness, initial library
failure, stale startup snapshots, retry presentation, language fallback, and
successful/failed/timed-out subprocesses. Splash and studio share one twelve-language
registry and locale resolver (saved language, then supported system language,
then English). Startup translations are checked against that registry and have
compile-time message-count validation; error-state presentation is tested for
every language. Regional language tags and blocked local storage are covered.
Existing frontend, Rust and packaging
regressions remain part of validation.

## Remaining release acceptance

Check first launch and subsequent launches of the built packages on Windows 10,
macOS Intel and Apple Silicon, and Linux. On the Windows machine from issue #12,
record `splash_ms`, readiness time, visible transitions and any slow subprocess.
Also check closing during startup, second-instance focus, saved window geometry,
and the OS reduced-motion setting. Build/CI smoke checks do not replace those
clean-machine GUI checks; issue #12 should stay open until Windows first-launch
acceptance is documented.
