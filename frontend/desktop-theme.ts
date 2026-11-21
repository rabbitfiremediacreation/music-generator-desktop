export const desktopThemes = [
  { id: "classic", name: "Classic" },
  { id: "light", name: "Light" },
  { id: "dark", name: "Dark" },
  { id: "pink", name: "Pink" },
  { id: "green", name: "Green" },
  { id: "triphop", name: "Triphop" },
  { id: "techno-bunker", name: "Techno Bunker" },
  { id: "lofi", name: "Lofi" },
] as const;

export type DesktopTheme = typeof desktopThemes[number]["id"];

const storageKey = "desktop_theme";
const defaultTheme: DesktopTheme = "classic";
const listeners = new Set<() => void>();

function validTheme(value: string | null | undefined): DesktopTheme {
  return desktopThemes.find(theme => theme.id === value)?.id ?? defaultTheme;
}

export function currentTheme(): DesktopTheme {
  return validTheme(document.documentElement.dataset.theme);
}

function applyTheme(theme: DesktopTheme): void {
  if (document.documentElement.dataset.theme === theme) return;
  document.documentElement.dataset.theme = theme;
  listeners.forEach(listener => listener());
}

export function restoreTheme(): void {
  let theme = defaultTheme;
  try { theme = validTheme(localStorage.getItem(storageKey)); }
  catch { /* Use Classic when preferences cannot be read. */ }
  applyTheme(theme);
}

export function setTheme(theme: DesktopTheme): void {
  applyTheme(theme);
  try { localStorage.setItem(storageKey, theme); }
  catch { /* Keep the selection for this session. */ }
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
