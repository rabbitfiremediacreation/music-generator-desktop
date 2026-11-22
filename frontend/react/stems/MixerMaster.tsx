import { compressorTuning, type StemMix } from "../../stems";
import { useI18n } from "../i18n";
import { MixerFader, type Gesture } from "./MixerControls";
import { MixerMeter } from "./MixerMeter";
import { MixerDynamics } from "./MixerDynamics";
import type { TransportStore } from "./useStemTransport";

export function MixerMaster({ mix, mono, toggleMono, store, gesture, change }: {
  mix: StemMix; mono: boolean; toggleMono: () => void; store: TransportStore; gesture: Gesture; change: (patch: Partial<StemMix>) => void;
}) {
  const { t } = useI18n();
  const amount = mix.master_comp ?? 0;
  return <aside className="mixer-channel mixer-master" aria-label={t("stem_master")}>
    <header className="mixer-strip-header"><strong><span className="mixer-channel-icon" aria-hidden="true">☷</span> MASTER</strong></header>
    <div className="mixer-channel-body">
      <div className="mixer-channel-knobs">
        <MixerDynamics name="MASTER" amount={amount} legacyLimit={mix.master_limit ?? 0}
          settings={mix.master_dynamics} gesture={gesture}
          changeSettings={master_dynamics => change({ master_dynamics })} />
      </div>
      <div className="mixer-master-output">
        <div className="mixer-master-level">
          <MixerFader label={`MASTER · ${t("stem_gain")}`} db={mix.master_db} off={!!mix.master_off} gesture={gesture}
            change={(master_db, master_off) => change({ master_db, master_off })} />
          <MixerMeter name={t("stem_master_meter")} store={store} threshold={compressorTuning(amount, mix.master_dynamics).threshold_db} />
        </div>
        <button type="button" className="mixer-mono" aria-pressed={mono} title={t("stem_mono_hint")} onClick={toggleMono}>MONO</button>
      </div>
    </div>
  </aside>;
}
