import { I18N } from "./i18n.js";
import type { Language } from "./locales";

const cancelled: Record<Language, string> = {
  de: "Einrichtung abgebrochen. Deine Auswahl bleibt erhalten. Du kannst sie anpassen und erneut starten.",
  en: "Setup cancelled. Your selections are kept. You can adjust them and start again.",
  es: "Configuración cancelada. Se conservan tus selecciones. Puedes ajustarlas y volver a empezar.",
  fr: "Configuration annulée. Vos choix sont conservés. Vous pouvez les modifier et recommencer.",
  it: "Configurazione annullata. Le tue scelte vengono mantenute. Puoi modificarle e ricominciare.",
  pt: "Configuração cancelada. As tuas escolhas são mantidas. Podes ajustá-las e começar de novo.",
  tr: "Kurulum iptal edildi. Seçimleriniz korunur. Bunları değiştirip yeniden başlayabilirsiniz.",
  pl: "Konfiguracja anulowana. Twoje wybory zostały zachowane. Możesz je zmienić i zacząć ponownie.",
  ru: "Настройка отменена. Ваши параметры сохранены. Вы можете изменить их и начать заново.",
  uk: "Налаштування скасовано. Ваш вибір збережено. Ви можете змінити його й почати знову.",
  ja: "セットアップをキャンセルしました。選択内容は保持されています。変更してから再開できます。",
  zh: "设置已取消。已保留你的选择，你可以调整后重新开始。",
};

for (const [language, message] of Object.entries(cancelled)) {
  Object.assign(I18N[language as Language], { setup_cancelled: message });
}
