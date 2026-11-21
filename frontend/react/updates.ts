import type { Update } from "../types";
import type { useI18n } from "./i18n";

export const updateCheckKey = ["updates", "check"] as const;

export function updateStatus(result: Update, t: ReturnType<typeof useI18n>["t"]) {
  if (result.native) return "";
  if (result.available) return `${result.current} → ${result.latest}`;
  return result.latest ? t("upd_current", result.current) : t("upd_no_build");
}
