import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { backend } from "../../backend";
import type { UpdateStream } from "../../types";
import { useI18n } from "../i18n";
import { updateCheckKey, updateStatus } from "../updates";
import type { useSettingsDraft } from "./useSettingsDraft";

export function AboutSettings({ state, onError }: {
  state: ReturnType<typeof useSettingsDraft>;
  onError: (error: unknown) => void;
}) {
  const { t } = useI18n();
  const client = useQueryClient();
  const stream = state.draft?.update_stream ?? "stable";
  const updating = useIsMutating({ mutationKey: updateCheckKey }) > 0;
  const update = useMutation({ mutationKey: updateCheckKey, mutationFn: (selected: UpdateStream) => backend.checkUpdate(selected), retry: false, networkMode: "always" });
  const result = update.data;
  const status = update.isPending ? t("upd_search")
    : update.error ? String(update.error)
    : result ? updateStatus(result, t) : "";
  const url = result?.available ? result.url : undefined;

  return <>
    <div className="settings-section">
      <h4>{t("version")}</h4>
      <div className="field">
        <label htmlFor="updateStream" className="lbl">{t("upd_stream")}</label>
        <select id="updateStream" value={stream} aria-describedby="updateStreamHint" onChange={event => {
          update.reset();
          state.change({ update_stream: event.target.value as UpdateStream });
        }}>
          <option value="stable">Stable</option>
          <option value="daily">Daily</option>
          <option value="develop">Develop</option>
        </select>
        <span id="updateStreamHint" className="small">{t(`upd_stream_${stream}`)}</span>
      </div>
      <div className="upd-row">
        <button type="button" className="sek" disabled={updating} onClick={() => {
          if (!client.isMutating({ mutationKey: updateCheckKey })) update.mutate(stream);
        }}>{t("upd_check")}</button>
        <span className="small" role="status">{status}</span>
        {url && <button type="button" className="aktion" onClick={() => void openUrl(url).catch(onError)}>{t("desktop_download_release")}</button>}
      </div>
    </div>
    <div className="settings-section">
      <h4>GitHub</h4>
      <p className="small">{t("github_info")}</p>
      <button type="button" className="sek settings-link-button" onClick={() => void openUrl("https://github.com/rabbitfiremediacreation/music-generator-desktop").catch(onError)}>{t("github")}<span aria-hidden="true">↗</span></button>
    </div>
  </>;
}
