import { I18N } from "./i18n.js";
import type { Language } from "./locales";

// Texts match the web app's phone access so both apps read the same.
const nativeKeys = ["remote", "remote_tip", "remote_off", "remote_on", "remote_scan", "remote_addr", "remote_token", "remote_new", "remote_hint", "remote_port_busy", "remote_failed"] as const;
const webKeys = ["remote_native", "remote_web", "remote_web_scan", "remote_certificate"] as const;
const tlsKeys = ["remote_https_port_busy", "remote_tls_failed"] as const;
export const phoneAccessKeys = [...nativeKeys, ...webKeys, ...tlsKeys] as const;
type Texts = readonly [string, string, string, string, string, string, string, string, string, (port: number) => string, string];
export const phoneAccessTranslations: Record<Language, Texts> = {
  de: ["Handy-Zugriff", "Erlaubt der iPhone-App und der Web-App, im Heimnetz die Bibliothek abzuspielen und Songs zu erzeugen. Nur mit Zugangsschlüssel.", "Aus", "An", "Mit der iPhone-Kamera scannen, die App übernimmt Adresse und Schlüssel:", "In der App unter „Verbindung“ eintragen:", "Zugangsschlüssel", "Neuer Schlüssel", "Gilt sofort. Der Rechner darf dabei nicht schlafen.", port => `Handy-Zugriff ließ sich nicht starten: Port ${port} ist belegt.`, "Handy-Zugriff konnte nicht geändert werden."],
  en: ["Phone access", "Lets the iPhone app and web app play the library and create songs on your home network. Only with the access key.", "Off", "On", "Scan with the iPhone camera, the app takes over address and key:", "Enter in the app under “Connection”:", "Access key", "New key", "Applies immediately. The computer must not go to sleep.", port => `Phone access could not start: port ${port} is in use.`, "Could not change phone access."],
  es: ["Acceso desde el móvil", "Permite que la app de iPhone y la app web reproduzcan la biblioteca y creen canciones en tu red doméstica. Solo con la clave de acceso.", "Desactivado", "Activado", "Escanéalo con la cámara del iPhone; la app toma la dirección y la clave:", "Introdúcelo en la app en «Conexión»:", "Clave de acceso", "Nueva clave", "Se aplica al instante. El ordenador no debe entrar en reposo.", port => `No se pudo iniciar el acceso desde el móvil: el puerto ${port} está ocupado.`, "No se pudo cambiar el acceso desde el móvil."],
  fr: ["Accès mobile", "Permet aux apps iPhone et web de lire la bibliothèque et de créer des morceaux sur le réseau domestique. Uniquement avec la clé d’accès.", "Désactivé", "Activé", "Scanne avec l'appareil photo de l'iPhone, l'app reprend l'adresse et la clé :", "À saisir dans l'app sous « Connexion » :", "Clé d'accès", "Nouvelle clé", "Effet immédiat. L'ordinateur ne doit pas se mettre en veille.", port => `Impossible de démarrer l'accès mobile : le port ${port} est occupé.`, "Impossible de modifier l'accès mobile."],
  it: ["Accesso dal telefono", "Consente alle app per iPhone e web di riprodurre la libreria e creare brani nella rete di casa. Solo con la chiave di accesso.", "Disattivato", "Attivato", "Scansiona con la fotocamera dell'iPhone, l'app prende indirizzo e chiave:", "Inseriscilo nell'app in «Connessione»:", "Chiave di accesso", "Nuova chiave", "Vale subito. Il computer non deve andare in stop.", port => `Impossibile avviare l'accesso dal telefono: la porta ${port} è occupata.`, "Impossibile modificare l'accesso dal telefono."],
  pt: ["Acesso pelo celular", "Permite que os apps de iPhone e web toquem a biblioteca e criem músicas na rede de casa. Só com a chave de acesso.", "Desligado", "Ligado", "Escaneie com a câmera do iPhone, o app assume endereço e chave:", "Digite no app em «Conexão»:", "Chave de acesso", "Nova chave", "Vale na hora. O computador não pode entrar em repouso.", port => `Não foi possível iniciar o acesso do celular: a porta ${port} está em uso.`, "Não foi possível alterar o acesso do celular."],
  tr: ["Telefon erişimi", "iPhone ve web uygulamalarının ev ağında kitaplığı çalmasına ve şarkı oluşturmasına izin verir. Yalnızca erişim anahtarıyla.", "Kapalı", "Açık", "iPhone kamerasıyla tara, uygulama adresi ve anahtarı alır:", "Uygulamada «Bağlantı» altına gir:", "Erişim anahtarı", "Yeni anahtar", "Hemen geçerli olur. Bilgisayar uyku moduna geçmemeli.", port => `Telefon erişimi başlatılamadı: ${port} numaralı port kullanımda.`, "Telefon erişimi değiştirilemedi."],
  pl: ["Dostęp z telefonu", "Pozwala aplikacjom iPhone i WWW odtwarzać bibliotekę i tworzyć utwory w sieci domowej. Tylko z kluczem dostępu.", "Wył.", "Wł.", "Zeskanuj aparatem iPhone'a, aplikacja przejmie adres i klucz:", "Wpisz w aplikacji w „Połączenie”:", "Klucz dostępu", "Nowy klucz", "Działa od razu. Komputer nie może przejść w uśpienie.", port => `Nie udało się uruchomić dostępu z telefonu: port ${port} jest zajęty.`, "Nie udało się zmienić dostępu z telefonu."],
  ru: ["Доступ с телефона", "Позволяет приложениям iPhone и веб воспроизводить библиотеку и создавать песни в домашней сети. Только с ключом доступа.", "Выкл.", "Вкл.", "Отсканируй камерой iPhone, приложение возьмёт адрес и ключ:", "Введи в приложении в разделе «Подключение»:", "Ключ доступа", "Новый ключ", "Действует сразу. Компьютер не должен уходить в сон.", port => `Не удалось включить доступ с телефона: порт ${port} занят.`, "Не удалось изменить доступ с телефона."],
  uk: ["Доступ із телефона", "Дозволяє застосункам iPhone і веб відтворювати бібліотеку та створювати пісні в домашній мережі. Лише з ключем доступу.", "Вимк.", "Увімк.", "Відскануй камерою iPhone, застосунок візьме адресу й ключ:", "Введи в застосунку в розділі «Підключення»:", "Ключ доступу", "Новий ключ", "Діє одразу. Комп'ютер не має переходити в сон.", port => `Не вдалося увімкнути доступ із телефона: порт ${port} зайнятий.`, "Не вдалося змінити доступ із телефона."],
  ja: ["スマホからのアクセス", "自宅のネットワークで iPhone アプリと Web アプリからライブラリの再生と曲の作成ができるようにします。アクセスキーが必要です。", "オフ", "オン", "iPhone のカメラでスキャンすると、アプリがアドレスとキーを読み込みます:", "アプリの「接続」に入力:", "アクセスキー", "新しいキー", "すぐに有効になります。コンピューターをスリープさせないでください。", port => `スマホからのアクセスを開始できません: ポート ${port} は使用中です。`, "スマホからのアクセスを変更できませんでした。"],
  zh: ["手机访问", "允许 iPhone 应用和 Web 应用在家庭网络中播放资料库并生成歌曲。需要访问密钥。", "关", "开", "用 iPhone 相机扫描, 应用会自动填入地址和密钥:", "在应用的“连接”中填写:", "访问密钥", "新密钥", "立即生效。电脑不能进入睡眠。", port => `无法启动手机访问: 端口 ${port} 已被占用。`, "无法更改手机访问。"],
};
for (const [language, values] of Object.entries(phoneAccessTranslations)) {
  if (values.length !== nativeKeys.length) throw new Error(`Incomplete phone access translation: ${language}`);
  Object.assign(I18N[language as Language], Object.fromEntries(nativeKeys.map((key, index) => [key, values[index]])));
}

