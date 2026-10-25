export const LANGS = {
  de: "Deutsch", en: "English", es: "Español", fr: "Français", it: "Italiano", pt: "Português",
  tr: "Türkçe", pl: "Polski", ru: "Русский", uk: "Українська", ja: "日本語", zh: "中文",
} as const;
export type Language = keyof typeof LANGS;

function supported(value: string | null | undefined): Language | undefined {
  const language = value?.trim().toLowerCase().split(/[-_]/)[0];
  return language && Object.hasOwn(LANGS, language) ? language as Language : undefined;
}

/** Splash and main window share saved-language priority and system-language fallback. */
export function resolveLanguage(saved: string | null | undefined, system: string): Language {
  return supported(saved) || supported(system) || "en";
}

export function preferredLanguage(): Language {
  let saved: string | null = null;
  try { saved = localStorage.getItem("ui_lang"); } catch { /* Use the system language when storage is unavailable. */ }
  return resolveLanguage(saved, navigator.language || "en");
}
