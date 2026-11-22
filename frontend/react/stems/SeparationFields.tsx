import { stemRole } from "../../stems";
import { goals, maxSingleWindow, outputSelection, type InferenceOptions, type OutputSelection, type SeparationGoal } from "./separation-options";

type Translate = (key: string) => string;

export function StemOutputFields({ native, selection, change, t }: {
  native: string[]; selection: OutputSelection; change: (value: OutputSelection) => void; t: Translate;
}) {
  const { roles, outputs, target } = outputSelection(native, selection);
  return <>
    <label className="field"><span className="lbl">{t("stem_goal")}</span><select value={selection.goal}
      onChange={event => change({ goal: event.target.value as SeparationGoal })}>
      {goals.map(goal => <option key={goal} value={goal}>{t(`stem_${goal}`)}</option>)}
    </select></label>
    {selection.goal === "stem_pair" && <label className="field"><span className="lbl">{t("stem_track")}</span><select value={target}
      onChange={event => change({ goal: selection.goal, target: event.target.value })}>
      {native.map(role => <option key={role} value={role}>{stemRole(role, t)}</option>)}
    </select></label>}
    <fieldset className="stem-output">
      <legend className="lbl">{t("stem_roles")}</legend>
      <div className="stem-output-grid">{roles.map(role => <label className="stem-check" key={role}>
        <input type="checkbox" checked={outputs.includes(role)} onChange={event => change({ ...selection,
          selected: event.target.checked ? [...outputs, role] : outputs.filter(value => value !== role) })} />
        {stemRole(role, t)}
      </label>)}</div>
      {roles.includes("residual") && <p className="small">{t("stem_residual_hint")}</p>}
      {outputs.includes("instrumental") && <p className="small">{t("stem_derived")}</p>}
    </fieldset>
  </>;
}

export function StemInferenceFields({ options, change, t }: {
  options: InferenceOptions; change: (value: InferenceOptions) => void; t: Translate;
}) {
  const split = !options.no_split;
  const numberField = (key: "overlap" | "segment" | "shifts" | "num_workers" | "transition_power", min: number, max: number, step: number | "any") =>
    <label className="field"><span className="lbl">{t(`stem_${key}`)}</span>
      <input type="number" value={options[key] ?? ""} min={min} max={max} step={step}
        placeholder={key === "segment" ? String(options.quality === "fast" ? 4 : 7.8) : undefined}
        onChange={event => change({ ...options, [key]: event.target.value === "" && key === "segment" ? undefined : Number(event.target.value) })}/>
    </label>;
  return <details className="stem-block"><summary>{t("stem_advanced")}</summary>
    <div className="stem-detail-body">
      <label className="stem-check"><input type="checkbox" checked={!split}
        onChange={event => change({ ...options, no_split: event.target.checked, segment: undefined })} />
        {t("stem_no_split")} (≤ {maxSingleWindow(options)} s)</label>
      <div className="stem-field-grid">
        {split && <>
          <label className="field"><span className="lbl">{t("stem_quality")}</span><select value={options.quality}
            onChange={event => change({ ...options, quality: event.target.value as InferenceOptions["quality"], segment: undefined })}>
            <option value="standard">{t("stem_standard")}</option><option value="fast">{t("stem_fast")}</option>
          </select></label>
          {numberField("segment", 1, 7.8, "any")}
          {numberField("overlap", 0, .99, "any")}
          {numberField("transition_power", 1, 4, "any")}
          {numberField("num_workers", 0, 4, 1)}
        </>}
        {numberField("shifts", 0, 10, 1)}
      </div>
      <p className="small">{t("stem_inference_hint")}</p>
    </div>
  </details>;
}
