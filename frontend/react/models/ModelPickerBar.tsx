import { modelLabel } from "../../expert-mode";
import { profileKey } from "../../creator-models";
import type { ModelSelection } from "../../types";
import { useI18n } from "../i18n";

type Option = { value: string; label: string };

export function ModelPickerBar({ scope, selection, options, loading, disabled, allowed, hintId, onChange, onManage }: {
  scope: "creator" | "remix" | "stem"; selection?: ModelSelection; options: Option[]; loading: boolean;
  disabled: boolean; allowed: boolean; hintId?: string; onChange: (value: string) => void; onManage?: () => void;
}) {
  const { t } = useI18n();
  const selectId = `${scope}Model`;
  const detailsId = scope === "creator" ? "currentModels" : `${scope}CurrentModels`;
  const key = selection ? profileKey(selection) : "";
  const selected = options.some(option => option.value === key);
  return <div className="model-bar">
    <label className="lbl" htmlFor={selectId}>{t("picker_title")}</label>
    <div className="model-select">
      <select id={selectId} value={selected ? key : ""} disabled={disabled || loading || !options.length}
        aria-describedby={hintId ? `${detailsId} ${hintId}` : detailsId} onChange={event => onChange(event.target.value)}>
        {!selected && <option value="" disabled>{t(loading ? "desktop_checking" : options.length ? "picker_choose" : "picker_no_ready_models")}</option>}
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
    {onManage && <button type="button" className="sek" onClick={onManage}>{t("picker_choose")}</button>}
    <span id={detailsId} className="small model-current-details" role="status">
      {selected && selection?.language ? `${t("desktop_language_model")}: ${modelLabel(selection.language, !allowed)}` : ""}
    </span>
  </div>;
}
