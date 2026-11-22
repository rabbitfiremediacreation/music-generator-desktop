import { confirm } from "@tauri-apps/plugin-dialog";
import { t } from "./i18n.js";

export interface AudioPermissionPrompt {
  title: string;
  question: string;
  accept: string;
  cancel: string;
}

export function audioPermissionPrompt(purpose: "analysis" | "remix"): AudioPermissionPrompt {
  return {
    title: t("audio_permission_title"),
    question: t(purpose === "analysis" ? "audio_permission_analysis" : "audio_permission_remix"),
    accept: t(purpose === "analysis" ? "audio_permission_analyze" : "audio_permission_use_reference"),
    cancel: t("cancel"),
  };
}

export function confirmAudioPermission(filename: string, prompt: AudioPermissionPrompt) {
  return confirm(`${filename}\n\n${prompt.question}`, {
    title: prompt.title, okLabel: prompt.accept, cancelLabel: prompt.cancel,
  });
}
