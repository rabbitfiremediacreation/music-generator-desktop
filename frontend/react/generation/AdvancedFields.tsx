import { useI18n } from "../i18n";
import { Slider } from "./Slider";
import { KEYS, type FormValues } from "./form-state";

export function AdvancedFields({ values, update, risk, open, setOpen }: { values: FormValues; update: (patch: Partial<FormValues>) => void; risk: boolean; open: boolean; setOpen: (open: boolean) => void }) {
  const { t } = useI18n();
  const keys = values.keyscale && !KEYS.includes(values.keyscale) ? [...KEYS, values.keyscale] : KEYS;
  return <details id="advBox" open={open}>
    <summary onClick={event => { event.preventDefault(); setOpen(!open); }}>{t("advanced")}</summary>
    <div className="field adv"><span className="lbl" title={t("iterations_tip")}>{t("iterations")}</span><Slider name="inference_steps" label={t("iterations")} value={values.inference_steps} min={1} max={200} risk={risk} onChange={inference_steps => update({ inference_steps })} /></div>
    <div className="field adv"><span className="lbl" title={t("variance_tip")}>{t("variance")}</span><Slider name="lm_temperature" label={t("variance")} value={values.lm_temperature} min={0.3} max={1.5} step={0.05} format="temperature" onChange={lm_temperature => update({ lm_temperature })} /></div>
    <div className="grid">
      <label className="field"><span className="lbl">{t("key")}</span><select name="keyscale" value={values.keyscale} onChange={event => update({ keyscale: event.target.value })}><option value="">{t("vt_auto")}</option>{keys.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label className="field"><span className="lbl">{t("timesig")}</span><select name="timesignature" value={values.timesignature} onChange={event => update({ timesignature: event.target.value })}><option value="">{t("vt_auto")}</option>{[["4",t("ts_default")],["3",t("ts_waltz")],["6","6/8"],["2",t("ts_march")]].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="field"><span className="lbl" title={t("seed_tip")}>Seed</span><input name="seed" type="number" placeholder={t("seed_ph")} value={values.seed} onChange={event => update({ seed: event.target.value })} /></label>
    </div>
  </details>;
}
