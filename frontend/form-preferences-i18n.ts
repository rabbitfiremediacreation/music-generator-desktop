import { I18N } from "./i18n.js";

export const formPreferenceTranslations: Record<string, readonly [string, string]> = {
  de: ["Grundeinstellungen zurücksetzen", "Die Formularwerte konnten nicht geladen oder gespeichert werden. Bei der nächsten Änderung oder beim Schließen wird das Speichern erneut versucht."],
  en: ["Reset basic settings", "The form values could not be loaded or saved. Saving will be retried on the next change or when closing."],
  es: ["Restablecer ajustes básicos", "No se pudieron cargar o guardar los valores del formulario. Se intentará guardar de nuevo con el próximo cambio o al cerrar."],
  fr: ["Réinitialiser les réglages de base", "Les valeurs du formulaire n’ont pas pu être chargées ou enregistrées. L’enregistrement sera réessayé au prochain changement ou à la fermeture."],
  it: ["Ripristina impostazioni di base", "Impossibile caricare o salvare i valori del modulo. Il salvataggio verrà ritentato alla prossima modifica o alla chiusura."],
  pt: ["Repor definições básicas", "Não foi possível carregar ou guardar os valores do formulário. Será feita nova tentativa na próxima alteração ou ao fechar."],
  tr: ["Temel ayarları sıfırla", "Form değerleri yüklenemedi veya kaydedilemedi. Sonraki değişiklikte veya kapatırken kaydetme yeniden denenecek."],
  pl: ["Przywróć ustawienia podstawowe", "Nie udało się wczytać lub zapisać wartości formularza. Zapis zostanie ponowiony przy następnej zmianie lub zamykaniu."],
  ru: ["Сбросить основные настройки", "Не удалось загрузить или сохранить значения формы. Сохранение будет повторено при следующем изменении или закрытии."],
  uk: ["Скинути основні налаштування", "Не вдалося завантажити або зберегти значення форми. Збереження буде повторено під час наступної зміни або закриття."],
  ja: ["基本設定をリセット", "フォームの値を読み込みまたは保存できませんでした。次の変更時または終了時に保存を再試行します。"],
  zh: ["重置基本设置", "无法加载或保存表单值。下次更改或关闭时将重试保存。"],
};
for (const [lang, [reset, error]] of Object.entries(formPreferenceTranslations)) {
  Object.assign(I18N[lang as keyof typeof I18N], { form_preferences_reset: reset, form_preferences_error: error });
}