const webTranslations: Record<Language, readonly [string, string, string, string]> = {
  de: ["iPhone-App", "Web-App / PWA", "Im Browser öffnen. Einmalig das lokale Zertifikat einrichten, dann die HTTPS-App zum Home-Bildschirm hinzufügen.", "Zertifikat-Fingerabdruck (SHA-256):"],
  en: ["iPhone app", "Web app / PWA", "Open in the browser. Set up the local certificate once, then add the HTTPS app to your home screen.", "Certificate fingerprint (SHA-256):"],
  es: ["App de iPhone", "App web / PWA", "Abre en el navegador. Configura el certificado local una vez y añade la app HTTPS a la pantalla de inicio.", "Huella del certificado (SHA-256):"],
  fr: ["App iPhone", "App web / PWA", "Ouvrir dans le navigateur. Configure le certificat local une fois, puis ajoute l’app HTTPS à l’écran d’accueil.", "Empreinte du certificat (SHA-256) :"],
  it: ["App iPhone", "App web / PWA", "Apri nel browser. Configura una volta il certificato locale, poi aggiungi l’app HTTPS alla schermata Home.", "Impronta del certificato (SHA-256):"],
  pt: ["App de iPhone", "App web / PWA", "Abra no navegador. Configure o certificado local uma vez e adicione o app HTTPS à tela inicial.", "Impressão digital do certificado (SHA-256):"],
  tr: ["iPhone uygulaması", "Web uygulaması / PWA", "Tarayıcıda aç. Yerel sertifikayı bir kez ayarla, ardından HTTPS uygulamasını ana ekrana ekle.", "Sertifika parmak izi (SHA-256):"],
  pl: ["Aplikacja iPhone", "Aplikacja WWW / PWA", "Otwórz w przeglądarce. Skonfiguruj lokalny certyfikat, a następnie dodaj aplikację HTTPS do ekranu głównego.", "Odcisk certyfikatu (SHA-256):"],
  ru: ["Приложение iPhone", "Веб-приложение / PWA", "Открой в браузере. Один раз настрой локальный сертификат и добавь HTTPS-приложение на главный экран.", "Отпечаток сертификата (SHA-256):"],
  uk: ["Застосунок iPhone", "Вебзастосунок / PWA", "Відкрий у браузері. Один раз налаштуй локальний сертифікат і додай HTTPS-застосунок на головний екран.", "Відбиток сертифіката (SHA-256):"],
  ja: ["iPhone アプリ", "Web アプリ / PWA", "ブラウザーで開きます。ローカル証明書を一度設定してから、HTTPS アプリをホーム画面に追加してください。", "証明書のフィンガープリント (SHA-256):"],
  zh: ["iPhone 应用", "Web 应用 / PWA", "在浏览器中打开。先设置一次本地证书，再将 HTTPS 应用添加到主屏幕。", "证书指纹 (SHA-256):"],
};
for (const [language, values] of Object.entries(webTranslations)) {
  Object.assign(I18N[language as Language], Object.fromEntries(webKeys.map((key, index) => [key, values[index]])));
}
const tlsTranslations: Record<Language, readonly [(port: number) => string, string]> = {
  de: [port => `Handy-Zugriff ließ sich nicht starten: HTTPS-Port ${port} ist belegt.`, "Das lokale HTTPS-Zertifikat konnte nicht eingerichtet werden. Bitte den Zugriff erneut einschalten."],
  en: [port => `Phone access could not start: HTTPS port ${port} is in use.`, "The local HTTPS certificate could not be set up. Try enabling access again."],
  es: [port => `No se pudo iniciar el acceso: el puerto HTTPS ${port} está ocupado.`, "No se pudo configurar el certificado HTTPS local. Intenta activar el acceso de nuevo."],
  fr: [port => `Impossible d’activer l’accès : le port HTTPS ${port} est occupé.`, "Impossible de configurer le certificat HTTPS local. Réessaie d’activer l’accès."],
  it: [port => `Impossibile avviare l’accesso: la porta HTTPS ${port} è occupata.`, "Impossibile configurare il certificato HTTPS locale. Prova a riattivare l’accesso."],
  pt: [port => `Não foi possível iniciar o acesso: a porta HTTPS ${port} está em uso.`, "Não foi possível configurar o certificado HTTPS local. Tente ativar o acesso novamente."],
  tr: [port => `Erişim başlatılamadı: HTTPS ${port} bağlantı noktası kullanımda.`, "Yerel HTTPS sertifikası ayarlanamadı. Erişimi yeniden açmayı dene."],
  pl: [port => `Nie można uruchomić dostępu: port HTTPS ${port} jest zajęty.`, "Nie udało się skonfigurować lokalnego certyfikatu HTTPS. Spróbuj ponownie włączyć dostęp."],
  ru: [port => `Не удалось включить доступ: порт HTTPS ${port} занят.`, "Не удалось настроить локальный сертификат HTTPS. Попробуй включить доступ снова."],
  uk: [port => `Не вдалося увімкнути доступ: порт HTTPS ${port} зайнятий.`, "Не вдалося налаштувати локальний сертифікат HTTPS. Спробуй знову увімкнути доступ."],
  ja: [port => `アクセスを開始できません: HTTPS ポート ${port} は使用中です。`, "ローカル HTTPS 証明書を設定できませんでした。もう一度アクセスを有効にしてください。"],
  zh: [port => `无法启动访问: HTTPS 端口 ${port} 已被占用。`, "无法设置本地 HTTPS 证书。请尝试重新启用访问。"],
};
for (const [language, values] of Object.entries(tlsTranslations)) {
  Object.assign(I18N[language as Language], Object.fromEntries(tlsKeys.map((key, index) => [key, values[index]])));
}
