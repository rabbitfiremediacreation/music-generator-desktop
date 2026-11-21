import { I18N } from "../i18n.js";
import type { Language } from "../locales";

const keys = [
  "menu_file", "menu_edit", "menu_view", "menu_window", "menu_help",
  "menu_songs_folder", "menu_creator", "menu_documentation",
] as const;

type Labels<T extends readonly string[]> = { [Index in keyof T]: string };

const translations = {
  de: ["Ablage", "Bearbeiten", "Darstellung", "Fenster", "Hilfe", "Song-Ordner öffnen", "Song-Editor anzeigen", "Dokumentation"],
  en: ["File", "Edit", "View", "Window", "Help", "Open Songs Folder", "Show Song Editor", "Documentation"],
  es: ["Archivo", "Edición", "Visualización", "Ventana", "Ayuda", "Abrir carpeta de canciones", "Mostrar editor de canciones", "Documentación"],
  fr: ["Fichier", "Édition", "Présentation", "Fenêtre", "Aide", "Ouvrir le dossier des morceaux", "Afficher l’éditeur de morceaux", "Documentation"],
  it: ["File", "Modifica", "Vista", "Finestra", "Aiuto", "Apri cartella dei brani", "Mostra editor dei brani", "Documentazione"],
  pt: ["Ficheiro", "Edição", "Visualização", "Janela", "Ajuda", "Abrir pasta de músicas", "Mostrar editor de músicas", "Documentação"],
  tr: ["Dosya", "Düzen", "Görünüm", "Pencere", "Yardım", "Şarkı klasörünü aç", "Şarkı düzenleyicisini göster", "Belgeler"],
  pl: ["Plik", "Edycja", "Widok", "Okno", "Pomoc", "Otwórz folder utworów", "Pokaż edytor utworów", "Dokumentacja"],
  ru: ["Файл", "Правка", "Вид", "Окно", "Справка", "Открыть папку песен", "Показать редактор песен", "Документация"],
  uk: ["Файл", "Редагування", "Вигляд", "Вікно", "Довідка", "Відкрити теку пісень", "Показати редактор пісень", "Документація"],
  ja: ["ファイル", "編集", "表示", "ウインドウ", "ヘルプ", "曲のフォルダを開く", "曲のエディタを表示", "ドキュメント"],
  zh: ["文件", "编辑", "显示", "窗口", "帮助", "打开歌曲文件夹", "显示歌曲编辑器", "文档"],
} satisfies Record<Language, Labels<typeof keys>>;

for (const [language, values] of Object.entries(translations)) {
  Object.assign(I18N[language as Language], Object.fromEntries(keys.map((key, index) => [key, values[index]])));
}
