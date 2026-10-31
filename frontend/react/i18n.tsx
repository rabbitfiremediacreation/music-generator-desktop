import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import "../desktop-i18n";
import "../setup-i18n";
import "../model-i18n";
import "../expert-i18n";
import "../title-i18n";
import "../import-i18n";
import "../path-i18n";
import "../form-preferences-i18n";
import "../cpu-i18n";
import "../backend-i18n";
import "../backend-chip-i18n";
import "../settings-i18n";
import "../song-result-i18n";
import { getLanguage, setLang, subscribeLanguage, t } from "../i18n.js";
import type { Language } from "../locales";

/** React and native-dialog helpers share one reactive, persisted language selection. */
export function useI18n() {
  const language = useSyncExternalStore(subscribeLanguage, getLanguage) as Language;
  return { language, setLanguage: setLang as (language: Language) => void, t: t as (key: string, ...args: (string | number)[]) => string };
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const { language } = useI18n();
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  return children;
}
