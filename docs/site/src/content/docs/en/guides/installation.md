---
title: Installation
description: Install and set up Music Generator Desktop on macOS, Windows or Linux.
sidebar:
  order: 1
---

Updated **8 November 2026**. This guide covers **Music Generator 0.2.0**. The [release page](https://github.com/rabbitfiremediacreation/music-generator-desktop/releases/tag/v0.2.0) lists packages after their platform builds finish. [What is new in v0.2.0?](../release-0-2-0/)

## Download the right package

Open the [0.2.0 release page](https://github.com/rabbitfiremediacreation/music-generator-desktop/releases/tag/v0.2.0) and download the appropriate package under **Assets**. Each package has a matching `.sha256` file for integrity checks.

| Computer | Package for 0.2.0 | Requirements |
| --- | --- | --- |
| Apple Silicon Mac (M1 or newer) | `Music-Generator-0.2.0-macos-arm64.dmg` or `.zip` | macOS 14 or newer |
| Intel Mac (experimental) | `Music-Generator-0.2.0-macos-x64.dmg` or `.zip` | macOS 13.3 or newer, at least 8 GiB RAM; CPU only |
| Windows PC | `Music-Generator-0.2.0-windows-x64.msi` or `.zip` | Windows 10/11 x64, current GPU driver |
| Linux PC, Vulkan/CPU | `Music-Generator-0.2.0-linux-x64.AppImage` | x64, Ubuntu 22.04 or a compatible newer distribution, current GPU driver |
| Linux PC, NVIDIA CUDA/CPU | `Music-Generator-0.2.0-linux-x64-cuda.AppImage` | Same Linux baseline; supported NVIDIA GPU and driver 570.124.06+ for CUDA |

Platform requirements come from the [v0.2.0 desktop guide](https://github.com/rabbitfiremediacreation/music-generator-desktop/blob/v0.2.0/docs/desktop.md#start). Intel support is experimental; complete testing on every minimum OS version is still pending. These test packages do not yet have regular signing or notarization.

You do not need Python, Node.js, Git or a compiler to use the app. Initial setup requires internet access and several GB of free storage for models. The exact amount depends on the selected model profile.

## macOS

1. Open the downloaded DMG file.
2. Drag **Music Generator** to **Applications**, or copy the app into another writable folder.
3. Eject the disk image, then launch the copied app from its destination folder.

For the ZIP package, extract the complete app and launch that copy. Use the copied app outside the disk image for your installation.

Gatekeeper may block these test packages. The [test report in issue #6](https://github.com/rabbitfiremediacreation/music-generator-desktop/issues/6) documents the route through **System Settings → Privacy & Security → Open Anyway** (reported with German UI labels). First check that the package came from the repository linked above.

Intel Macs run both the language model and synthesis on the CPU. Start with **Standard**, the **0.6B language model** and a **10-second song**; even this can take several minutes on older CPUs.

## Windows

With the **MSI installer**: open the file, complete installation with administrator permission and launch Music Generator from the Start menu. Later MSI versions upgrade the app; uninstall it through Windows Settings → Apps. Models and the library stay in their user-data folders.

For the **portable ZIP**:

1. Extract the **entire ZIP** onto a local writable drive.
2. Keep the EXE and the `engine` and `WebView2` directories together in the extracted folder.
3. Open **Music Generator** from that folder.

WebView2 is included. SmartScreen may warn about the unsigned test packages. The [test report in issue #6](https://github.com/rabbitfiremediacreation/music-generator-desktop/issues/6) records **More info → Run anyway** (reported with German UI labels). Check the download's origin first.

## Linux

The regular AppImage uses Vulkan or CPU. Supported NVIDIA GPUs can also use `Music-Generator-0.2.0-linux-x64-cuda.AppImage` with CUDA/CPU. CUDA requires NVIDIA driver **570.124.06** or newer. CI checks CPU startup and dependencies without an NVIDIA GPU; real CUDA generation needs testing on your hardware.

Make the downloaded file executable and launch it. For the 0.2.0 Vulkan/CPU edition:

```sh
chmod +x Music-Generator-0.2.0-linux-x64.AppImage
./Music-Generator-0.2.0-linux-x64.AppImage
```

If FUSE is unavailable:

```sh
./Music-Generator-0.2.0-linux-x64.AppImage --appimage-extract
./squashfs-root/AppRun
```

The [test report in issue #6](https://github.com/rabbitfiremediacreation/music-generator-desktop/issues/6) did not include Linux acceptance testing; package checks do not replace real generation on your hardware.

## First setup

1. **Welcome:** choose the app language and optionally import an old library. Import requires an empty target library and preserves the source data.
2. **Models and storage:** review hardware recommendations, model and song folders, and a recommended Standard/XL profile. Changing the song folder moves existing songs to the new location. XL needs additional storage.
3. **Setup:** complete downloads, checksums and the hardware test, then choose **Go to studio**. Downloads can be cancelled and resumed.

After successful setup, later launches open the studio directly. Generation and playback run locally; the engine starts when needed. Find additional models under **Settings → Models and hardware → Add model**. Use **Hardware test in setup wizard…** on that page to repeat the complete assistant; completing it activates a recommended Standard or XL profile.

Optionally enable **Phone access** and **MCP & integrations** in settings. For the web app/PWA, check and trust the local certificate first. [Setup and notes for v0.2.0](../release-0-2-0/).

## Back up data and update

The library, models and songs are stored outside the program bundle. Close the app and back up its data directory and any separately selected song folders before replacing the complete bundle.

| System | Default data directory |
| --- | --- |
| macOS | `~/Library/Containers/de.alphatester.music-generator/Data/Library/Application Support/de.alphatester.music-generator/` |
| Windows | `%LOCALAPPDATA%\de.alphatester.music-generator\` |
| Linux | `$XDG_DATA_HOME/de.alphatester.music-generator/`, normally `~/.local/share/de.alphatester.music-generator/` |

The database is named `music.db`; models and songs can be stored in separately selected folders. See [data and updates for v0.2.0](https://github.com/rabbitfiremediacreation/music-generator-desktop/blob/v0.2.0/docs/desktop.md#data-and-updates) for details.
