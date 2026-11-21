import { I18N } from "./i18n.js";
import type { Language } from "./locales";

const keys = [
  "settings_page_engines", "settings_description_engines", "engine_refresh", "engine_install",
  "engine_update", "engine_update_available", "engine_installing", "engine_cancelled",
  "engine_package_unavailable", "engine_package_invalid", "engine_install_required",
  "engine_manual", "setup_without_engines",
] as const;

const labels: Record<Language, readonly string[]> = {
  de: ["Engines", "Installiere und aktualisiere die Engines für Musikerzeugung und Spurtrennung.", "Status aktualisieren", "Installieren", "Aktualisieren", "Update verfügbar", "Engine wird installiert …", "Download abgebrochen.", "Für diese App-Version sind keine Engine-Pakete verfügbar.", "Das Engine-Paket konnte nicht verifiziert werden.", "Installiere zuerst die passende Engine in den Einstellungen.", "Führe diesen Befehl im Terminal aus und aktualisiere danach den Status.", "Ohne Engines fortfahren"],
  en: ["Engines", "Install and update the engines for music generation and stem separation.", "Refresh status", "Install", "Update", "Update available", "Installing engine…", "Download cancelled.", "No engine packages are available for this app build.", "The engine package could not be verified.", "Install the required engine in Settings first.", "Run this command in Terminal, then refresh the status.", "Continue without engines"],
  es: ["Motores", "Instala y actualiza los motores para generar música y separar pistas.", "Actualizar estado", "Instalar", "Actualizar", "Actualización disponible", "Instalando motor…", "Descarga cancelada.", "No hay paquetes de motores para esta compilación.", "No se pudo verificar el paquete del motor.", "Instala primero el motor necesario en Ajustes.", "Ejecuta el comando en Terminal y actualiza el estado.", "Continuar sin motores"],
  fr: ["Moteurs", "Installez et mettez à jour les moteurs de génération musicale et de séparation de pistes.", "Actualiser l’état", "Installer", "Mettre à jour", "Mise à jour disponible", "Installation du moteur…", "Téléchargement annulé.", "Aucun paquet de moteur disponible pour cette version.", "Le paquet du moteur n’a pas pu être vérifié.", "Installez d’abord le moteur requis dans les paramètres.", "Exécutez cette commande dans Terminal, puis actualisez l’état.", "Continuer sans moteur"],
  it: ["Motori", "Installa e aggiorna i motori per la generazione musicale e la separazione delle tracce.", "Aggiorna stato", "Installa", "Aggiorna", "Aggiornamento disponibile", "Installazione del motore…", "Download annullato.", "Non ci sono pacchetti per i motori in questa versione.", "Impossibile verificare il pacchetto del motore.", "Installa prima il motore richiesto nelle impostazioni.", "Esegui il comando nel Terminale e aggiorna lo stato.", "Continua senza motori"],
  pt: ["Motores", "Instala e atualiza os motores para geração musical e separação de faixas.", "Atualizar estado", "Instalar", "Atualizar", "Atualização disponível", "A instalar o motor…", "Transferência cancelada.", "Não há pacotes de motores para esta versão.", "Não foi possível verificar o pacote do motor.", "Instale primeiro o motor necessário nas definições.", "Execute este comando no Terminal e atualize o estado.", "Continuar sem motores"],
  tr: ["Motorlar", "Müzik üretimi ve parça ayırma motorlarını kurun ve güncelleyin.", "Durumu yenile", "Kur", "Güncelle", "Güncelleme var", "Motor kuruluyor…", "İndirme iptal edildi.", "Bu sürüm için motor paketi yok.", "Motor paketi doğrulanamadı.", "Önce Ayarlar’dan gerekli motoru kurun.", "Bu komutu Terminal’de çalıştırın ve durumu yenileyin.", "Motor kurmadan devam et"],
  pl: ["Silniki", "Instaluj i aktualizuj silniki do generowania muzyki i rozdzielania ścieżek.", "Odśwież stan", "Zainstaluj", "Zaktualizuj", "Dostępna aktualizacja", "Instalowanie silnika…", "Pobieranie anulowane.", "Brak pakietów silników dla tej wersji.", "Nie udało się zweryfikować pakietu silnika.", "Najpierw zainstaluj wymagany silnik w ustawieniach.", "Uruchom to polecenie w Terminalu, a potem odśwież stan.", "Kontynuuj bez silników"],
  ru: ["Движки", "Устанавливайте и обновляйте движки для генерации музыки и разделения дорожек.", "Обновить статус", "Установить", "Обновить", "Доступно обновление", "Установка движка…", "Загрузка отменена.", "Для этой сборки нет пакетов движков.", "Не удалось проверить пакет движка.", "Сначала установите нужный движок в настройках.", "Выполните команду в Терминале и обновите статус.", "Продолжить без движков"],
  uk: ["Рушії", "Встановлюйте й оновлюйте рушії для генерації музики та розділення доріжок.", "Оновити стан", "Встановити", "Оновити", "Доступне оновлення", "Встановлення рушія…", "Завантаження скасовано.", "Для цієї збірки немає пакетів рушіїв.", "Не вдалося перевірити пакет рушія.", "Спочатку встановіть потрібний рушій у налаштуваннях.", "Виконайте команду в Терміналі й оновіть стан.", "Продовжити без рушіїв"],
  ja: ["エンジン", "音楽生成と音源分離に使うエンジンをインストール・更新します。", "状態を更新", "インストール", "更新", "更新があります", "エンジンをインストール中…", "ダウンロードをキャンセルしました。", "このビルド用のエンジンパッケージはありません。", "エンジンパッケージを検証できませんでした。", "先に設定で必要なエンジンをインストールしてください。", "ターミナルでこのコマンドを実行し、状態を更新してください。", "エンジンなしで続ける"],
  zh: ["引擎", "安装和更新用于音乐生成和音轨分离的引擎。", "刷新状态", "安装", "更新", "有可用更新", "正在安装引擎…", "下载已取消。", "此版本没有可用的引擎包。", "无法验证引擎包。", "请先在设置中安装所需的引擎。", "在终端运行此命令，然后刷新状态。", "不安装引擎，继续"],
};

