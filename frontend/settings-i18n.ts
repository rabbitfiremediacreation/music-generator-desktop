import { I18N } from "./i18n.js";
import type { Language } from "./locales";

const saving: Record<Language, string> = {
  de: "Einstellungen werden gespeichert…",
  en: "Saving settings…",
  es: "Guardando ajustes…",
  fr: "Enregistrement des paramètres…",
  it: "Salvataggio delle impostazioni…",
  pt: "A guardar definições…",
  tr: "Ayarlar kaydediliyor…",
  pl: "Zapisywanie ustawień…",
  ru: "Сохранение настроек…",
  uk: "Збереження налаштувань…",
  ja: "設定を保存中…",
  zh: "正在保存设置…",
};
for (const [language, message] of Object.entries(saving)) {
  Object.assign(I18N[language as Language], { settings_saving: message });
}

export const settingsPageKeys = [
  "settings_app", "settings_connections", "settings_information",
  "settings_page_generation", "settings_page_library", "settings_page_appearance", "settings_page_phone", "settings_page_mcp", "settings_page_about",
  "settings_description_generation", "settings_description_library", "settings_description_appearance", "settings_description_phone", "settings_description_mcp", "settings_description_about",
  "settings_appearance_hint", "settings_unsaved",
  "settings_page_models", "settings_description_models",
] as const;

