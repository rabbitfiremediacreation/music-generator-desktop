export const audioFormats = {
  wav: { extension: "wav", label: "WAV" },
  mp3_128: { extension: "mp3", label: "MP3 · 128 kbit/s" },
  mp3: { extension: "mp3", label: "MP3 · 192 kbit/s" },
  mp3_320: { extension: "mp3", label: "MP3 · 320 kbit/s" },
  aac: { extension: "aac", label: "AAC · 192 kbit/s" },
  ogg: { extension: "ogg", label: "Ogg/Opus · 160 kbit/s" },
  original: { extension: null, label: null },
} as const;

export type AudioFormat = keyof typeof audioFormats;

export function orderedAudioFormats(preferred?: AudioFormat, available?: readonly AudioFormat[], mp3Available = false): AudioFormat[] {
  const supported: readonly AudioFormat[] = available ?? (mp3Available ? ["wav", "mp3_128", "mp3", "mp3_320", "original"] : ["wav", "original"]);
  const formats = (Object.keys(audioFormats) as AudioFormat[]).filter(format => supported.includes(format));
  if (preferred && formats.includes(preferred)) return [preferred, ...formats.filter(format => format !== preferred)];
  return formats.length ? formats : ["original"];
}
