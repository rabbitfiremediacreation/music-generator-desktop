import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./popup-menu.css";

type ItemProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & { onChoose: () => void; close?: () => void };

export function PopupMenuItem({ children, close, onChoose, ...props }: ItemProps) {
  return <button {...props} type="button" role="menuitem" tabIndex={-1} onClick={() => { close?.(); onChoose(); }}>{children}</button>;
}

interface Props {
  label: string; menuLabel?: string; title?: string; descriptionId?: string; className: string; menuClassName?: string;
  disabled?: boolean; triggerContent: ReactNode; children: (close: () => void) => ReactNode; onDismiss?: () => void;
}

export function PopupMenu({ label, menuLabel, title, descriptionId, className, menuClassName = "", disabled, triggerContent, children, onDismiss }: Props) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const startAtEnd = useRef(false);
  const menuId = useId();
  const close = useCallback(() => { setOpen(false); onDismiss?.(); }, [onDismiss]);

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
      const items = panel.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)');
      items[startAtEnd.current ? items.length - 1 : 0]?.focus({ preventScroll: true });
    }
  });

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node) || (!menu.current?.contains(target) && !trigger.current?.contains(target))) close();
    };
    const closeOnResize = () => close();
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("click", closeOutside, true);
    window.addEventListener("scroll", closeOutside, true);
    window.addEventListener("resize", closeOnResize);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("click", closeOutside, true);
      window.removeEventListener("scroll", closeOutside, true);
      window.removeEventListener("resize", closeOnResize);
    };
  }, [open, close]);

  const closeWithFocus = () => { trigger.current?.focus({ preventScroll: true }); close(); };
  const menuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeWithFocus();
    } else if (event.key === "Tab") {
      closeWithFocus();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')];
      if (!items.length) return;
      const current = items.findIndex(item => item === document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
        : (current + items.length + (event.key === "ArrowDown" ? 1 : -1)) % items.length;
      items[next]?.focus();
    }
  };

  return <>
    <button type="button" ref={trigger} className={className} title={title ?? label}
      aria-label={label} aria-describedby={descriptionId} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      disabled={disabled} onClick={() => { startAtEnd.current = false; if (open) close(); else setOpen(true); }}
      onKeyDown={event => {
        if (open || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
        event.preventDefault();
        startAtEnd.current = event.key === "ArrowUp";
        setOpen(true);
      }}>{triggerContent}</button>
    {open && createPortal(
      <div ref={menu} id={menuId} className={`popup-menu ${menuClassName}`} role="menu" aria-label={menuLabel ?? label} onKeyDown={menuKey}
        onBlur={event => {
          const target = event.relatedTarget;
          if (target && target !== trigger.current && !event.currentTarget.contains(target)) close();
        }}>{children(closeWithFocus)}</div>,
      document.body,
    )}
  </>;
}
