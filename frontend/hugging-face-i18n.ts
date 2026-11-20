import { I18N } from "./i18n.js";

Object.assign(I18N.en, {
  hf_loading: "Checking Hugging Face…",
  hf_checking_file: "Checking the model file…",
  hf_unverified_variant: "Hugging Face · Untested",
  hf_adopt: "Check and select",
  hf_expert_hint: "Adding new variants requires Expert Mode.",
  hf_metadata_unavailable: "Hugging Face metadata is currently unavailable.",
  hf_model_unsupported: "This file does not match a supported music engine.",
  hf_model_conflict: "A different revision of this file is already pinned in the catalog.",
  hf_model_changed: "The published file metadata has changed. Reload the variants.",
  hf_model_header: "The GGUF header could not be verified for this engine.",
  hf_pins_unavailable: "The local Hugging Face catalog could not be opened.",
});

Object.assign(I18N.de, {
  hf_loading: "Hugging Face wird abgefragt …",
  hf_checking_file: "Modelldatei wird geprüft …",
  hf_unverified_variant: "Hugging Face · Ungetestet",
  hf_adopt: "Prüfen und auswählen",
  hf_expert_hint: "Zum Hinzufügen neuer Varianten ist der Expert Mode erforderlich.",
  hf_metadata_unavailable: "Die Metadaten von Hugging Face sind gerade nicht erreichbar.",
  hf_model_unsupported: "Diese Datei passt zu keiner unterstützten Musik-Engine.",
  hf_model_conflict: "Für diese Datei ist bereits eine andere Revision im Katalog gespeichert.",
  hf_model_changed: "Die veröffentlichten Dateidaten haben sich geändert. Lade die Varianten neu.",
  hf_model_header: "Der GGUF-Header konnte für diese Engine nicht bestätigt werden.",
  hf_pins_unavailable: "Der lokale Hugging-Face-Katalog konnte nicht geöffnet werden.",
});
