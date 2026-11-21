import type { Yue2Options, Yue2Sampling } from "../types";
import { MAX_INFERENCE_STEPS } from "../generation-limits";
import { yue2Text } from "./messages";
import "./fields.css";

const integerMax = 2_147_483_647;
const samplingFields = {
  temperature: { min: 0, max: 5, step: "any" },
  top_p: { min: 0, max: 1, step: "any" },
  top_k: { min: 1, max: integerMax },
  repetition_penalty: { min: 0, step: "any" },
  penalty_window: { min: 1, max: 100 },
  min_tokens: { min: 0, max: 32_768 },
  max_tokens: { min: 1, max: 32_768 },
};
const samplingDefaults = {
  abc_sampling: { temperature: .7, top_p: .9, top_k: 30, repetition_penalty: 1.005, penalty_window: 100, min_tokens: 32, max_tokens: 4096 },
  semantic_sampling: { temperature: 1, top_p: .95, top_k: 100, repetition_penalty: 1.2, penalty_window: 50, min_tokens: 200, max_tokens: 9000 },
};
type SamplingStage = keyof typeof samplingDefaults;
const stages = Object.keys(samplingDefaults) as SamplingStage[];
const keys = Object.keys(samplingFields) as (keyof Yue2Sampling)[];

function NumericField({ label, placeholder, value, onChange, ...bounds }: {
  label: string; placeholder: string; value?: number; onChange: (value?: number) => void;
  min?: number; max?: number; step?: string;
}) {
  return <label className="field">
    <span className="lbl">{label}</span>
    <input type="number" {...bounds} placeholder={placeholder} value={value ?? ""}
      onChange={event => onChange(event.currentTarget.value === "" ? undefined : event.currentTarget.valueAsNumber)} />
  </label>;
}

/** Validate constraints that number inputs alone cannot describe. */
export function yue2OptionsError(options: Yue2Options, instrumental: boolean): keyof ReturnType<typeof yue2Text> | undefined {
  const hasScore = Boolean(options.abc?.trim());
  if (options.cot === "off" && (instrumental || hasScore)) return "yue2_score_requires_planning";
  if (options.abc && (new TextEncoder().encode(options.abc).length > 16 * 1024 || options.abc.includes("\0"))) return "yue2_invalid_score";
  if (options.cfg_scale !== undefined && options.cfg_scale < 0 && options.cfg_scale !== -1) return "yue2_invalid_options";
  for (const stage of stages) {
    const defaults = samplingDefaults[stage];
    const sampling = options[stage];
    if (sampling && (sampling.top_p === 0 || sampling.repetition_penalty === 0 ||
      (sampling.min_tokens ?? defaults.min_tokens) > (sampling.max_tokens ?? defaults.max_tokens))) {
      return stage === "abc_sampling" ? "yue2_invalid_abc_sampling" : "yue2_invalid_semantic_sampling";
    }
  }
}

export function Yue2Fields({ options, onChange, language }: {
  options: Yue2Options; onChange: (options: Yue2Options) => void; language: string;
}) {
  const t = yue2Text(language);
  return <details className="yue2-fields" onInvalid={event => { event.currentTarget.open = true; }}>
    <summary>{t.settings}</summary>
    <div className="yue2-field-grid">
      <label className="field"><span className="lbl">{t.planning}</span>
        <select value={options.cot ?? "full"} onChange={event => onChange({ ...options, cot: event.currentTarget.value as Yue2Options["cot"] })}>
          <option value="full">{t.full}</option><option value="melody">{t.melody}</option><option value="off">{t.off}</option>
        </select>
      </label>
      <NumericField label={t.lm_seed} min={-1} max={4_294_967_295}
        placeholder={t.linkedSeed} value={options.lm_seed} onChange={lm_seed => onChange({ ...options, lm_seed })} />
      <NumericField label={t.steps} min={1} max={MAX_INFERENCE_STEPS} placeholder="32" value={options.steps} onChange={steps => onChange({ ...options, steps })} />
      <NumericField label={t.cfg_scale} min={-1} max={10} step="any" placeholder={t.auto} value={options.cfg_scale} onChange={cfg_scale => onChange({ ...options, cfg_scale })} />
      <NumericField label={t.peak_clip} min={0} max={999} placeholder="0" value={options.peak_clip} onChange={peak_clip => onChange({ ...options, peak_clip })} />
    </div>
    <p className="small fine">{t.seedHelp}</p>
    <label className="field"><span className="lbl">{t.score}</span>
      <textarea rows={3} placeholder={t.auto} value={options.abc ?? ""} onChange={event => onChange({ ...options, abc: event.currentTarget.value || undefined })} />
    </label>
    {stages.map(stage => <details key={stage} className="yue2-sampling" onInvalid={event => { event.currentTarget.open = true; }}>
      <summary>{t[stage]}</summary>
      <div className="yue2-field-grid">{keys.map(key => <NumericField key={key} label={t[key]} {...samplingFields[key]}
        placeholder={String(samplingDefaults[stage][key])} value={options[stage]?.[key]}
        onChange={value => onChange({ ...options, [stage]: { ...options[stage], [key]: value } })} />)}</div>
    </details>)}
    <button className="sek secondary" type="button" onClick={() => onChange({})}>{t.reset}</button>
  </details>;
}
