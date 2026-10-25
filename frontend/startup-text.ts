import { preferredLanguage, type Language } from "./locales";

export const startupKeys = ["starting", "data", "hardware", "settings", "interface", "ready", "error", "retry", "quit", "slow", "footer", "failure", "details"] as const;
export type StartupLabel = typeof startupKeys[number];
type Messages<T extends readonly unknown[]> = { readonly [K in keyof T]: string };

export const startupTranslations = {
  en: ["Starting Music Generator…", "Opening your library…", "Detecting hardware…", "Loading settings…", "Preparing your workspace…", "Ready", "Unable to start", "Try again", "Quit", "Startup is taking longer. You can quit and try again.", "Your music. On your computer.", "Startup could not be completed. Please try again.", "Technical details"],
  de: ["Music Generator wird gestartet…", "Bibliothek wird geöffnet…", "Hardware wird erkannt…", "Einstellungen werden geladen…", "Oberfläche wird vorbereitet…", "Bereit", "Start fehlgeschlagen", "Erneut versuchen", "Beenden", "Der Start dauert länger. Du kannst die App beenden und erneut starten.", "Deine Musik. Auf deinem Computer.", "Der Start konnte nicht abgeschlossen werden. Bitte versuche es erneut.", "Technische Details"],
  es: ["Iniciando Music Generator…", "Abriendo biblioteca…", "Detectando hardware…", "Cargando ajustes…", "Preparando espacio de trabajo…", "Listo", "No se pudo iniciar", "Reintentar", "Salir", "El inicio está tardando. Puedes salir y volver a intentarlo.", "Tu música. En tu ordenador.", "No se pudo completar el inicio. Inténtalo de nuevo.", "Detalles técnicos"],
  fr: ["Démarrage de Music Generator…", "Ouverture de la bibliothèque…", "Détection du matériel…", "Chargement des paramètres…", "Préparation de l’interface…", "Prêt", "Échec du démarrage", "Réessayer", "Quitter", "Le démarrage prend du temps. Vous pouvez quitter et réessayer.", "Votre musique. Sur votre ordinateur.", "Le démarrage n’a pas pu aboutir. Veuillez réessayer.", "Détails techniques"],
  it: ["Avvio di Music Generator…", "Apertura libreria…", "Rilevamento hardware…", "Caricamento impostazioni…", "Preparazione interfaccia…", "Pronto", "Avvio non riuscito", "Riprova", "Esci", "L’avvio sta richiedendo tempo. Puoi uscire e riprovare.", "La tua musica. Sul tuo computer.", "Non è stato possibile completare l’avvio. Riprova.", "Dettagli tecnici"],
  pt: ["Iniciando Music Generator…", "Abrindo biblioteca…", "Detetando hardware…", "Carregando definições…", "Preparando interface…", "Pronto", "Não foi possível iniciar", "Tentar novamente", "Sair", "O arranque está a demorar. Podes sair e tentar novamente.", "A tua música. No teu computador.", "Não foi possível concluir o arranque. Tenta novamente.", "Detalhes técnicos"],
  tr: ["Music Generator başlatılıyor…", "Kitaplık açılıyor…", "Donanım algılanıyor…", "Ayarlar yükleniyor…", "Arayüz hazırlanıyor…", "Hazır", "Başlatılamadı", "Tekrar dene", "Çıkış", "Başlatma uzun sürüyor. Çıkıp tekrar deneyebilirsiniz.", "Müziğiniz. Bilgisayarınızda.", "Başlatma tamamlanamadı. Lütfen tekrar deneyin.", "Teknik ayrıntılar"],
  pl: ["Uruchamianie Music Generator…", "Otwieranie biblioteki…", "Wykrywanie sprzętu…", "Ładowanie ustawień…", "Przygotowywanie interfejsu…", "Gotowe", "Nie udało się uruchomić", "Spróbuj ponownie", "Zakończ", "Uruchamianie trwa dłużej. Możesz zakończyć i spróbować ponownie.", "Twoja muzyka. Na Twoim komputerze.", "Nie udało się zakończyć uruchamiania. Spróbuj ponownie.", "Szczegóły techniczne"],
  ru: ["Запуск Music Generator…", "Открытие библиотеки…", "Определение оборудования…", "Загрузка настроек…", "Подготовка интерфейса…", "Готово", "Не удалось запустить", "Повторить", "Выйти", "Запуск занимает больше времени. Можно выйти и повторить попытку.", "Ваша музыка. На вашем компьютере.", "Не удалось завершить запуск. Повторите попытку.", "Технические сведения"],
  uk: ["Запуск Music Generator…", "Відкриття бібліотеки…", "Визначення обладнання…", "Завантаження налаштувань…", "Підготовка інтерфейсу…", "Готово", "Не вдалося запустити", "Спробувати ще", "Вийти", "Запуск триває довше. Можна вийти та спробувати ще раз.", "Ваша музика. На вашому комп’ютері.", "Не вдалося завершити запуск. Спробуйте ще раз.", "Технічні відомості"],
  ja: ["Music Generatorを起動中…", "ライブラリを開いています…", "ハードウェアを検出中…", "設定を読み込み中…", "画面を準備中…", "準備完了", "起動できませんでした", "再試行", "終了", "起動に時間がかかっています。終了して再試行できます。", "あなたの音楽を、あなたのコンピューターで。", "起動を完了できませんでした。もう一度お試しください。", "技術的な詳細"],
  zh: ["正在启动 Music Generator…", "正在打开曲库…", "正在检测硬件…", "正在加载设置…", "正在准备界面…", "准备就绪", "无法启动", "重试", "退出", "启动时间较长。可以退出后重试。", "你的音乐。在你的电脑上。", "无法完成启动。请重试。", "技术详情"],
} satisfies Record<Language, Messages<typeof startupKeys>>;

export function startupText() {
  const language = preferredLanguage();
  document.documentElement.lang = language;
  return Object.fromEntries(startupKeys.map((key, index) => [key, startupTranslations[language][index]])) as Record<StartupLabel, string>;
}
