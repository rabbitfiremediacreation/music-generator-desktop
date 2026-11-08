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
  version: "0.2.0",
  tag: "v0.2.0",
  prerelease: false,
  url: `${repositoryUrl}/releases/tag/v0.2.0`,
  checkedOn: "2026-11-08",
  requirementsSource: `${repositoryUrl}/blob/v0.2.0/docs/desktop.md#start`,
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
    alternatives: [
      asset("windows-x64.msi", { de: "Windows x64 · MSI-Installer", en: "Windows x64 · MSI installer" }),
    ],
    note: {
      de: "ZIP: vollständig entpacken, Engine und WebView2 zusammenlassen. Alternativ mit dem MSI installieren und über das Startmenü öffnen.",
      en: "ZIP: extract everything and keep the engine and WebView2 together. Alternatively, install the MSI and open the app from the Start menu.",
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
    alternatives: [
      asset("linux-x64-cuda.AppImage", { de: "NVIDIA CUDA / CPU · AppImage", en: "NVIDIA CUDA / CPU · AppImage" }),
    ],
    note: {
      de: "Vulkan / CPU mit aktuellem Grafiktreiber. Separate CUDA-Ausgabe für unterstützte NVIDIA-GPUs mit Treiber ab 570.124.06; echte CUDA-Generierung benötigt Hardwaretests.",
      en: "Vulkan / CPU with a current GPU driver. Separate CUDA edition for supported NVIDIA GPUs with driver 570.124.06+; real CUDA generation requires hardware testing.",
    },
  },
];
