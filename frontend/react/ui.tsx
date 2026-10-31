import { useEffect, useRef, type ReactNode } from "react";
import { useI18n } from "./i18n";
import { modelErrorText } from "../expert-mode";
import { pathErrorText } from "../path-dialogs";

export function Dialog({ open, title, onClose, busy = false, children, className = "" }: {
  open: boolean; title: string; onClose: () => void; busy?: boolean; children: ReactNode; className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  return <dialog ref={dialog} aria-label={title} aria-busy={busy} className={className}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onClose={() => { if (open && !busy) onClose(); }}>{children}</dialog>;
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const { t } = useI18n();
  return <div className="setup-error" role="alert"><p>{t("error")}: {pathErrorText(modelErrorText(error,t))}</p>
    {retry && <button type="button" className="sek" onClick={retry}>{t("retry")}</button>}</div>;
}

export function LoadingState() {
  const { t } = useI18n();
  return <p role="status" className="small">{t("desktop_checking")}</p>;
}
