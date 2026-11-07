import { modelOptions, modelName, profile } from "../../model-options";
import { modelLabel } from "../../expert-mode";
import type { ModelCatalog, ModelSelection } from "../../types";
import { useI18n } from "../i18n";

export function ModelSelectFields({ catalog, draft, onChange, compatibleOnly, busy }: {
  catalog: ModelCatalog; draft: ModelSelection; onChange: (selection: ModelSelection) => void;
  compatibleOnly: boolean; busy: boolean;
}) {
  const { t, language } = useI18n();
  const bytes = (value: number) => `${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value / 1024 ** 3)} GiB`;
  const planned = !catalog.providers.some(provider => provider.id === draft.provider && provider.status === "available");
  function changeRole(role: "synthesis" | "language", value: string) {
    const next = { ...draft, [role]: value };
    if (role === "synthesis" && !catalog.expert_mode) next.language = catalog.recommended_profiles.find(item => item.synthesis === value)?.language || next.language;
    onChange(next);
  }
  return <div className="picker-fields">
    {(["synthesis", "language"] as const).map(role => {
      if (role === "language" && !catalog.expert_mode) return <div className="field" key={role}><span className="lbl">{t("desktop_language_model")}</span><span className="small">{catalog.recommended_profiles.find(item => item.synthesis === draft.synthesis) ? `${modelLabel(catalog.recommended_profiles.find(item => item.synthesis === draft.synthesis)!.language, false)} · ${t("desktop_recommended")}` : "—"}</span></div>;
      const family = catalog.models.find(model => model.file === draft.synthesis && model.provider === draft.provider)?.family;
      const options = modelOptions(catalog, draft, role, compatibleOnly).filter(model => role !== "synthesis" || model.family === family);
      const groups = [...new Set(options.map(model => model.family))];
      const option = (model: typeof options[number]) => {
        const fits = profile(catalog, { ...draft, [role]: model.file }).compatible;
        const status = t(model.verified ? "picker_installed" : model.present ? "picker_verify" : "picker_missing");
        const name = role === "synthesis" ? model.precision : modelName(model.file);
        return <option key={model.file} value={model.file}>{`${name} · ${bytes(model.estimated_bytes)} · ${status}${fits ? "" : ` · ${t("picker_low_ram")}`}`}</option>;
      };
      const valid = options.some(model => model.file === draft[role]);
      return <label className="field" key={role}><span className="lbl">{t(role === "synthesis" ? "browser_precision" : "desktop_language_model")}</span><select aria-label={t(role === "synthesis" ? "dit" : "desktop_language_model")} value={valid ? draft[role] : ""} disabled={busy || planned} onChange={event => changeRole(role, event.target.value)}>
        {!valid && <option value="" disabled>{t("expert_mode_locked")}</option>}
        {catalog.expert_mode ? groups.map(group => <optgroup key={group} label={modelName(group)}>{options.filter(model => model.family === group).map(option)}</optgroup>) : options.map(option)}
      </select></label>;
    })}
  </div>;
}
