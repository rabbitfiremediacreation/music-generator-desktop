import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ActivityStatus } from "../ActivityStatus";
import { useI18n } from "../i18n";

export function ModelPickerDialog({ title, onClose, children }: {
  title: string; onClose: () => void; children: ReactNode;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (element && !element.open) element.showModal();
    return () => { if (element?.open) element.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return createPortal(<dialog ref={dialog} className="model-picker-dialog" aria-labelledby={heading}
    onClose={event => {
      event.stopPropagation();
      // Strict Mode can reopen the dialog before cleanup's queued close event arrives.
      if (!event.currentTarget.open) onClose();
    }}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <div className="model-picker-head">
      <div><h2 id={heading}>{title}</h2><ActivityStatus className="model-picker-activity" /></div>
      <button type="button" className="sek" onClick={onClose}>{t("desktop_close")}</button>
    </div>
    {children}
  </dialog>, document.body);
}
