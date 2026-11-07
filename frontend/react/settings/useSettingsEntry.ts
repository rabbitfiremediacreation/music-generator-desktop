import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { backend } from "../../backend";
import { useI18n } from "../i18n";

/** Native menu and keyboard requests share the same guard and open the existing dialog. */
export function useSettingsEntry(macos: boolean, enabled: boolean, onOpen: () => void) {
  const { t, language } = useI18n();
  const current = useRef({ enabled, onOpen });
  current.current = { enabled, onOpen };

  useEffect(() => {
    if (!macos) return;
    let stopped = false;
    let unlisten: (() => void) | undefined;
    const open = () => {
      if (!stopped && current.current.enabled && !document.querySelector("dialog[open]:not(#settingsDlg)")) current.current.onOpen();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== "," || !event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.repeat) return;
      event.preventDefault(); open();
    };
    document.addEventListener("keydown", keyboard);
    void listen("open-settings", open).then(off => {
      if (stopped) off(); else unlisten = off;
    }).catch(console.error);
    return () => { stopped = true; unlisten?.(); document.removeEventListener("keydown", keyboard); };
  }, [macos]);

  useEffect(() => {
    if (macos) void backend.configureSettingsMenu(`${t("settings_title")}…`, enabled).catch(console.error);
  }, [macos, enabled, language, t]);
}
