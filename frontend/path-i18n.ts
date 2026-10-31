import { I18N } from "./i18n.js";
import type { Language } from "./locales";

export const pathKeys = [
  "dialog_models", "dialog_songs", "dialog_import_root", "dialog_import_songs", "dialog_audio_import",
  "dialog_export_audio", "dialog_export_lyrics", "dialog_export_zip", "dialog_audio_filter",
  "path_absolute", "path_not_directory", "path_access", "path_unavailable", "path_hint",
  "audio_size", "audio_type", "audio_read", "dialog_failed", "path_hint_plain",
] as const;
export const pathTranslations: Record<Language, readonly string[]> = {
  de: [
    "Modellordner auswählen", "Song-Ordner auswählen", "Bisherige Installation auswählen", "Bisherigen Song-Ordner auswählen", "Audiodatei analysieren",
    "Audio exportieren", "Lyrics exportieren", "Songs als ZIP exportieren", "Audiodateien",
    "Bitte für Modelle und Songs einen absoluten Ordnerpfad eingeben, ohne ~. Beispiel: /Users/name/Modelle oder C:\\Modelle.",
    "Der Pfad verweist auf eine Datei. Bitte einen Ordner angeben.",
    "Kein Ordnerzugriff. Bitte über „Auswählen…“ freigeben oder die Dateirechte prüfen.",
    "Der Ordner ist nicht verfügbar. Bitte einen anderen Ordner auswählen.",
    "Absolute Pfade können direkt eingegeben werden. Neue Ordner werden beim Start der Einrichtung angelegt. Auf macOS müssen externe Ordner gegebenenfalls über „Auswählen…“ freigegeben werden; ein gespeicherter Pfad allein erteilt keinen Zugriff.",
    "Die Audiodatei darf höchstens 60 MiB groß sein.", "Bitte eine WAV-, MP3-, FLAC-, M4A- oder OGG-Datei auswählen.", "Die Audiodatei konnte nicht gelesen werden. Bitte erneut auswählen und die Dateirechte prüfen.", "Der Dateidialog konnte nicht geöffnet werden. Bitte erneut versuchen.",
    "Absolute Pfade können direkt eingegeben werden. Neue Ordner werden beim Start der Einrichtung angelegt.",
  ],
  en: [
    "Choose model folder", "Choose song folder", "Choose previous installation", "Choose previous song folder", "Analyze audio file",
    "Export audio", "Export lyrics", "Export songs as ZIP", "Audio files",
    "Enter absolute folder paths for models and songs, without ~. For example: /Users/name/Models or C:\\Models.", "The path points to a file. Choose a folder.", "Cannot access the folder. Authorize it using Browse or check file permissions.", "The folder is unavailable. Choose another folder.",
    "You can enter absolute paths directly. New folders are created when setup starts. On macOS, external folders may need authorization using Browse; a saved path alone does not grant access.",
    "Audio files must be no larger than 60 MiB.", "Choose a WAV, MP3, FLAC, M4A or OGG file.", "Cannot read the audio file. Select it again and check file permissions.", "Cannot open the file dialog. Please try again.",
    "You can enter absolute paths directly. New folders are created when setup starts.",
  ],
  es: [
    "Elegir carpeta de modelos", "Elegir carpeta de canciones", "Elegir instalación anterior", "Elegir carpeta anterior de canciones", "Analizar archivo de audio",
    "Exportar audio", "Exportar letras", "Exportar canciones como ZIP", "Archivos de audio",
    "Introduce rutas absolutas para modelos y canciones, sin ~. Por ejemplo: /Users/nombre/Modelos o C:\\Modelos.", "La ruta apunta a un archivo. Elige una carpeta.", "No se puede acceder a la carpeta. Autorízala con Examinar o revisa los permisos.", "La carpeta no está disponible. Elige otra.",
    "Puedes introducir rutas absolutas. Las carpetas nuevas se crean al iniciar la configuración. En macOS, las carpetas externas pueden requerir autorización con Examinar; guardar la ruta no concede acceso.",
    "El archivo de audio no debe superar los 60 MiB.", "Elige un archivo WAV, MP3, FLAC, M4A u OGG.", "No se puede leer el audio. Selecciónalo de nuevo y revisa los permisos.", "No se puede abrir el diálogo. Inténtalo de nuevo.",
    "Puedes introducir rutas absolutas. Las carpetas nuevas se crean al iniciar la configuración.",
  ],
  fr: [
    "Choisir le dossier des modèles", "Choisir le dossier des morceaux", "Choisir l’ancienne installation", "Choisir l’ancien dossier des morceaux", "Analyser un fichier audio",
    "Exporter l’audio", "Exporter les paroles", "Exporter les morceaux en ZIP", "Fichiers audio",
    "Saisissez des chemins absolus pour les modèles et morceaux, sans ~. Exemple : /Users/nom/Modeles ou C:\\Modeles.", "Le chemin désigne un fichier. Choisissez un dossier.", "Accès au dossier impossible. Autorisez-le avec Parcourir ou vérifiez les permissions.", "Le dossier est indisponible. Choisissez-en un autre.",
    "Vous pouvez saisir des chemins absolus. Les nouveaux dossiers sont créés au lancement de la configuration. Sous macOS, autorisez si nécessaire les dossiers externes avec Parcourir ; un chemin enregistré ne donne pas accès.",
    "Le fichier audio ne doit pas dépasser 60 Mio.", "Choisissez un fichier WAV, MP3, FLAC, M4A ou OGG.", "Lecture du fichier audio impossible. Sélectionnez-le à nouveau et vérifiez les permissions.", "Impossible d’ouvrir la boîte de dialogue. Réessayez.",
    "Vous pouvez saisir des chemins absolus. Les nouveaux dossiers sont créés au lancement de la configuration.",
  ],
  it: [
    "Scegli cartella dei modelli", "Scegli cartella dei brani", "Scegli installazione precedente", "Scegli precedente cartella dei brani", "Analizza file audio",
    "Esporta audio", "Esporta testo", "Esporta brani come ZIP", "File audio",
    "Inserisci percorsi assoluti per modelli e brani, senza ~. Esempio: /Users/nome/Modelli o C:\\Modelli.", "Il percorso indica un file. Scegli una cartella.", "Accesso alla cartella negato. Autorizzala con Sfoglia o verifica i permessi.", "La cartella non è disponibile. Scegline un’altra.",
    "Puoi inserire percorsi assoluti. Le nuove cartelle vengono create all’avvio della configurazione. Su macOS, autorizza se necessario le cartelle esterne con Sfoglia; un percorso salvato non concede accesso.",
    "Il file audio non deve superare 60 MiB.", "Scegli un file WAV, MP3, FLAC, M4A o OGG.", "Impossibile leggere il file audio. Selezionalo di nuovo e verifica i permessi.", "Impossibile aprire la finestra di selezione. Riprova.",
    "Puoi inserire percorsi assoluti. Le nuove cartelle vengono create all’avvio della configurazione.",
  ],
  pt: [
    "Escolher pasta de modelos", "Escolher pasta de músicas", "Escolher instalação anterior", "Escolher pasta anterior de músicas", "Analisar ficheiro de áudio",
    "Exportar áudio", "Exportar letras", "Exportar músicas como ZIP", "Ficheiros de áudio",
    "Introduza caminhos absolutos para modelos e músicas, sem ~. Exemplo: /Users/nome/Modelos ou C:\\Modelos.", "O caminho aponta para um ficheiro. Escolha uma pasta.", "Sem acesso à pasta. Autorize com Procurar ou verifique as permissões.", "A pasta não está disponível. Escolha outra.",
    "Pode introduzir caminhos absolutos. Novas pastas são criadas ao iniciar a configuração. No macOS, pastas externas podem precisar de autorização com Procurar; guardar o caminho não concede acesso.",
    "O ficheiro de áudio não pode exceder 60 MiB.", "Escolha um ficheiro WAV, MP3, FLAC, M4A ou OGG.", "Não foi possível ler o áudio. Selecione-o novamente e verifique as permissões.", "Não foi possível abrir o diálogo. Tente novamente.",
    "Pode introduzir caminhos absolutos. Novas pastas são criadas ao iniciar a configuração.",
  ],
  tr: [
    "Model klasörünü seç", "Şarkı klasörünü seç", "Önceki kurulumu seç", "Önceki şarkı klasörünü seç", "Ses dosyasını analiz et",
    "Sesi dışa aktar", "Sözleri dışa aktar", "Şarkıları ZIP olarak dışa aktar", "Ses dosyaları",
    "Model ve şarkı klasörleri için ~ olmadan mutlak yol girin. Örnek: /Users/ad/Modeller veya C:\\Modeller.", "Yol bir dosyayı gösteriyor. Bir klasör seçin.", "Klasöre erişilemiyor. Gözat ile izin verin veya dosya izinlerini kontrol edin.", "Klasör kullanılamıyor. Başka bir klasör seçin.",
    "Mutlak yolları doğrudan girebilirsiniz. Yeni klasörler kurulum başladığında oluşturulur. macOS’ta dış klasörler için Gözat ile izin gerekebilir; kayıtlı yol tek başına erişim sağlamaz.",
    "Ses dosyası en fazla 60 MiB olabilir.", "WAV, MP3, FLAC, M4A veya OGG dosyası seçin.", "Ses dosyası okunamıyor. Yeniden seçin ve dosya izinlerini kontrol edin.", "Dosya iletişim kutusu açılamıyor. Yeniden deneyin.",
    "Mutlak yolları doğrudan girebilirsiniz. Yeni klasörler kurulum başladığında oluşturulur.",
  ],
  pl: [
    "Wybierz folder modeli", "Wybierz folder utworów", "Wybierz poprzednią instalację", "Wybierz poprzedni folder utworów", "Analizuj plik audio",
    "Eksportuj audio", "Eksportuj tekst", "Eksportuj utwory jako ZIP", "Pliki audio",
    "Podaj bezwzględne ścieżki folderów modeli i utworów, bez ~. Przykład: /Users/nazwa/Modele lub C:\\Modele.", "Ścieżka wskazuje plik. Wybierz folder.", "Brak dostępu do folderu. Przyznaj go przez Przeglądaj lub sprawdź uprawnienia.", "Folder jest niedostępny. Wybierz inny.",
    "Możesz wpisywać ścieżki bezwzględne. Nowe foldery powstaną przy rozpoczęciu konfiguracji. W macOS foldery zewnętrzne mogą wymagać zgody przez Przeglądaj; zapisana ścieżka nie daje dostępu.",
    "Plik audio nie może przekraczać 60 MiB.", "Wybierz plik WAV, MP3, FLAC, M4A lub OGG.", "Nie można odczytać audio. Wybierz plik ponownie i sprawdź uprawnienia.", "Nie można otworzyć okna wyboru. Spróbuj ponownie.",
    "Możesz wpisywać ścieżki bezwzględne. Nowe foldery powstaną przy rozpoczęciu konfiguracji.",
  ],
  ru: [
    "Выбрать папку моделей", "Выбрать папку песен", "Выбрать прежнюю установку", "Выбрать прежнюю папку песен", "Анализ аудиофайла",
    "Экспорт аудио", "Экспорт текста", "Экспорт песен в ZIP", "Аудиофайлы",
    "Введите абсолютные пути к папкам моделей и песен без ~. Например: /Users/имя/Модели или C:\\Модели.", "Путь указывает на файл. Выберите папку.", "Нет доступа к папке. Разрешите его через «Обзор» или проверьте права.", "Папка недоступна. Выберите другую.",
    "Можно вводить абсолютные пути. Новые папки создаются при запуске настройки. В macOS внешние папки могут требовать разрешения через «Обзор»; сохранённый путь сам по себе не даёт доступа.",
    "Размер аудиофайла не должен превышать 60 МиБ.", "Выберите файл WAV, MP3, FLAC, M4A или OGG.", "Не удалось прочитать аудиофайл. Выберите его снова и проверьте права.", "Не удалось открыть диалог выбора. Повторите попытку.",
    "Можно вводить абсолютные пути. Новые папки создаются при запуске настройки.",
  ],
  uk: [
    "Вибрати папку моделей", "Вибрати папку пісень", "Вибрати попереднє встановлення", "Вибрати попередню папку пісень", "Аналіз аудіофайлу",
    "Експорт аудіо", "Експорт тексту", "Експорт пісень у ZIP", "Аудіофайли",
    "Введіть абсолютні шляхи до папок моделей і пісень без ~. Наприклад: /Users/ім’я/Моделі або C:\\Моделі.", "Шлях указує на файл. Виберіть папку.", "Немає доступу до папки. Дозвольте його через «Огляд» або перевірте права.", "Папка недоступна. Виберіть іншу.",
    "Можна вводити абсолютні шляхи. Нові папки створюються на початку налаштування. У macOS зовнішні папки можуть потребувати дозволу через «Огляд»; збережений шлях сам собою не надає доступу.",
    "Розмір аудіофайлу не має перевищувати 60 МіБ.", "Виберіть файл WAV, MP3, FLAC, M4A або OGG.", "Не вдалося прочитати аудіофайл. Виберіть його знову та перевірте права.", "Не вдалося відкрити діалог вибору. Спробуйте ще раз.",
    "Можна вводити абсолютні шляхи. Нові папки створюються на початку налаштування.",
  ],
  ja: [
    "モデルフォルダーを選択", "曲フォルダーを選択", "以前のインストール先を選択", "以前の曲フォルダーを選択", "音声ファイルを解析",
    "音声を書き出す", "歌詞を書き出す", "曲をZIPで書き出す", "音声ファイル",
    "モデルと曲には ~ を使わず絶対パスを入力してください。例：/Users/name/Models または C:\\Models。", "パスはファイルを指しています。フォルダーを選択してください。", "フォルダーにアクセスできません。「参照」で許可するか、アクセス権を確認してください。", "フォルダーを利用できません。別のフォルダーを選択してください。",
    "絶対パスを直接入力できます。新しいフォルダーはセットアップ開始時に作成されます。macOSでは外部フォルダーに「参照」で許可が必要な場合があります。保存したパスだけではアクセスできません。",
    "音声ファイルは60 MiB以下にしてください。", "WAV、MP3、FLAC、M4A、OGGファイルを選択してください。", "音声ファイルを読み込めません。再選択してアクセス権を確認してください。", "ファイル選択を開けません。もう一度お試しください。",
    "絶対パスを直接入力できます。新しいフォルダーはセットアップ開始時に作成されます。",
  ],
  zh: [
    "选择模型文件夹", "选择歌曲文件夹", "选择之前的安装目录", "选择之前的歌曲文件夹", "分析音频文件",
    "导出音频", "导出歌词", "将歌曲导出为ZIP", "音频文件",
    "请输入模型和歌曲文件夹的绝对路径，不使用 ~。例如：/Users/name/Models 或 C:\\Models。", "路径指向文件。请选择文件夹。", "无法访问文件夹。请通过“浏览”授权或检查文件权限。", "文件夹不可用。请选择其他文件夹。",
    "可直接输入绝对路径。新文件夹将在开始设置时创建。在macOS上，外部文件夹可能需要通过“浏览”授权；保存路径本身不会授予访问权限。",
    "音频文件不能超过60 MiB。", "请选择WAV、MP3、FLAC、M4A或OGG文件。", "无法读取音频文件。请重新选择并检查文件权限。", "无法打开文件选择对话框。请重试。",
    "可直接输入绝对路径。新文件夹将在开始设置时创建。",
  ],
};

for (const [language, messages] of Object.entries(pathTranslations)) {
  Object.assign(I18N[language as Language], Object.fromEntries(pathKeys.map((key, index) => [key, messages[index]])));
}
