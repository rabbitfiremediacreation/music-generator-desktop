import { I18N } from "./i18n.js";
import type { Language } from "./locales";

export const modelInventoryKeys = ["models_installed_title", "models_add", "models_installed_empty", "models_total_size"] as const;
const translations: Record<Language, readonly string[]> = {
  de: ["Installierte Modelle", "Modell hinzufügen", "Noch keine Modelle installiert. Füge ein Modell hinzu, um loszulegen.", "Geschätzte Gesamtgröße"],
  en: ["Installed models", "Add model", "No models installed yet. Add a model to get started.", "Estimated total size"],
  es: ["Modelos instalados", "Añadir modelo", "Aún no hay modelos instalados. Añade uno para empezar.", "Tamaño total estimado"],
  fr: ["Modèles installés", "Ajouter un modèle", "Aucun modèle installé. Ajoutez un modèle pour commencer.", "Taille totale estimée"],
  it: ["Modelli installati", "Aggiungi modello", "Nessun modello installato. Aggiungine uno per iniziare.", "Dimensione totale stimata"],
  pt: ["Modelos instalados", "Adicionar modelo", "Ainda não há modelos instalados. Adiciona um modelo para começar.", "Tamanho total estimado"],
  tr: ["Yüklü modeller", "Model ekle", "Henüz yüklü model yok. Başlamak için bir model ekleyin.", "Tahmini toplam boyut"],
  pl: ["Zainstalowane modele", "Dodaj model", "Nie ma jeszcze zainstalowanych modeli. Dodaj model, aby rozpocząć.", "Szacowany łączny rozmiar"],
  ru: ["Установленные модели", "Добавить модель", "Модели ещё не установлены. Добавьте модель, чтобы начать.", "Оценка общего размера"],
  uk: ["Установлені моделі", "Додати модель", "Моделі ще не встановлено. Додайте модель, щоб почати.", "Оцінка загального розміру"],
  ja: ["インストール済みモデル", "モデルを追加", "モデルがまだインストールされていません。モデルを追加して始めましょう。", "推定合計サイズ"],
  zh: ["已安装的模型", "添加模型", "尚未安装模型。添加一个模型即可开始。", "预计总大小"],
};
for (const [language, values] of Object.entries(translations)) {
  if (values.length !== modelInventoryKeys.length) throw new Error(`Incomplete model inventory translation: ${language}`);
  Object.assign(I18N[language as Language], Object.fromEntries(modelInventoryKeys.map((key, index) => [key, values[index]])));
}
