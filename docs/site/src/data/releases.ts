export type Locale = "de" | "en";
export type LocalizedText = Record<Locale, string>;

export interface DownloadAsset {
  label: LocalizedText;
  filename: string;
  url: string;
  checksumUrl: string;
}

export interface PlatformDownload {
  id: "macos" | "windows" | "linux";
  name: string;
  requirements: LocalizedText;
  primary: DownloadAsset;
  alternatives: readonly DownloadAsset[];
  note?: LocalizedText;
}

const repositoryUrl = "https://github.com/rabbitfiremediacreation/music-generator-desktop";

// Verified against the published release assets, including each SHA-256 file.
export const desktopRelease = {
  version: "0.1.2",
  tag: "v0.1.2",
  prerelease: true,
  url: `${repositoryUrl}/releases/tag/v0.1.2`,
  checkedOn: "2026-10-27",
  requirementsSource: `${repositoryUrl}/blob/v0.1.2/docs/desktop.md#start`,
} as const;

function asset(suffix: string, label: LocalizedText): DownloadAsset {
  const filename = `Music-Generator-${desktopRelease.version}-${suffix}`;
  const url = `${repositoryUrl}/releases/download/${desktopRelease.tag}/${filename}`;
  return { label, filename, url, checksumUrl: `${url}.sha256` };
}

export const downloads: readonly PlatformDownload[] = [
  {
    id: "macos",
    name: "macOS",
    requirements: {
      de: "Apple Silicon · macOS 14 oder neuer",
      en: "Apple Silicon · macOS 14 or newer",
    },
    primary: asset("macos-arm64.dmg", {
      de: "Apple Silicon · DMG",
      en: "Apple Silicon · DMG",
    }),
    alternatives: [
      asset("macos-arm64.zip", { de: "Apple Silicon · ZIP", en: "Apple Silicon · ZIP" }),
      asset("macos-x64.dmg", { de: "Intel · DMG", en: "Intel · DMG" }),
      asset("macos-x64.zip", { de: "Intel · ZIP", en: "Intel · ZIP" }),
    ],
    note: {
      de: "Intel: ab macOS 13.3, mindestens 8 GiB RAM. Experimenteller CPU-Betrieb.",
      en: "Intel: macOS 13.3 or newer, at least 8 GiB RAM. Experimental CPU support.",
    },
  },
  {
    id: "windows",
    name: "Windows",
    requirements: {
      de: "Windows 10 / 11 · x64 · aktueller Grafiktreiber",
      en: "Windows 10 / 11 · x64 · current GPU driver",
    },
    primary: asset("windows-x64.zip", {
      de: "Windows x64 · ZIP",
      en: "Windows x64 · ZIP",
    }),
    alternatives: [],
    note: {
      de: "Portables Paket mit Engine und WebView2. Vollständig entpacken und zusammenlassen.",
      en: "Portable package with the engine and WebView2. Extract everything and keep the files together.",
    },
  },
  {
    id: "linux",
    name: "Linux",
    requirements: {
      de: "x64 · Ubuntu 22.04 oder kompatible neuere Distribution",
      en: "x64 · Ubuntu 22.04 or a compatible newer distribution",
    },
    primary: asset("linux-x64.AppImage", {
      de: "Linux x64 · AppImage",
      en: "Linux x64 · AppImage",
    }),
    alternatives: [],
    note: {
      de: "Vulkan / CPU mit aktuellem Grafiktreiber. Keine separate CUDA-Ausgabe in 0.1.2.",
      en: "Vulkan / CPU with a current GPU driver. No separate CUDA edition in 0.1.2.",
    },
  },
];
