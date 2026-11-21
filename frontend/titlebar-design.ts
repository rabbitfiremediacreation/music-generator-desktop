export const titlebarDesigns = ["auto", "classic", "dev", "nightly"] as const;
type TitlebarDesign = typeof titlebarDesigns[number];

const storageKey = "desktop_titlebar_design";
const listeners = new Set<() => void>();
let current: TitlebarDesign = "auto";

function applyTitlebarDesign(value: string | null): void {
  const next = titlebarDesigns.find(design => design === value) ?? "auto";
  if (next === current) return;
  current = next;
  listeners.forEach(listener => listener());
}

export function currentTitlebarDesign(): TitlebarDesign {
  return current;
}

export function restoreTitlebarDesign(): void {
  try { applyTitlebarDesign(localStorage.getItem(storageKey)); }
  catch { applyTitlebarDesign(null); }
}

export function setTitlebarDesign(value: string): void {
  applyTitlebarDesign(value);
  try { localStorage.setItem(storageKey, current); }
  catch { /* Keep the selection for this session. */ }
}

export function subscribeTitlebarDesign(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
