import { I18N } from "./i18n.js";

Object.assign(I18N.en, {
  cover_art_enable: "Generate cover art",
  cover_art_hint: "Create a local SDXS-512 DreamShaper cover for each new audio track. The first cover downloads about 1 GB.",
  cover_art_unsupported: "Cover art requires macOS 26 or later, Windows x64, or Linux x64 with glibc 2.43 or later.",
  cover_art_failed: "Cover art could not be generated",
  cover_art_image: "Generated cover art",
  desktop_progress_cover_art_download: "Preparing cover art model and engine",
  desktop_progress_cover_art: "Generating cover art",
});

Object.assign(I18N.de, {
  cover_art_enable: "Cover-Art erzeugen",
  cover_art_hint: "Erstellt lokal mit SDXS-512 DreamShaper ein Cover für jeden neuen Audio-Track. Beim ersten Cover lädt die App etwa 1 GB herunter.",
  cover_art_unsupported: "Cover-Art erfordert macOS 26 oder neuer, Windows x64 oder Linux x64 mit glibc 2.43 oder neuer.",
  cover_art_failed: "Cover-Art konnte nicht erzeugt werden",
  cover_art_image: "Generierte Cover-Art",
  desktop_progress_cover_art_download: "Modell und Engine für Cover-Art werden vorbereitet",
  desktop_progress_cover_art: "Cover-Art wird erzeugt",
});
