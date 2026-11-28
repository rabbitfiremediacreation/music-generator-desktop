import { I18N } from "../../i18n.js";
import type { Language } from "../../locales";

Object.assign(I18N.en, {
  song_usage_source: "Source",
  song_usage_ace_step: "Publication and monetization rights for this local checkpoint are unclear. The ACE-Step publisher recommends that you check originality, disclose AI involvement and obtain permission when adapting protected material.",
  song_usage_unconfirmed: "The terms for this recording's saved model version are unclear. Check the applicable terms before publishing or monetizing it.",
  song_usage_unknown: "The original model is not known. Its terms for publishing or monetizing this song are unclear.",
  song_usage_reference: "This song uses a recording. Check whether your permission covers the intended use of this song, including the recording, composition and performance.",
  song_export_audio: "Export audio",
  song_export_continue: "Continue to save",
});

Object.assign(I18N.de, {
  song_usage_source: "Quelle",
  song_usage_ace_step: "Die Rechte zur Veröffentlichung und Monetarisierung für diesen lokalen Modellstand sind ungeklärt. ACE-Step empfiehlt, die musikalische Eigenständigkeit zu prüfen, die KI-Mitwirkung offenzulegen und bei der Bearbeitung geschützter Vorlagen eine Einwilligung einzuholen.",
  song_usage_unconfirmed: "Die Bedingungen für die gespeicherte Modellversion dieser Aufnahme sind unklar. Prüfe die geltenden Bedingungen vor einer Veröffentlichung oder Monetarisierung.",
  song_usage_unknown: "Das ursprüngliche Modell ist unbekannt. Seine Bedingungen für die Veröffentlichung oder Monetarisierung dieses Songs sind unklar.",
  song_usage_reference: "Dieser Song verwendet eine Aufnahme. Prüfe, ob deine Erlaubnis die geplante Nutzung des Songs abdeckt, einschließlich Aufnahme, Komposition und Darbietung.",
  song_export_audio: "Audio exportieren",
  song_export_continue: "Weiter zum Speichern",
});

const rowKeys = ["song_actions", "song_usage_terms", "song_model_license", "song_output_creator_sales", "song_output_ai_label",
  "song_output_check", "song_output_terms", "song_output_recorded", "song_output_unclear", "song_reference_badge", "song_usage_noncommercial"] as const;
type Labels<Keys extends readonly string[]> = { [Index in keyof Keys]: string };
const labels: Record<Language, Labels<typeof rowKeys>> = {
  de: ["Songaktionen", "Nutzungsbedingungen", "Modelllizenz", "Verkauf für Einzelkreative", "KI-Kennzeichnung erforderlich", "Songrechte prüfen", "Nutzungsauflagen", "Gespeicherte Songbedingungen", "Songrechte ungeklärt", "Referenzrechte prüfen", "Nichtkommerzielle Nutzung"],
  en: ["Song actions", "Usage terms", "Model license", "Individual creators may sell", "AI disclosure required", "Check output rights", "Output terms apply", "Recorded output terms", "Output rights unclear", "Check reference rights", "Noncommercial use"],
  es: ["Acciones de la canción", "Condiciones de uso", "Licencia del modelo", "Venta permitida a creadores individuales", "Declaración de IA obligatoria", "Revisar derechos de la canción", "Uso sujeto a condiciones", "Condiciones guardadas", "Derechos sin aclarar", "Revisar derechos de la referencia", "Uso no comercial"],
  fr: ["Actions du morceau", "Conditions d’utilisation", "Licence du modèle", "Vente autorisée aux créateurs individuels", "Mention de l’IA obligatoire", "Vérifier les droits du morceau", "Utilisation sous conditions", "Conditions enregistrées", "Droits du morceau incertains", "Vérifier les droits de la référence", "Usage non commercial"],
  it: ["Azioni del brano", "Condizioni d’uso", "Licenza del modello", "Vendita consentita ai singoli autori", "Dichiarazione di uso dell’IA obbligatoria", "Verificare i diritti sul brano", "Uso soggetto a condizioni", "Condizioni salvate", "Diritti sul brano incerti", "Verificare i diritti sul riferimento", "Uso non commerciale"],
  pt: ["Ações da faixa", "Termos de uso", "Licença do modelo", "Venda permitida a criadores individuais", "Declaração de uso de IA obrigatória", "Verificar direitos da faixa", "Uso sujeito a condições", "Termos salvos", "Direitos da faixa incertos", "Verificar direitos da referência", "Uso não comercial"],
  tr: ["Şarkı işlemleri", "Kullanım koşulları", "Model lisansı", "Bireysel üreticiler satabilir", "Yapay zekâ kullanımı belirtilmeli", "Şarkı haklarını denetle", "Kullanım koşullara bağlı", "Kayıtlı kullanım koşulları", "Şarkı hakları belirsiz", "Referans haklarını denetle", "Ticari olmayan kullanım"],
  pl: ["Działania dla utworu", "Warunki korzystania", "Licencja modelu", "Twórcy indywidualni mogą sprzedawać", "Wymagane oznaczenie AI", "Sprawdź prawa do utworu", "Użycie podlega warunkom", "Zapisane warunki", "Prawa do utworu niejasne", "Sprawdź prawa do nagrania źródłowego", "Użycie niekomercyjne"],
  ru: ["Действия с треком", "Условия использования", "Лицензия модели", "Индивидуальные авторы могут продавать", "Нужна пометка об ИИ", "Проверить права на трек", "Применяются условия использования", "Сохранённые условия", "Права на трек неясны", "Проверить права на исходную запись", "Некоммерческое использование"],
  uk: ["Дії з треком", "Умови використання", "Ліцензія моделі", "Індивідуальні автори можуть продавати", "Потрібна позначка про ШІ", "Перевірити права на трек", "Діють умови використання", "Збережені умови", "Права на трек не з’ясовано", "Перевірити права на початковий запис", "Некомерційне використання"],
  ja: ["曲の操作", "利用条件", "モデルライセンス", "個人クリエイターは販売可", "AI生成の表示が必要", "楽曲の権利を確認", "利用条件あり", "保存済みの利用条件", "楽曲の権利は未確認", "参照音源の権利を確認", "非商用利用"],
  zh: ["歌曲操作", "使用条款", "模型许可", "个人创作者可销售", "须标注为 AI 生成", "核查歌曲权利", "使用须遵守条款", "已保存的使用条款", "歌曲权利尚不明确", "核查参考录音权利", "非商业使用"],
};
for (const language of Object.keys(labels) as Language[]) {
  Object.assign(I18N[language], Object.fromEntries(rowKeys.map((key, index) => [key, labels[language][index]])));
}