export const settingsPageTranslations: Record<Language, readonly string[]> = {
  de: [
    "App-Einstellungen", "Verbindungen", "Informationen",
    "Generierung", "Bibliothek & Export", "Darstellung", "Handy-Zugriff", "MCP & Integrationen", "Über die App",
    "Passe Zeitlimit und CPU-Verhalten der Musikgenerierung an.", "Verwalte deine Songs, Speicherorte und das Exportformat.", "Richte dein Studio so ein, wie du am liebsten arbeitest.", "Verbinde dein Handy und steuere dein Studio im lokalen Netzwerk.", "Verbinde KI-Assistenten und andere Tools mit Music Generator.", "Suche nach Updates und erfahre mehr über das Projekt.",
    "Das Layout wird sofort angewendet. Automatisch passt die Anordnung an die Fensterbreite an.", "Du hast ungespeicherte Änderungen.",
    "Modelle und Hardware", "Wähle die Recheneinheit, aktiviere den Expert Mode und verwalte deine Modelle.",
  ],
  en: [
    "App settings", "Connections", "Information",
    "Generation", "Library & export", "Appearance", "Phone access", "MCP & integrations", "About the app",
    "Adjust the time limit and CPU behavior for music generation.", "Manage your songs, storage locations and export format.", "Arrange your studio to suit the way you work.", "Connect your phone and control your studio on the local network.", "Connect AI assistants and other tools to Music Generator.", "Check for updates and learn more about the project.",
    "Layout changes apply immediately. Automatic adapts the arrangement to the window width.", "You have unsaved changes.",
    "Models and hardware", "Choose the processing device, enable Expert Mode and manage your models.",
  ],
  es: [
    "Ajustes de la app", "Conexiones", "Información",
    "Generación", "Biblioteca y exportación", "Apariencia", "Acceso móvil", "MCP e integraciones", "Acerca de la app",
    "Ajusta el tiempo límite y el comportamiento de la CPU para generar música.", "Gestiona tus canciones, ubicaciones y formato de exportación.", "Organiza el estudio según tu forma de trabajar.", "Conecta tu móvil y controla el estudio en la red local.", "Conecta asistentes de IA y otras herramientas a Music Generator.", "Busca actualizaciones y conoce más sobre el proyecto.",
    "El diseño se aplica de inmediato. Automático adapta la distribución al ancho de la ventana.", "Tienes cambios sin guardar.",
    "Modelos y hardware", "Elige el dispositivo de procesamiento, activa el modo experto y gestiona tus modelos.",
  ],
  fr: [
    "Paramètres de l’app", "Connexions", "Informations",
    "Génération", "Bibliothèque et export", "Apparence", "Accès mobile", "MCP et intégrations", "À propos de l’app",
    "Réglez le délai et le comportement du CPU pour la génération musicale.", "Gérez vos morceaux, emplacements et format d’export.", "Organisez votre studio selon votre façon de travailler.", "Connectez votre téléphone et contrôlez le studio sur le réseau local.", "Connectez des assistants IA et d’autres outils à Music Generator.", "Recherchez des mises à jour et découvrez le projet.",
    "La disposition s’applique immédiatement. Automatique l’adapte à la largeur de la fenêtre.", "Vous avez des modifications non enregistrées.",
    "Modèles et matériel", "Choisissez le périphérique de calcul, activez le mode expert et gérez vos modèles.",
  ],
  it: [
    "Impostazioni app", "Connessioni", "Informazioni",
    "Generazione", "Libreria ed esportazione", "Aspetto", "Accesso dal telefono", "MCP e integrazioni", "Informazioni sull’app",
    "Regola il limite di tempo e il comportamento della CPU per generare musica.", "Gestisci brani, percorsi di salvataggio e formato di esportazione.", "Organizza lo studio secondo il tuo modo di lavorare.", "Collega il telefono e controlla lo studio sulla rete locale.", "Collega assistenti IA e altri strumenti a Music Generator.", "Cerca aggiornamenti e scopri di più sul progetto.",
    "Il layout viene applicato subito. Automatico adatta la disposizione alla larghezza della finestra.", "Hai modifiche non salvate.",
    "Modelli e hardware", "Scegli il dispositivo di elaborazione, attiva la modalità esperto e gestisci i modelli.",
  ],
  pt: [
    "Definições da app", "Ligações", "Informações",
    "Geração", "Biblioteca e exportação", "Aspeto", "Acesso pelo telemóvel", "MCP e integrações", "Sobre a app",
    "Ajusta o limite de tempo e o comportamento da CPU para gerar música.", "Gere músicas, locais de armazenamento e formato de exportação.", "Organiza o estúdio à tua maneira.", "Liga o telemóvel e controla o estúdio na rede local.", "Liga assistentes de IA e outras ferramentas ao Music Generator.", "Procura atualizações e descobre mais sobre o projeto.",
    "O layout é aplicado de imediato. Automático adapta a disposição à largura da janela.", "Tens alterações por guardar.",
    "Modelos e hardware", "Escolhe o dispositivo de processamento, ativa o modo especialista e gere os modelos.",
  ],
  tr: [
    "Uygulama ayarları", "Bağlantılar", "Bilgi",
    "Üretim", "Kitaplık ve dışa aktarma", "Görünüm", "Telefon erişimi", "MCP ve entegrasyonlar", "Uygulama hakkında",
    "Müzik üretimi için zaman sınırını ve CPU davranışını ayarlayın.", "Şarkıları, kayıt konumlarını ve dışa aktarma biçimini yönetin.", "Stüdyoyu çalışma şeklinize göre düzenleyin.", "Telefonunuzu bağlayıp stüdyoyu yerel ağdan kontrol edin.", "Yapay zekâ asistanlarını ve diğer araçları Music Generator’a bağlayın.", "Güncellemeleri denetleyin ve proje hakkında bilgi edinin.",
    "Düzen değişiklikleri hemen uygulanır. Otomatik, düzeni pencere genişliğine uyarlar.", "Kaydedilmemiş değişiklikleriniz var.",
    "Modeller ve donanım", "İşlem aygıtını seçin, uzman modunu etkinleştirin ve modellerinizi yönetin.",
  ],
  pl: [
    "Ustawienia aplikacji", "Połączenia", "Informacje",
    "Generowanie", "Biblioteka i eksport", "Wygląd", "Dostęp z telefonu", "MCP i integracje", "O aplikacji",
    "Dostosuj limit czasu i zachowanie CPU podczas generowania muzyki.", "Zarządzaj utworami, miejscem zapisu i formatem eksportu.", "Dostosuj układ studia do swojego sposobu pracy.", "Połącz telefon i steruj studiem w sieci lokalnej.", "Połącz asystentów AI i inne narzędzia z Music Generator.", "Sprawdź aktualizacje i dowiedz się więcej o projekcie.",
    "Zmiany układu są stosowane od razu. Automatyczny dostosowuje układ do szerokości okna.", "Masz niezapisane zmiany.",
    "Modele i sprzęt", "Wybierz urządzenie obliczeniowe, włącz tryb eksperta i zarządzaj modelami.",
  ],
  ru: [
    "Настройки приложения", "Подключения", "Информация",
    "Генерация", "Библиотека и экспорт", "Внешний вид", "Доступ с телефона", "MCP и интеграции", "О приложении",
    "Настройте ограничение времени и поведение CPU при генерации музыки.", "Управляйте песнями, папками хранения и форматом экспорта.", "Настройте студию под свой стиль работы.", "Подключите телефон и управляйте студией в локальной сети.", "Подключите ИИ-ассистентов и другие инструменты к Music Generator.", "Проверьте обновления и узнайте больше о проекте.",
    "Изменения макета применяются сразу. Автоматический режим учитывает ширину окна.", "У вас есть несохранённые изменения.",
    "Модели и оборудование", "Выберите вычислительное устройство, включите экспертный режим и управляйте моделями.",
  ],
  uk: [
    "Налаштування застосунку", "Підключення", "Інформація",
    "Генерація", "Бібліотека та експорт", "Вигляд", "Доступ із телефону", "MCP та інтеграції", "Про застосунок",
    "Налаштуйте обмеження часу та поведінку CPU під час генерації музики.", "Керуйте піснями, папками зберігання та форматом експорту.", "Налаштуйте студію під свій стиль роботи.", "Підключіть телефон і керуйте студією в локальній мережі.", "Підключіть ШІ-асистентів та інші інструменти до Music Generator.", "Перевірте оновлення та дізнайтеся більше про проєкт.",
    "Зміни макета застосовуються одразу. Автоматичний режим враховує ширину вікна.", "У вас є незбережені зміни.",
    "Моделі та обладнання", "Виберіть обчислювальний пристрій, увімкніть експертний режим і керуйте моделями.",
  ],
  ja: [
    "アプリ設定", "接続", "情報",
    "生成", "ライブラリと書き出し", "表示", "スマートフォン接続", "MCPと連携", "アプリについて",
    "音楽生成の制限時間とCPUの動作を設定します。", "曲、保存先、書き出し形式を管理します。", "作業スタイルに合わせてスタジオを配置します。", "スマートフォンを接続し、ローカルネットワークでスタジオを操作します。", "AIアシスタントや他のツールをMusic Generatorに接続します。", "更新を確認し、プロジェクトの詳細を確認します。",
    "レイアウトはすぐに適用されます。自動ではウィンドウ幅に合わせて配置します。", "未保存の変更があります。",
    "モデルとハードウェア", "処理デバイスを選択し、エキスパートモードを有効にしてモデルを管理します。",
  ],
  zh: [
    "应用设置", "连接", "信息",
    "生成", "曲库与导出", "外观", "手机访问", "MCP 与集成", "关于应用",
    "调整音乐生成的时间限制和 CPU 行为。", "管理歌曲、存储位置和导出格式。", "按照你的工作方式布置工作室。", "连接手机，通过局域网控制工作室。", "将 AI 助手和其他工具连接到 Music Generator。", "检查更新并了解项目信息。",
    "布局更改立即生效。自动模式会根据窗口宽度调整排列。", "你有尚未保存的更改。",
    "模型与硬件", "选择计算设备、启用专家模式并管理模型。",
  ],
};
for (const [language, values] of Object.entries(settingsPageTranslations)) {
  if (values.length !== settingsPageKeys.length) throw new Error(`Incomplete settings page translation: ${language}`);
  Object.assign(I18N[language as Language], Object.fromEntries(settingsPageKeys.map((key, index) => [key, values[index]])));
}

