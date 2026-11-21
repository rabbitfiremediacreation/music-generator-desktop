import type { StemMix } from "../../stems";
import { useI18n } from "../i18n";
import { MixerFader, MixerKnob, type Gesture } from "./MixerControls";
import { MixerMeter } from "./MixerMeter";
import { percent } from "./StemChannel";
import type { TransportStore } from "./useStemTransport";

export function MixerMaster({ mix, mono, toggleMono, store, gesture, change }: {
  mix: StemMix; mono: boolean; toggleMono: () => void; store: TransportStore; gesture: Gesture; change: (patch: Partial<StemMix>) => void;
}) {
  const { t } = useI18n();
  const limiting = (mix.master_limit ?? 0) > 0;
  return <aside className="mixer-channel mixer-master" aria-label={t("stem_master")}>
    <header className="mixer-strip-header"><strong><span className="mixer-channel-icon" aria-hidden="true">☷</span> MASTER</strong></header>
    <div className="mixer-channel-body">
      <div className="mixer-knob-row">
        <MixerKnob caption="COMP" label="MASTER · COMP" value={mix.master_comp ?? 0} min={0} max={100} neutral={0} step={1}
          format={percent} gesture={gesture} title={t("stem_comp_hint")} change={master_comp => change({ master_comp })} />
        <MixerKnob caption="LIMIT" label="MASTER · LIMIT" value={mix.master_limit ?? 0} min={0} max={100} neutral={0} step={1}
          format={percent} gesture={gesture} title={t("stem_limit_hint")} change={master_limit => change({ master_limit })} />
      </div>
      <span className="mixer-limiter-state" data-enabled={limiting}>{t(limiting ? "stem_limit_active" : "stem_limit_off")}</span>
      <div className="mixer-master-level">
        <MixerFader label={`MASTER · ${t("stem_gain")}`} db={mix.master_db} off={!!mix.master_off} gesture={gesture}
          change={(master_db, master_off) => change({ master_db, master_off })} />
        <MixerMeter name={t("stem_master_meter")} store={store} />
      </div>
      <button type="button" className="mixer-mono" aria-pressed={mono} title={t("stem_mono_hint")} onClick={toggleMono}>MONO</button>
    </div>
  </aside>;
}
