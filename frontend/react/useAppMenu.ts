import { useEffect, useMemo, useRef } from "react";
import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { confirm, message } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { backend } from "../backend";
import { useI18n } from "./i18n";
import { updateCheckKey, updateStatus } from "./updates";
import "./menu-i18n";

const desktopGuide = "https://github.com/rabbitfiremediacreation/music-generator-desktop/blob/main/docs/desktop.md";
const appName = "Music Generator";

type MenuAction = "settings" | "updates" | "songs-folder" | "creator" | "library" | "models" | "phone" | "documentation";

export function focusStudioArea(area: "creator" | "library") {
  const selector = area === "library" ? "#libHeading" : '#genForm [name="prompt"]';
  const target = document.querySelector<HTMLElement>(selector)
    ?? (area === "creator" ? document.querySelector<HTMLElement>('#genForm [name="style"]') : null);
  target?.focus();
  return Boolean(target);
}

export function useAppMenu({ macos, ready, studio, settingsOpen, onSettings }: {
  macos: boolean;
  ready: boolean;
  studio: boolean;
  settingsOpen: boolean;
  onSettings: (page?: "models" | "phone") => void;
}) {
  const { t, language } = useI18n();
  const client = useQueryClient();
  const updating = useIsMutating({ mutationKey: updateCheckKey }) > 0;
  const update = useMutation({
    mutationKey: updateCheckKey,
    networkMode: "always",
    retry: false,
    mutationFn: async () => {
      const result = await backend.checkUpdate();
      if (result.native) return;
      const status = updateStatus(result, t);
      if (result.available && result.url) {
        if (await confirm(status, { title: t("upd_check"), okLabel: t("desktop_download_release"), cancelLabel: t("cancel") })) {
          await openUrl(result.url);
        }
      } else {
        await message(status, { title: t("upd_check") });
      }
    },
    onError: error => {
      void message(error instanceof Error ? error.message : String(error), { title: t("upd_check"), kind: "error" }).catch(console.error);
    },
  });

  const enabled = useMemo(() => {
    const actions: MenuAction[] = [];
    if (ready) {
      actions.push("documentation");
      if (!updating) actions.push("updates");
    }
    if (ready && studio) {
      actions.push("settings", "models", "phone", "songs-folder");
      if (!settingsOpen) actions.push("creator", "library");
    }
    return actions;
  }, [ready, studio, settingsOpen, updating]);

  const dispatch = useRef<(payload: unknown) => void>(undefined);
  dispatch.current = payload => {
    const action = enabled.find(value => value === payload);
    if (!action || document.querySelector("dialog[open]:not(#settingsDlg)")) return;
    switch (action) {
      case "settings": onSettings(); break;
      case "models":
      case "phone":
        if (!document.querySelector('#settingsForm[aria-busy="true"]')) onSettings(action);
        break;
      case "creator":
      case "library": focusStudioArea(action); break;
      case "updates":
        if (!client.isMutating({ mutationKey: updateCheckKey })) update.mutate();
        break;
      case "songs-folder":
        void backend.openSongsFolder().catch(() => message(t("settings_open_folder_failed"), { title: appName, kind: "error" })).catch(console.error);
        break;
      case "documentation":
        void openUrl(desktopGuide).catch((error: unknown) => message(String(error), { title: t("menu_documentation"), kind: "error" })).catch(console.error);
        break;
    }
  };

  useEffect(() => {
    if (!macos) return;
    let stopped = false;
    let unlisten: (() => void) | undefined;
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== "," || !event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.repeat) return;
      event.preventDefault();
      dispatch.current?.("settings");
    };
    document.addEventListener("keydown", keyboard);
    void listen<string>("app-menu-action", ({ payload }) => {
      if (!stopped) dispatch.current?.(payload);
    }, { target: "main" }).then(off => {
      if (stopped) off(); else unlisten = off;
    }).catch(console.error);
    return () => {
      stopped = true;
      unlisten?.();
      document.removeEventListener("keydown", keyboard);
    };
  }, [macos]);

  useEffect(() => {
    if (!macos) return;
    const labels = {
      file: t("menu_file"), edit: t("menu_edit"), view: t("menu_view"),
      window: t("menu_window"), help: t("menu_help"),
      settings: `${t("settings_title")}…`,
      updates: updating ? t("upd_search") : `${t("upd_check")}…`,
      "songs-folder": t("menu_songs_folder"),
      creator: t("menu_creator"),
      library: t("library"),
      models: `${t("settings_page_models")}…`,
      phone: `${t("settings_page_phone")}…`,
      documentation: t("menu_documentation"),
    } satisfies Record<MenuAction | "file" | "edit" | "view" | "window" | "help", string>;
    void backend.configureAppMenu(labels, enabled).catch(console.error);
  }, [macos, enabled, updating, language, t]);
}