for (const [language, values] of Object.entries(labels)) {
  Object.assign(I18N[language as Language], Object.fromEntries(keys.map((key, index) => [key, values[index]])));
}

const importLabels: Record<Language, string> = {
  de: "Engine aus ZIP installieren …", en: "Install engine from ZIP…", es: "Instalar motor desde ZIP…",
  fr: "Installer un moteur depuis un ZIP…", it: "Installa motore da ZIP…", pt: "Instalar motor a partir de ZIP…",
  tr: "ZIP’ten motor kur…", pl: "Zainstaluj silnik z ZIP…", ru: "Установить движок из ZIP…",
  uk: "Встановити рушій із ZIP…", ja: "ZIP からエンジンをインストール…", zh: "从 ZIP 安装引擎…",
};
for (const [language, label] of Object.entries(importLabels)) Object.assign(I18N[language as Language], { engine_import: label });

const removalLabels: Record<Language, [string, string]> = {
  de: ["Entfernen", "Engine wird entfernt …"],
  en: ["Remove", "Removing engine…"],
  es: ["Eliminar", "Eliminando motor…"],
  fr: ["Supprimer", "Suppression du moteur…"],
  it: ["Rimuovi", "Rimozione del motore…"],
  pt: ["Remover", "A remover o motor…"],
  tr: ["Kaldır", "Motor kaldırılıyor…"],
  pl: ["Usuń", "Usuwanie silnika…"],
  ru: ["Удалить", "Удаление движка…"],
  uk: ["Видалити", "Видалення рушія…"],
  ja: ["削除", "エンジンを削除中…"],
  zh: ["移除", "正在移除引擎…"],
};
for (const [language, [remove, removing]] of Object.entries(removalLabels)) {
  Object.assign(I18N[language as Language], { engine_remove: remove, engine_removing: removing });
}

const versionLabels: Record<Language, [string, string]> = {
  de: ["Installierte Version", "Verfügbare Version"],
  en: ["Installed version", "Available version"],
  es: ["Versión instalada", "Versión disponible"],
  fr: ["Version installée", "Version disponible"],
  it: ["Versione installata", "Versione disponibile"],
  pt: ["Versão instalada", "Versão disponível"],
  tr: ["Yüklü sürüm", "Kullanılabilir sürüm"],
  pl: ["Zainstalowana wersja", "Dostępna wersja"],
  ru: ["Установленная версия", "Доступная версия"],
  uk: ["Встановлена версія", "Доступна версія"],
  ja: ["インストール済みのバージョン", "利用可能なバージョン"],
  zh: ["已安装版本", "可用版本"],
};
for (const [language, [installed, available]] of Object.entries(versionLabels)) {
  Object.assign(I18N[language as Language], {
    engine_version_installed: installed, engine_version_available: available,
  });
}
