import { useMutation } from "@tanstack/react-query";
import { backend } from "../../backend";
import type { Settings } from "../../types";
import { useI18n } from "../i18n";
import type { useSettingsDraft } from "./useSettingsDraft";

export function LibrarySettings({ state, onMoveLibrary }: {
  state: ReturnType<typeof useSettingsDraft>; onMoveLibrary: () => void;
}) {
  const { t } = useI18n();
  const { draft, pending, change } = state;
  const openFolder = useMutation({ mutationFn: backend.openSongsFolder, retry: false, networkMode: "always" });
  if (!draft) return null;
  return <>
    <div className="settings-section">
      <label className="field"><span className="lbl" title={t("desktop_songs_tip")}>{t("songs_dir")}</span><span className="path-picker"><input name="songs_dir" aria-describedby="settingsSongsHint" value={draft.songs_dir} placeholder={draft.songs_dir_default || ""} onChange={event => change({ songs_dir: event.target.value })} />
        <button type="button" className="sek" aria-label={t("desktop_browse")} onClick={() => void state.selectDirectory()}>{t("desktop_browse")}</button>
      </span><span id="settingsSongsHint" className="small">{t("desktop_songs_tip")}</span></label>
      <div className="settings-actions">
        <button type="button" className="sek" disabled={openFolder.isPending} onClick={() => openFolder.mutate()}>{t("settings_open_folder")}</button>
        <button type="button" className="sek" disabled={pending} onClick={onMoveLibrary}>{t("import_move_title")}</button>
      </div>
      {openFolder.error && <p role="alert" className="small err">{t("settings_open_folder_failed")}</p>}
    </div>
    <div className="settings-section">
      <label className="field"><span className="lbl" title={t("exp_tip")}>{t("exp")}</span><select name="export_format" value={draft.export_format} onChange={event => change({ export_format: event.target.value as Settings["export_format"] })}>
        <option value="wav">{t("exp_wav")}</option><option value="mp3" disabled={!draft.mp3_available}>{t("exp_mp3")}</option>
      </select>{!draft.mp3_available && <span className="small">{t("exp_no_mp3")}</span>}</label>
    </div>
  </>;
}
