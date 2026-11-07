import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";
import { ModelManager, type ModelManagerProps } from "./ModelManager";

type ModelDialogProps = ModelManagerProps & { onClose: () => void; title?: string };

export function ModelDialog({ onClose, title, ...props }: ModelDialogProps) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (element && !element.open) element.showModal();
    return () => { if (element?.open) element.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return createPortal(<dialog ref={dialog} id="modelPicker" aria-labelledby="modelPickerHeading"
    onClose={event => {
      event.stopPropagation();
      // Strict Mode can reopen the dialog before cleanup's queued close event arrives.
      if (!event.currentTarget.open) onClose();
    }}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <div className="model-picker-head"><h2 id="modelPickerHeading">{title ?? t("picker_title")}</h2><button type="button" className="sek" onClick={onClose}>{t("desktop_close")}</button></div>
    <ModelManager {...props} />
  </dialog>, document.body);
}
