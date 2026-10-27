import { preferredLanguage, type Language } from "./locales";
import { startupText } from "./startup-text";

export const startupErrorKeys = ["startup_splash_timeout", "startup_main_timeout", "startup_running"] as const;
export const startupErrorTranslations = {
  de: ["Das Startfenster ist nicht bereit geworden. Bitte versuche es erneut.", "Das Hauptfenster ist nicht bereit geworden. Bitte versuche es erneut.", "Der Start läuft bereits. Bitte warte einen Moment."],
  en: ["The startup window did not become ready. Please try again.", "The main window did not become ready. Please try again.", "Startup is already running. Please wait a moment."],
  es: ["La ventana de inicio no estuvo lista. Inténtalo de nuevo.", "La ventana principal no estuvo lista. Inténtalo de nuevo.", "El inicio ya está en curso. Espera un momento."],
  fr: ["La fenêtre de démarrage n’est pas devenue prête. Veuillez réessayer.", "La fenêtre principale n’est pas devenue prête. Veuillez réessayer.", "Le démarrage est déjà en cours. Veuillez patienter un instant."],
  it: ["La finestra di avvio non è diventata pronta. Riprova.", "La finestra principale non è diventata pronta. Riprova.", "L’avvio è già in corso. Attendi un momento."],
  pt: ["A janela de arranque não ficou pronta. Tenta novamente.", "A janela principal não ficou pronta. Tenta novamente.", "O arranque já está em curso. Aguarda um momento."],
  tr: ["Başlangıç penceresi hazır olmadı. Lütfen tekrar deneyin.", "Ana pencere hazır olmadı. Lütfen tekrar deneyin.", "Başlatma zaten sürüyor. Lütfen biraz bekleyin."],
  pl: ["Okno uruchamiania nie było gotowe. Spróbuj ponownie.", "Okno główne nie było gotowe. Spróbuj ponownie.", "Uruchamianie już trwa. Poczekaj chwilę."],
  ru: ["Стартовое окно не было готово. Повторите попытку.", "Главное окно не было готово. Повторите попытку.", "Запуск уже выполняется. Подождите немного."],
  uk: ["Стартове вікно не було готове. Спробуйте ще раз.", "Головне вікно не було готове. Спробуйте ще раз.", "Запуск уже триває. Трохи зачекайте."],
  ja: ["起動ウィンドウの準備ができませんでした。もう一度お試しください。", "メインウィンドウの準備ができませんでした。もう一度お試しください。", "起動はすでに進行中です。少々お待ちください。"],
  zh: ["启动窗口未能准备就绪。请重试。", "主窗口未能准备就绪。请重试。", "启动已在进行中。请稍候。"],
} satisfies Record<Language, readonly [string, string, string]>;

export function startupErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Translate known startup codes while keeping unknown diagnostics out of the main message. */
export function startupErrorText(error: unknown): string {
  return translatedError(error) ?? startupText().failure;
}

export function startupErrorDetails(error: unknown): string {
  return translatedError(error) ?? startupErrorMessage(error);
}

function translatedError(error: unknown): string | undefined {
  const message = startupErrorMessage(error);
  const index = startupErrorKeys.findIndex(code => code === message);
  return index < 0 ? undefined : startupErrorTranslations[preferredLanguage()][index];
}
