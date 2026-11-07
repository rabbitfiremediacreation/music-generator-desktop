import { useMutation } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { backend } from "../../backend";
import { useI18n } from "../i18n";

export function AboutSettings({ onError }: { onError: (error: unknown) => void }) {
  const { t } = useI18n();
  const update = useMutation({ mutationFn: backend.checkUpdate, retry: false, networkMode: "always" });
  return <>
    <div className="settings-section">
      <h4>{t("version")}</h4>
      <div className="upd-row"><button type="button" className="sek" disabled={update.isPending} onClick={() => update.mutate()}>{t("upd_check")}</button><span className="small" role="status">{update.isPending ? t("upd_search") : update.error ? String(update.error) : update.data ? update.data.available ? `${update.data.current} → ${update.data.latest}` : t("upd_current", update.data.current) : ""}</span></div>
      {update.data?.available && update.data.url && <button type="button" className="aktion" onClick={() => void openUrl(update.data!.url!).catch(onError)}>{t("desktop_download_release")}</button>}
    </div>
    <div className="settings-section">
      <h4>GitHub</h4>
      <p className="small">{t("github_info")}</p>
      <button type="button" className="sek settings-link-button" onClick={() => void openUrl("https://github.com/rabbitfiremediacreation/music-generator-desktop").catch(onError)}>{t("github")}<span aria-hidden="true">↗</span></button>
    </div>
  </>;
}