export const modelSettingsTranslations: Record<Language, { settings_apply_expert: string; settings_models_immediate: string; picker_cancel_download: string }> = {
  de: { settings_apply_expert: "Expert Mode übernehmen", settings_models_immediate: "Modellwechsel und Downloads werden sofort angewendet. Andere ungespeicherte Einstellungen bleiben erhalten.", picker_cancel_download: "Download abbrechen" },
  en: { settings_apply_expert: "Apply Expert Mode", settings_models_immediate: "Model changes and downloads apply immediately. Other unsaved settings are preserved.", picker_cancel_download: "Cancel download" },
  es: { settings_apply_expert: "Aplicar modo experto", settings_models_immediate: "Los cambios de modelo y las descargas se aplican de inmediato. Se conservan los demás ajustes sin guardar.", picker_cancel_download: "Cancelar descarga" },
  fr: { settings_apply_expert: "Appliquer le mode expert", settings_models_immediate: "Les changements de modèle et les téléchargements s’appliquent immédiatement. Les autres paramètres non enregistrés sont conservés.", picker_cancel_download: "Annuler le téléchargement" },
  it: { settings_apply_expert: "Applica modalità esperto", settings_models_immediate: "I cambi di modello e i download vengono applicati subito. Le altre impostazioni non salvate vengono mantenute.", picker_cancel_download: "Annulla download" },
  pt: { settings_apply_expert: "Aplicar modo especialista", settings_models_immediate: "As mudanças de modelo e as transferências são aplicadas de imediato. As outras definições por guardar são mantidas.", picker_cancel_download: "Cancelar transferência" },
  tr: { settings_apply_expert: "Uzman modunu uygula", settings_models_immediate: "Model değişiklikleri ve indirmeler hemen uygulanır. Diğer kaydedilmemiş ayarlar korunur.", picker_cancel_download: "İndirmeyi iptal et" },
  pl: { settings_apply_expert: "Zastosuj tryb eksperta", settings_models_immediate: "Zmiany modeli i pobieranie są stosowane od razu. Inne niezapisane ustawienia zostają zachowane.", picker_cancel_download: "Anuluj pobieranie" },
  ru: { settings_apply_expert: "Применить экспертный режим", settings_models_immediate: "Смена моделей и загрузки применяются сразу. Остальные несохранённые настройки сохраняются.", picker_cancel_download: "Отменить загрузку" },
  uk: { settings_apply_expert: "Застосувати експертний режим", settings_models_immediate: "Зміни моделей і завантаження застосовуються одразу. Інші незбережені налаштування зберігаються.", picker_cancel_download: "Скасувати завантаження" },
  ja: { settings_apply_expert: "エキスパートモードを適用", settings_models_immediate: "モデルの変更とダウンロードはすぐに適用されます。他の未保存の設定は保持されます。", picker_cancel_download: "ダウンロードを中止" },
  zh: { settings_apply_expert: "应用专家模式", settings_models_immediate: "模型更改和下载立即生效。其他未保存的设置会保留。", picker_cancel_download: "取消下载" },
};
for (const [language, messages] of Object.entries(modelSettingsTranslations)) Object.assign(I18N[language as Language], messages);
