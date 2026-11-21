import { I18N } from "./i18n.js";
import type { Language } from "./locales";

const keys = [
  "stem_title", "stem_split", "stem_models", "stem_mixer", "stem_projects", "stem_new",
  "stem_sources", "stem_import", "stem_drop", "stem_full", "stem_goal", "stem_multitrack",
  "stem_vocal_pair", "stem_vocals_only", "stem_instrumental_only", "stem_model",
  "stem_install_engine", "stem_engine_missing_status", "stem_install", "stem_ready", "stem_search_hf",
  "stem_roles", "stem_role_vocals", "stem_role_drums", "stem_role_bass", "stem_role_other",
  "stem_role_guitar", "stem_role_piano", "stem_role_instrumental", "stem_quality", "stem_fast",
  "stem_standard", "stem_advanced", "stem_preview", "stem_continue", "stem_back", "stem_start",
  "stem_result", "stem_project_name", "stem_queued", "stem_running", "stem_done", "stem_error",
  "stem_cancelled", "stem_play", "stem_stop", "stem_original", "stem_mix", "stem_loop",
  "stem_mute", "stem_solo", "stem_mix_version", "stem_export_tracks", "stem_export_mix",
  "stem_export_package", "stem_raw", "stem_processed", "stem_save_version", "stem_export_save",
] as const;

