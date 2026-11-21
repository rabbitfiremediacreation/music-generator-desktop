import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { audioFormats, type AudioFormat } from "./audio-formats";
import "./download-format.css";

export function DownloadFormatMenu({ formats, label, menuLabel, originalLabel, title, descriptionId, className, disabled, onChoose, children }: {
  formats: AudioFormat[];
  label: string;
  menuLabel: string;
  originalLabel: string;
  title?: string;
  descriptionId?: string;
  className: string;
  disabled?: boolean;
  onChoose: (format: AudioFormat) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const startAtEnd = useRef(false);
  const menuId = useId();

  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const button = trigger.current.getBoundingClientRect();
    const panel = menu.current;
    panel.style.maxHeight = "";
    const { width, height } = panel.getBoundingClientRect();
    const margin = 8;
    const below = window.innerHeight - button.bottom - margin * 2;
    const above = button.top - margin * 2;
    const flip = below < height && above > below;
    const availableHeight = Math.max(0, flip ? above : below);
    panel.style.maxHeight = `${availableHeight}px`;
    panel.style.top = `${flip ? button.top - margin - Math.min(height, availableHeight) : button.bottom + margin}px`;
    panel.style.left = `${Math.max(margin, Math.min(button.right - width, window.innerWidth - width - margin))}px`;
    if (!panel.contains(document.activeElement)) {
      const items = panel.querySelectorAll("button");
      items[startAtEnd.current ? items.length - 1 : 0]?.focus({ preventScroll: true });
    }
  }, [open, formats.length]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node) || (!menu.current?.contains(target) && !trigger.current?.contains(target))) setOpen(false);
    };
    const closeOnResize = () => setOpen(false);
    document.addEventListener("pointerdown", closeOutside, true);
    window.addEventListener("scroll", closeOutside, true);
    window.addEventListener("resize", closeOnResize);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      window.removeEventListener("scroll", closeOutside, true);
      window.removeEventListener("resize", closeOnResize);
    };
  }, [open]);

  const closeWithFocus = () => { trigger.current?.focus({ preventScroll: true }); setOpen(false); };
  const menuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeWithFocus();
    } else if (event.key === "Tab") {
      closeWithFocus();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const items = [...event.currentTarget.querySelectorAll("button")];
      const current = items.findIndex(item => item === document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
        : (current + items.length + (event.key === "ArrowDown" ? 1 : -1)) % items.length;
      items[next]?.focus();
    }
  };

  return <>
    <button type="button" ref={trigger} className={`${className} download-format-trigger`} title={title ?? label}
      aria-label={label} aria-describedby={descriptionId} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      disabled={disabled} onClick={() => { startAtEnd.current = false; setOpen(!open); }}
      onKeyDown={event => {
        if (open || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
        event.preventDefault();
        startAtEnd.current = event.key === "ArrowUp";
        setOpen(true);
      }}>{children}</button>
    {open && createPortal(
      <div ref={menu} id={menuId} className="download-format-menu" role="menu" aria-label={menuLabel} onKeyDown={menuKey}
        onBlur={event => {
          const target = event.relatedTarget;
          if (target && target !== trigger.current && !event.currentTarget.contains(target)) setOpen(false);
        }}>
        {formats.map(format => <button key={format} type="button" role="menuitem" tabIndex={-1} className="download-format-option"
          onClick={() => { closeWithFocus(); onChoose(format); }}>{audioFormats[format].label ?? originalLabel}</button>)}
      </div>,
      document.body,
    )}
  </>;
}
