import { useId, type ReactNode } from "react";
import { audioFormats, type AudioFormat } from "./audio-formats";
import { PopupMenu, PopupMenuItem } from "./PopupMenu";
import "./download-format.css";

const metadataDescriptions = {
  en: {
    tagged: "Includes recorded model and usage metadata",
    aac: "Model and usage metadata unavailable in AAC",
    original: "Keeps existing file tags. Some originals lack model metadata.",
  },
  de: {
    tagged: "Enthält gespeicherte Angaben zu Modell und Nutzung",
    aac: "Keine Modell- und Nutzungshinweise in AAC",
    original: "Behält vorhandene Tags. Manche Originaldateien enthalten keine Modellangaben.",
  },
};

export function DownloadFormatMenu({ formats, label, menuLabel, originalLabel, language, title, descriptionId, className, disabled, onChoose, children }: {
  formats: AudioFormat[];
  label: string;
  menuLabel: string;
  originalLabel: string;
  language: string;
  title?: string;
  descriptionId?: string;
  className: string;
  disabled?: boolean;
  onChoose: (format: AudioFormat) => void;
  children: ReactNode;
}) {
  const id = useId();
  const metadata = metadataDescriptions[language === "de" ? "de" : "en"];
  return <PopupMenu label={label} menuLabel={menuLabel} title={title} descriptionId={descriptionId} disabled={disabled}
    className={`${className} download-format-trigger`} menuClassName="download-format-menu" triggerContent={children}>
    {close => formats.map(format => {
      const optionLabel = audioFormats[format].label ?? originalLabel;
      const hintId = `${id}-${format}`;
      const hint = format === "aac" || format === "original" ? metadata[format] : metadata.tagged;
      return <PopupMenuItem key={format} close={close} onChoose={() => onChoose(format)} aria-label={optionLabel} aria-describedby={hintId}>
        {optionLabel}<span id={hintId} className="download-format-metadata">{hint}</span>
      </PopupMenuItem>;
    })}
  </PopupMenu>;
}