const translated: Record<Exclude<Language, "de" | "en">, string> = {
  es: `Separación de pistas|Separar en pistas|Modelos de separación|Mezclador|Proyectos de pistas|Nueva separación
Fuentes de audio|Importar audio|Suelta aquí los archivos de audio|Canción completa|Objetivo de separación|Varios instrumentos
Voz e instrumental|Aislar la voz|Crear versión instrumental|Modelo
Instalar motor|Requiere el motor|Instalar|Listo|Buscar en Hugging Face
Pistas de salida|Voz|Batería|Bajo|Otro acompañamiento|Guitarra|Piano|Instrumental|Calidad|Rápida
Estándar|Ajustes avanzados|Previsualizar separación|Continuar|Atrás|Poner en cola
Proyecto de salida|Nombre del proyecto|En cola|En curso|Completado|Fallido
Cancelado|Reproducir|Pausar|Original|Mezcla|Repetir selección
Silenciar|Solo|Versión de mezcla|Exportar pistas individuales|Exportar mezcla|Exportar paquete de pistas
Sin procesar|Procesadas|Guardar como nueva versión|Guardar en carpeta`,
  fr: `Séparation de pistes|Séparer en pistes|Modèles de séparation|Mixeur|Projets multipistes|Nouvelle séparation
Sources audio|Importer de l’audio|Déposez les fichiers audio ici|Morceau entier|Objectif de séparation|Plusieurs instruments
Voix et instrumental|Isoler la voix|Créer un instrumental|Modèle
Installer le moteur|Moteur requis|Installer|Prêt|Rechercher sur Hugging Face
Pistes de sortie|Voix|Batterie|Basse|Autre accompagnement|Guitare|Piano|Instrumental|Qualité|Rapide
Standard|Réglages avancés|Aperçu de la séparation|Continuer|Retour|Mettre en file
Projet de sortie|Nom du projet|En attente|En cours|Terminé|Échec
Annulé|Lire|Pause|Original|Mixage|Boucler la sélection
Muet|Solo|Version du mixage|Exporter des pistes|Exporter le mixage|Exporter le lot de pistes
Brutes|Traitées|Enregistrer une nouvelle version|Enregistrer dans un dossier`,
  it: `Separazione delle tracce|Separa in tracce|Modelli di separazione|Mixer|Progetti multitraccia|Nuova separazione
Sorgenti audio|Importa audio|Trascina qui i file audio|Brano intero|Obiettivo della separazione|Più strumenti
Voce e strumentale|Isola la voce|Crea lo strumentale|Modello
Installa il motore|Motore richiesto|Installa|Pronto|Cerca su Hugging Face
Tracce di uscita|Voce|Batteria|Basso|Altro accompagnamento|Chitarra|Pianoforte|Strumentale|Qualità|Rapida
Standard|Impostazioni avanzate|Anteprima della separazione|Continua|Indietro|Metti in coda
Progetto di uscita|Nome del progetto|In coda|In corso|Completato|Non riuscito
Annullato|Riproduci|Pausa|Originale|Mix|Ripeti la selezione
Muto|Solo|Versione del mix|Esporta singole tracce|Esporta mix|Esporta pacchetto di tracce
Originali|Elaborate|Salva come nuova versione|Salva nella cartella`,
  pt: `Separação de faixas|Separar em faixas|Modelos de separação|Mesa de mistura|Projetos multifaixa|Nova separação
Fontes de áudio|Importar áudio|Solte os arquivos de áudio aqui|Música inteira|Objetivo da separação|Vários instrumentos
Voz e instrumental|Isolar a voz|Criar instrumental|Modelo
Instalar motor|Motor necessário|Instalar|Pronto|Pesquisar no Hugging Face
Faixas de saída|Voz|Bateria|Baixo|Outro acompanhamento|Guitarra|Piano|Instrumental|Qualidade|Rápida
Padrão|Configurações avançadas|Prévia da separação|Continuar|Voltar|Colocar na fila
Projeto de saída|Nome do projeto|Na fila|Em andamento|Concluído|Falhou
Cancelado|Reproduzir|Pausar|Original|Mixagem|Repetir seleção
Silenciar|Solo|Versão da mixagem|Exportar faixas individuais|Exportar mixagem|Exportar pacote de faixas
Brutas|Processadas|Salvar como nova versão|Salvar na pasta`,
  tr: `Parça ayırma|Parçalara ayır|Ayırma modelleri|Mikser|Çok kanallı projeler|Yeni ayırma
Ses kaynakları|Ses içe aktar|Ses dosyalarını buraya bırakın|Şarkının tamamı|Ayırma hedefi|Birden çok enstrüman
Vokal ve enstrümantal|Vokali ayır|Enstrümantal oluştur|Model
Motoru yükle|Motor gerekli|Yükle|Hazır|Hugging Face’te ara
Çıkış parçaları|Vokal|Davul|Bas|Diğer eşlik|Gitar|Piyano|Enstrümantal|Kalite|Hızlı
Standart|Gelişmiş ayarlar|Ayırma önizlemesi|Devam|Geri|Kuyruğa ekle
Çıkış projesi|Proje adı|Kuyrukta|İşleniyor|Tamamlandı|Başarısız
İptal edildi|Çal|Duraklat|Orijinal|Miks|Seçimi döngüye al
Sessiz|Solo|Miks sürümü|Parçaları ayrı dışa aktar|Miksi dışa aktar|Parça paketini dışa aktar
Ham|İşlenmiş|Yeni sürüm olarak kaydet|Klasöre kaydet`,
  pl: `Separacja ścieżek|Rozdziel na ścieżki|Modele separacji|Mikser|Projekty wielościeżkowe|Nowa separacja
Źródła dźwięku|Importuj dźwięk|Upuść tutaj pliki audio|Cały utwór|Cel separacji|Wiele instrumentów
Wokal i podkład|Wyizoluj wokal|Utwórz podkład|Model
Zainstaluj silnik|Wymagany silnik|Zainstaluj|Gotowe|Szukaj w Hugging Face
Ścieżki wyjściowe|Wokal|Perkusja|Bas|Pozostały akompaniament|Gitara|Fortepian|Podkład|Jakość|Szybka
Standardowa|Ustawienia zaawansowane|Podgląd separacji|Dalej|Wstecz|Dodaj do kolejki
Projekt wyjściowy|Nazwa projektu|W kolejce|W toku|Ukończono|Niepowodzenie
Anulowano|Odtwórz|Wstrzymaj|Oryginał|Miks|Zapętl zaznaczenie
Wycisz|Solo|Wersja miksu|Eksportuj poszczególne ścieżki|Eksportuj miks|Eksportuj pakiet ścieżek
Surowe|Przetworzone|Zapisz jako nową wersję|Zapisz w folderze`,
  ru: `Разделение на дорожки|Разделить на дорожки|Модели разделения|Микшер|Многодорожечные проекты|Новое разделение
Источники звука|Импортировать аудио|Перетащите аудиофайлы сюда|Вся композиция|Цель разделения|Несколько инструментов
Вокал и инструментал|Выделить вокал|Создать инструментал|Модель
Установить движок|Требуется движок|Установить|Готово|Поиск в Hugging Face
Выходные дорожки|Вокал|Ударные|Бас|Прочий аккомпанемент|Гитара|Фортепиано|Инструментал|Качество|Быстро
Стандартно|Расширенные настройки|Предпрослушивание разделения|Продолжить|Назад|В очередь
Проект результата|Название проекта|В очереди|Выполняется|Завершено|Ошибка
Отменено|Воспроизвести|Пауза|Оригинал|Микс|Зациклить выделение
Заглушить|Соло|Версия микса|Экспорт отдельных дорожек|Экспорт микса|Экспорт пакета дорожек
Исходные|Обработанные|Сохранить новой версией|Сохранить в папку`,
  uk: `Розділення на доріжки|Розділити на доріжки|Моделі розділення|Мікшер|Багатодоріжкові проєкти|Нове розділення
Джерела аудіо|Імпортувати аудіо|Перетягніть аудіофайли сюди|Уся композиція|Мета розділення|Кілька інструментів
Вокал та інструментал|Виділити вокал|Створити інструментал|Модель
Установити рушій|Потрібен рушій|Установити|Готово|Пошук у Hugging Face
Вихідні доріжки|Вокал|Ударні|Бас|Інший акомпанемент|Гітара|Фортепіано|Інструментал|Якість|Швидко
Стандартно|Розширені налаштування|Попереднє прослуховування|Продовжити|Назад|Додати в чергу
Проєкт результату|Назва проєкту|У черзі|Виконується|Завершено|Помилка
Скасовано|Відтворити|Пауза|Оригінал|Мікс|Повторювати виділення
Вимкнути звук|Соло|Версія міксу|Експортувати окремі доріжки|Експортувати мікс|Експортувати пакет доріжок
Початкові|Оброблені|Зберегти як нову версію|Зберегти в папку`,
  ja: `ステム分離|ステムに分離|分離モデル|ミキサー|ステムプロジェクト|新しい分離
音源|音声を読み込む|ここに音声ファイルをドロップ|曲全体|分離の目的|複数の楽器
ボーカルと伴奏|ボーカルを抽出|伴奏を作成|モデル
エンジンをインストール|エンジンが必要|インストール|準備完了|Hugging Faceで検索
出力ステム|ボーカル|ドラム|ベース|その他の伴奏|ギター|ピアノ|伴奏|品質|高速
標準|詳細設定|分離をプレビュー|続ける|戻る|分離をキューに追加
出力プロジェクト|プロジェクト名|待機中|処理中|完了|失敗
キャンセル済み|再生|一時停止|オリジナル|ミックス|選択範囲をループ
ミュート|ソロ|ミックスのバージョン|個別ステムを書き出す|ミックスを書き出す|ステムパッケージを書き出す
未加工|加工済み|新しいバージョンとして保存|フォルダーに保存`,
  zh: `音轨分离|分离音轨|分离模型|混音器|音轨项目|新建分离任务
音频来源|导入音频|将音频文件拖放到此处|整首歌曲|分离目标|多种乐器
人声与伴奏|提取人声|生成伴奏|模型
安装引擎|需要引擎|安装|就绪|在 Hugging Face 上搜索
输出音轨|人声|鼓|贝斯|其他伴奏|吉他|钢琴|伴奏|质量|快速
标准|高级设置|预览分离|继续|返回|加入分离队列
输出项目|项目名称|排队中|处理中|已完成|失败
已取消|播放|暂停|原始音频|混音|循环所选区域
静音|独奏|混音版本|导出单独音轨|导出混音|导出音轨包
原始|已处理|另存为新版本|保存到文件夹`,
};

for (const [language, words] of Object.entries(translated)) {
  const values = words.split(/[|\n]/);
  Object.assign(I18N[language as Language], Object.fromEntries(keys.map((key, index) => [key, values[index]])));
}
