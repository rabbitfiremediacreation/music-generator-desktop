---
title: Installation
description: Install and set up Music Generator Desktop on macOS, Windows or Linux.
sidebar:
  order: 1
---

Checked on **27 October 2026**. This guide covers the available desktop **pre-release 0.1.2**. Download names and platforms have been checked against the [v0.1.2 release assets](https://github.com/rabbitfiremediacreation/music-generator-desktop/releases/tag/v0.1.2). Source code on `main` may already include further changes.

## Download the right package

Open the [0.1.2 release page](https://github.com/rabbitfiremediacreation/music-generator-desktop/releases/tag/v0.1.2) and download the appropriate package under **Assets**. Each package has a matching `.sha256` file for integrity checks.

| Computer | Package for 0.1.2 | Requirements |
| --- | --- | --- |
| Apple Silicon Mac (M1 or newer) | `Music-Generator-0.1.2-macos-arm64.dmg` or `.zip` | macOS 14 or newer |
| Intel Mac (experimental) | `Music-Generator-0.1.2-macos-x64.dmg` or `.zip` | macOS 13.3 or newer, at least 8 GiB RAM; CPU only |
| Windows PC | `Music-Generator-0.1.2-windows-x64.zip` | Windows 10/11 x64, current GPU driver |
| Linux PC, Vulkan/CPU | `Music-Generator-0.1.2-linux-x64.AppImage` | x64, Ubuntu 22.04 or a compatible newer distribution, current GPU driver |

Platform requirements come from the [v0.1.2 desktop guide](https://github.com/rabbitfiremediacreation/music-generator-desktop/blob/v0.1.2/docs/desktop.md#start). Intel support is experimental; complete testing on every minimum OS version is still pending. These test packages do not yet have regular signing or notarization.

You do not need Python, Node.js, Git or a compiler to use the app. Initial setup requires internet access and several GB of free storage for models. The exact amount depends on the selected model profile.

## macOS

1. Open the downloaded DMG file.
2. Drag **Music Generator** to **Applications**, or copy the app into another writable folder.
3. Eject the disk image, then launch the copied app from its destination folder.

For the ZIP package, extract the complete app and launch that copy. Use the copied app outside the disk image for your installation.

Gatekeeper may block these test packages. The [test report in issue #6](https://github.com/rabbitfiremediacreation/music-generator-desktop/issues/6) documents the route through **System Settings → Privacy & Security → Open Anyway** (reported with German UI labels). First check that the package came from the repository linked above.

Intel Macs run both the language model and synthesis on the CPU. Start with **Standard**, the **0.6B language model** and a **10-second song**; even this can take several minutes on older CPUs.

## Windows

1. Extract the **entire ZIP** onto a local writable drive.
2. Keep the EXE and the `engine` and `WebView2` directories together in the extracted folder.
3. Open **Music Generator** from that folder.

WebView2 is included. SmartScreen may warn about the unsigned test packages. The [test report in issue #6](https://github.com/rabbitfiremediacreation/music-generator-desktop/issues/6) records **More info → Run anyway** (reported with German UI labels). Check the download's origin first.

## Linux

The 0.1.2 AppImage uses Vulkan or CPU. This pre-release does not include a separate CUDA edition, as confirmed by the [0.1.2 release notes](https://github.com/rabbitfiremediacreation/music-generator-desktop/releases/tag/v0.1.2).

Make the downloaded file executable and launch it. For the 0.1.2 Vulkan/CPU edition:

```sh
chmod +x Music-Generator-0.1.2-linux-x64.AppImage
./Music-Generator-0.1.2-linux-x64.AppImage
```

If FUSE is unavailable:

```sh
./Music-Generator-0.1.2-linux-x64.AppImage --appimage-extract
./squashfs-root/AppRun
```

The [test report in issue #6](https://github.com/rabbitfiremediacreation/music-generator-desktop/issues/6) did not include Linux acceptance testing; package checks do not replace real generation on your hardware.

## First setup

1. Choose the app language.
2. Optionally import an old Music Generator library. The destination library must be empty; source data is preserved.
3. Review the hardware recommendation and choose model and song folders.
4. Choose a recommended model profile. XL is optional and needs additional storage.
5. Complete model downloads, checksum verification and the hardware test. Downloads can be cancelled and resumed.

After setup succeeds, later launches open the studio directly. Music generation and playback run locally; the engine starts when needed. Reopen the full assistant through **Settings → Reopen setup wizard…**. Source: [first-run assistant in the v0.1.2 desktop guide](https://github.com/rabbitfiremediacreation/music-generator-desktop/blob/v0.1.2/docs/desktop.md#first-run-assistant).

## Back up data and update

The library, models and songs are stored outside the program bundle. Close the app and back up its data directory and any separately selected song folders before replacing the complete bundle.

| System | Default data directory |
| --- | --- |
| macOS | `~/Library/Containers/de.alphatester.music-generator/Data/Library/Application Support/de.alphatester.music-generator/` |
| Windows | `%LOCALAPPDATA%\de.alphatester.music-generator\` |
| Linux | `$XDG_DATA_HOME/de.alphatester.music-generator/`, normally `~/.local/share/de.alphatester.music-generator/` |

The database is named `music.db`; models and songs can be stored in separately selected folders. See [data and updates for v0.1.2](https://github.com/rabbitfiremediacreation/music-generator-desktop/blob/v0.1.2/docs/desktop.md#data-and-updates) for details.
