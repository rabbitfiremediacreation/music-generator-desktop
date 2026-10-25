const labels = {
  en: ["Starting Music Generator…", "Opening your library…", "Detecting hardware…", "Loading settings…", "Preparing your workspace…", "Ready", "Unable to start", "Try again", "Quit", "Startup is taking longer. You can quit and try again.", "Your music. On your computer."],
  de: ["Music Generator wird gestartet…", "Bibliothek wird geöffnet…", "Hardware wird erkannt…", "Einstellungen werden geladen…", "Oberfläche wird vorbereitet…", "Bereit", "Start fehlgeschlagen", "Erneut versuchen", "Beenden", "Der Start dauert länger. Du kannst die App beenden und erneut starten.", "Deine Musik. Auf deinem Computer."],
  es: ["Iniciando Music Generator…", "Abriendo biblioteca…", "Detectando hardware…", "Cargando ajustes…", "Preparando espacio de trabajo…", "Listo", "No se pudo iniciar", "Reintentar", "Salir", "El inicio está tardando. Puedes salir y volver a intentarlo.", "Tu música. En tu ordenador."],
  fr: ["Démarrage de Music Generator…", "Ouverture de la bibliothèque…", "Détection du matériel…", "Chargement des paramètres…", "Préparation de l’interface…", "Prêt", "Échec du démarrage", "Réessayer", "Quitter", "Le démarrage prend du temps. Vous pouvez quitter et réessayer.", "Votre musique. Sur votre ordinateur."],
  it: ["Avvio di Music Generator…", "Apertura libreria…", "Rilevamento hardware…", "Caricamento impostazioni…", "Preparazione interfaccia…", "Pronto", "Avvio non riuscito", "Riprova", "Esci", "L’avvio sta richiedendo tempo. Puoi uscire e riprovare.", "La tua musica. Sul tuo computer."],
  pt: ["Iniciando Music Generator…", "Abrindo biblioteca…", "Detetando hardware…", "Carregando definições…", "Preparando interface…", "Pronto", "Não foi possível iniciar", "Tentar novamente", "Sair", "O arranque está a demorar. Podes sair e tentar novamente.", "A tua música. No teu computador."],
  tr: ["Music Generator başlatılıyor…", "Kitaplık açılıyor…", "Donanım algılanıyor…", "Ayarlar yükleniyor…", "Arayüz hazırlanıyor…", "Hazır", "Başlatılamadı", "Tekrar dene", "Çıkış", "Başlatma uzun sürüyor. Çıkıp tekrar deneyebilirsiniz.", "Müziğiniz. Bilgisayarınızda."],
  pl: ["Uruchamianie Music Generator…", "Otwieranie biblioteki…", "Wykrywanie sprzętu…", "Ładowanie ustawień…", "Przygotowywanie interfejsu…", "Gotowe", "Nie udało się uruchomić", "Spróbuj ponownie", "Zakończ", "Uruchamianie trwa dłużej. Możesz zakończyć i spróbować ponownie.", "Twoja muzyka. Na Twoim komputerze."],
  ru: ["Запуск Music Generator…", "Открытие библиотеки…", "Определение оборудования…", "Загрузка настроек…", "Подготовка интерфейса…", "Готово", "Не удалось запустить", "Повторить", "Выйти", "Запуск занимает больше времени. Можно выйти и повторить попытку.", "Ваша музыка. На вашем компьютере."],
  uk: ["Запуск Music Generator…", "Відкриття бібліотеки…", "Визначення обладнання…", "Завантаження налаштувань…", "Підготовка інтерфейсу…", "Готово", "Не вдалося запустити", "Спробувати ще", "Вийти", "Запуск триває довше. Можна вийти та спробувати ще раз.", "Ваша музика. На вашому комп’ютері."],
  ja: ["Music Generatorを起動中…", "ライブラリを開いています…", "ハードウェアを検出中…", "設定を読み込み中…", "画面を準備中…", "準備完了", "起動できませんでした", "再試行", "終了", "起動に時間がかかっています。終了して再試行できます。", "あなたの音楽を、あなたのコンピューターで。"],
  zh: ["正在启动 Music Generator…", "正在打开曲库…", "正在检测硬件…", "正在加载设置…", "正在准备界面…", "准备就绪", "无法启动", "重试", "退出", "启动时间较长。可以退出后重试。", "你的音乐。在你的电脑上。"],
} satisfies Record<string, string[]>;
const keys = ["starting", "data", "hardware", "settings", "interface", "ready", "error", "retry", "quit", "slow", "footer"] as const;
export type StartupLabel = typeof keys[number];

export function startupText() {
  let language = navigator.language.split("-")[0];
  try { language = localStorage.getItem("ui_lang") || language; } catch { /* System language remains available without storage. */ }
  const values = labels[language as keyof typeof labels] || labels.en;
  document.documentElement.lang = language in labels ? language : "en";
  return Object.fromEntries(keys.map((key, index) => [key, values[index]])) as Record<StartupLabel, string>;
}
