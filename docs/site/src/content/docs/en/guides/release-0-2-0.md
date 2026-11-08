---
title: New in version 0.2.0
description: Changes since 0.1.3, installation and known limitations of Music Generator 0.2.0.
sidebar:
  order: 2
---

**8 November 2026** · [Release and downloads](https://github.com/rabbitfiremediacreation/music-generator-desktop/releases/tag/v0.2.0) · [Installation guide](../installation/)

## Studio and settings

The desktop interface now uses React and TypeScript. All twelve interface languages, local generation, library, queue and native exports remain available.

Settings has separate pages for **Generation**, **Models and hardware**, **Library & export**, **Appearance**, **Phone access**, **MCP & integrations** and **About the app**. **Models and hardware** lists installed models, their status and disk usage. **Add model** opens the catalog for downloads and verification. Enable and apply **Expert Mode** for advanced choices. Model changes and downloads apply immediately; other unsaved settings are preserved.

The three-step setup assistant covers language and optional import, models and storage, then downloads and hardware testing. Before changing the song folder, a hint explains that existing songs will be moved. For a later hardware test, open **Settings → Models and hardware → Hardware test in setup wizard…**.

## Phone access and AI clients

**Phone access** connects the native iPhone app or mobile web app/PWA to the studio on your local network. QR codes transfer the address and access key. Browse and play the library, download songs, manage favorites and folders, generate music and analyze recorded ideas.

For the web app, check the displayed certificate fingerprint, install and trust the local certificate, then open HTTPS. An iPhone configuration profile helps install the certificate; you approve trust yourself in system settings. Install the PWA through the browser. Keep the computer awake and the desktop app open. Access is off by default; switching it off also stops active phone transfers. [Full setup and API](https://github.com/rabbitfiremediacreation/music-generator-desktop/blob/v0.2.0/docs/phone-access.md).

**MCP & integrations** offers an independent service switch, access key and copyable client configuration. AI clients can control generation, variations, library, queue, models, settings, analysis, import and export. [MCP setup and tools](https://github.com/rabbitfiremediacreation/music-generator-desktop/blob/v0.2.0/docs/mcp.md).

## Other improvements

- VAR defaults to **0.85**, including resets and MCP. When the model invents lyrics, variance is capped at 0.85 for that run. The text field names the requested vocal language.
- The Windows engine and CPU probe support Unicode installation, model and audio paths.
- CUDA setup accounts for download and extraction space on the relevant drives.
- Playback loads audio by song ID and can recover from media errors.
- The shared title model is no longer reported as a missing music model during registry checks.
- React and CSS support Fast Refresh during development; reloading the frontend reuses completed native startup state.

## Installation and limitations

The release pipeline produces DMG and ZIP for Apple Silicon and Intel, MSI and ZIP for Windows, and Linux AppImages for Vulkan/CPU and separately CUDA/CPU. Each package has a SHA-256 file. Files appear on the release page after successful builds.

Before updating, close the app and back up library data and separately selected song folders. Models, songs and settings live outside the program package. [Installation and data folders](../installation/).

Packages remain test builds without regular macOS Developer ID signing and notarization. Intel support is experimental and CPU-only. Package checks do not establish real NVIDIA generation or complete hardware acceptance on every minimum OS version. The black Windows main window in [issue #53](https://github.com/rabbitfiremediacreation/music-generator-desktop/issues/53) still needs separate verification. On CPU, start with Standard, the 0.6B language model and ten seconds of music.
