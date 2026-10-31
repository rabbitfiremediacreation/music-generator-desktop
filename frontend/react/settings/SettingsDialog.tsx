import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { backend } from "../../backend";
import { pathErrorText } from "../../path-dialogs";
import { modelErrorText } from "../../expert-mode";
import type { Settings } from "../../types";
import { useI18n } from "../i18n";
import { useSettingsDraft } from "./useSettingsDraft";

export interface SettingsDialogProps {
  open: boolean; onClose: () => void; onBusyChange: (busy: boolean) => void;
  onManageModels: () => void; onMoveLibrary: () => void;
  onOpenModelPicker?: () => void;
  layout: "auto" | "stack" | "side"; onLayoutChange: (value: "auto" | "stack" | "side") => void;
}

export function SettingsDialog(props: SettingsDialogProps) {
  const { t } = useI18n();
  const state = useSettingsDraft(props.open, props.onClose, props.onBusyChange);
  const dialog = useRef<HTMLDialogElement>(null);
  const [pathError, setPathError] = useState<unknown>();
  const openFolder = useMutation({ mutationFn: backend.openSongsFolder, retry: false, networkMode: "always" });
  const update = useMutation({ mutationFn: backend.checkUpdate, retry: false, networkMode: "always" });
  const { draft, loading, saving, pending, status, failure, change } = state;
  useEffect(() => {
    if (props.open && !dialog.current?.open) dialog.current?.showModal();
    if (!props.open && dialog.current?.open) dialog.current?.close();
  }, [props.open]);
  if (!props.open) return null;
  const navigate = (action: () => void) => { props.onClose(); action(); };
  const error = failure ?? pathError;
  const errorText = error instanceof Error && error.message === "mp3_failed" ? t("mp3_failed") : error ? pathErrorText(modelErrorText(error, t)) : "";
  return <dialog ref={dialog} id="settingsDlg" aria-labelledby="settingsHeading" onCancel={event => { event.preventDefault(); if (!saving) props.onClose(); }}>
    <form id="settingsForm" aria-busy={saving || pending} onSubmit={event => { event.preventDefault(); void state.submit(); }}>
      <h2 id="settingsHeading" className="col-title">{t("settings_title")}</h2>
      <p role="status" aria-live="polite">{status && t(status)}</p>
      {status === "settings_load_failed" && <button type="button" className="sek" onClick={() => void state.load()}>{t("settings_retry")}</button>}
      <fieldset disabled={loading || !draft || saving}>
        {draft && <>
          <label className="field"><span className="lbl" title={t("lm_dev_tip")}>{t("lm_dev")}</span>
            <select name="lm_device" aria-label={t("lm_dev")} disabled={pending} value={draft.lm_device} onChange={event => void state.device(event.target.value as Settings["lm_device"])}>
              <option value="auto">{t("lm_dev_auto")}</option><option value="cpu">{t("lm_dev_cpu")}</option>
            </select><span className="small">{t("settings_device_hint")}</span>{draft.cpu_only && <span className="small">{t("desktop_intel_cpu_hint")}</span>}
          </label>
          <label className="field"><span className="lbl">{t("cpu_behavior_label")}</span><select name="cpu_iteration_behavior" aria-label={t("cpu_behavior_label")} value={draft.cpu_iteration_behavior} onChange={event => change({ cpu_iteration_behavior: event.target.value as Settings["cpu_iteration_behavior"] })} aria-describedby="cpuBehaviorHint">
            <option value="ask">{t("cpu_behavior_ask")}</option><option value="limit_30">{t("cpu_behavior_limit")}</option><option value="continue">{t("cpu_behavior_continue")}</option>
          </select><span id="cpuBehaviorHint" className="small">{t("cpu_behavior_hint")}</span></label>
          <label className="field"><span className="lbl">{t("timeout")}</span><input name="timeout_minutes" type="number" min="1" max="600" value={draft.timeout_minutes} onChange={event => change({ timeout_minutes: Number(event.target.value) })} /></label>
          <label className="check-row"><input type="checkbox" name="expert_mode" checked={draft.expert_mode} onChange={event => change({ expert_mode: event.target.checked })} aria-describedby="expertModeHint" />{t("expert_mode")}</label>
          <p id="expertModeHint" className="small">{t("expert_mode_hint")}</p>
          <button type="button" className="sek" disabled={pending} onClick={() => navigate(props.onOpenModelPicker || props.onManageModels)}>{t("creator_manage_models")}</button>
          <label className="field"><span className="lbl" title={t("exp_tip")}>{t("exp")}</span><select name="export_format" value={draft.export_format} onChange={event => change({ export_format: event.target.value as Settings["export_format"] })}>
            <option value="wav">{t("exp_wav")}</option><option value="mp3" disabled={!draft.mp3_available}>{t("exp_mp3")}</option>
          </select>{!draft.mp3_available && <span className="small">{t("exp_no_mp3")}</span>}</label>
          <button type="button" className="sek" disabled={pending} onClick={() => navigate(props.onMoveLibrary)}>{t("import_move_title")}</button>
          <label className="field"><span className="lbl" title={t("desktop_songs_tip")}>{t("songs_dir")}</span><span className="path-picker"><input name="songs_dir" value={draft.songs_dir} placeholder={draft.songs_dir_default || ""} onChange={event => change({ songs_dir: event.target.value })} />
            <button type="button" className="sek" aria-label={t("desktop_browse")} onClick={() => void state.selectDirectory()}>{t("desktop_browse")}</button>
          </span></label>
          <button type="button" className="sek" disabled={openFolder.isPending} onClick={() => openFolder.mutate()}>{t("settings_open_folder")}</button>
          {openFolder.error && <p role="alert" className="small err">{t("settings_open_folder_failed")}</p>}
        </>}
        <div className="field"><span className="lbl">{t("layout")}</span><div className="seg" role="group" aria-label={t("layout")}>{(["auto", "stack", "side"] as const).map(value => <button key={value} type="button" className="sek" aria-pressed={props.layout === value} title={value === "side" ? t("side_tip") : undefined} onClick={() => props.onLayoutChange(value)}>{t(value === "auto" ? "vt_auto" : value === "stack" ? "stacked" : "side")}</button>)}</div></div>
        <div className="field"><span className="lbl">{t("version")}</span><div className="upd-row"><button type="button" className="sek" disabled={update.isPending} onClick={() => update.mutate()}>{t("upd_check")}</button><span className="small" role="status">{update.isPending ? t("upd_search") : update.error ? String(update.error) : update.data ? update.data.available ? `${update.data.current} → ${update.data.latest}` : t("upd_current", update.data.current) : ""}</span></div>
          {update.data?.available && update.data.url && <button type="button" className="aktion" onClick={() => void openUrl(update.data!.url!).catch(setPathError)}>{t("desktop_download_release")}</button>}
        </div>
        <button type="button" className="sek" disabled={pending} onClick={() => navigate(props.onManageModels)} aria-describedby="setupWizardHint">{t("desktop_manage")}</button><p id="setupWizardHint" className="small">{t("desktop_manage_hint")}</p>
        <div className="field"><span className="lbl">GitHub</span><button type="button" className="sek" onClick={() => void openUrl("https://github.com/rabbitfiremediacreation/music-generator-desktop").catch(setPathError)}>{t("github")}</button><span className="small">{t("github_info")}</span></div>
      </fieldset>
      {saving && <p role="status">{t("settings_saving")}</p>}
      {errorText && <p role="alert" className="small err">{t("error")}: {errorText}</p>}
      <div className="submit"><button type="button" className="sek" disabled={saving} onClick={props.onClose}>{t("cancel")}</button><button type="submit" className="aktion" disabled={loading || !draft || pending || saving}>{t("save")}</button></div>
    </form>
  </dialog>;
}
