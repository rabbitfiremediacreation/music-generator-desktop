import type { DynamicEqBand, RepairEffect } from "../../stems";
import { useI18n } from "../i18n";
import { useState } from "react";
import type { Gesture } from "./MixerControls";
import { dynamicEqBandwidth, dynamicEqFrequency, dynamicEqReduction } from "./repair-tools";

type Range = readonly [min: number, max: number, step: number];
const sensitivity = [1, 100, 1] as const;
const threshold = [-60, -3, 1] as const;

export function validRepairEffect(effect: RepairEffect) {
  return effect.sensitivity >= sensitivity[0] && effect.sensitivity <= sensitivity[1];
}

function NumberField({ label, range: [min, max, step], value, disabled, gesture, onChange }: {
  label: string; range: Range; value: number; disabled: boolean; gesture?: Gesture; onChange: (value: number) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string>();
  return <label className="field">{t(label)}
    <input type="number" min={min} max={max} step={step} value={draft ?? (Number.isFinite(value) ? value : "")}
      disabled={disabled} onFocus={gesture?.begin} onBlur={() => { setDraft(undefined); gesture?.end(); }}
      onChange={event => {
        const next = event.target.valueAsNumber;
        if (gesture) setDraft(event.target.value);
        if (!gesture || (next >= min && next <= max)) onChange(next);
      }} />
  </label>;
}

export function EqBandFields({ band, gesture, onChange }: {
  band: DynamicEqBand; gesture: Gesture; onChange: (band: DynamicEqBand) => void;
}) {
  return <>
    <NumberField label="stem_repair_frequency" range={dynamicEqFrequency} value={band.frequency_hz} disabled={false} gesture={gesture}
      onChange={frequency_hz => onChange({ ...band, frequency_hz })} />
    <NumberField label="stem_repair_threshold" range={threshold} value={band.threshold_db} disabled={false} gesture={gesture}
      onChange={threshold_db => onChange({ ...band, threshold_db })} />
    <NumberField label="stem_repair_max_cut" range={dynamicEqReduction} value={band.reduction_db} disabled={false} gesture={gesture}
      onChange={reduction_db => onChange({ ...band, reduction_db })} />
    <NumberField label="stem_repair_q" range={dynamicEqBandwidth} value={band.q} disabled={false} gesture={gesture}
      onChange={q => onChange({ ...band, q })} />
  </>;
}

export function RepairEffectFields({ effect, disabled, onChange }: {
  effect: RepairEffect; disabled: boolean; onChange: (effect: RepairEffect) => void;
}) {
  return <NumberField label="stem_repair_sensitivity" range={sensitivity} value={effect.sensitivity} disabled={disabled}
    onChange={value => onChange({ ...effect, sensitivity: value })} />;
}
