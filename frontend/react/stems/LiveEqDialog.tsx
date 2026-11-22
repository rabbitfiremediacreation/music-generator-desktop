import { useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { maxEqBands, stemApi, type DynamicEqBand, type DynamicEqSettings } from "../../stems";
import { useI18n } from "../i18n";
import { Dialog } from "../ui";
import { DynamicEqGraph } from "./DynamicEqGraph";
import type { Gesture } from "./MixerControls";
import { EqBandFields } from "./RepairEffectFields";
import type { MixerTransport } from "./useStemTransport";
import "./spectral-repair.css";

type UpdateEq = (settings: DynamicEqSettings) => DynamicEqSettings;
const empty: DynamicEqSettings = { bands: [] };

export function LiveEqDialog({ id, role, name, frame, frames, rate, transport, gesture, settings = empty, onEdit, onClose }: {
  id?: string; role: string; name: string; frame: number; frames: number; rate: number;
  transport: MixerTransport; gesture: Gesture; settings?: DynamicEqSettings;
  onEdit: (update: UpdateEq) => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState(0);
  const playing = useSyncExternalStore(transport.subscribe, () => transport.getPosition().playing);
  const width = Math.min(frames, 8 * rate);
  const first = Math.max(0, Math.min(frames - width, Math.round(frame) - 2 * rate));
  const end = first + width;
  const preview = useQuery({
    queryKey: ["stem-spectral-preview", id, role, first, end],
    queryFn: () => stemApi.spectralPreview(id!, role, first, end), enabled: !!id, networkMode: "always",
    retry: false, staleTime: Infinity,
  });
  const index = Math.max(0, Math.min(selected, settings.bands.length - 1));
  const band = settings.bands[index];
  const bypass = settings.bypass === true;
  const title = t("stem_repair_dynamic_eq");

  function addBand(next: DynamicEqBand) {
    if (settings.bands.length >= maxEqBands) return;
    setSelected(settings.bands.length);
    onEdit(current => ({ ...current, bands: [...current.bands, next] }));
  }

  function changeBand(index: number, next: DynamicEqBand) {
    onEdit(current => ({ ...current, bands: current.bands.map((band, i) => i === index ? next : band) }));
  }

  function removeBand(index: number) {
    setSelected(index);
    onEdit(current => ({ ...current, bands: current.bands.filter((_, i) => i !== index) }));
  }

  return <Dialog open title={title} onClose={onClose} className="spectral-repair live-eq">
    <div className="spectral-heading"><h3>{title}</h3><span>{name}</span></div>
    <DynamicEqGraph bands={settings.bands} selected={index} rate={rate} image={preview.data}
      from={0} to={1} disabled={false} gesture={gesture} onSelect={setSelected}
      onAdd={addBand} onChange={changeBand} onRemove={removeBand} />
    {band && <div className="spectral-selection-controls live-eq-fields" aria-label={t("stem_repair_eq_point", index + 1)} role="group">
      <EqBandFields key={index} band={band} gesture={gesture} onChange={next => changeBand(index, next)} />
    </div>}
    <div className="spectral-footer">
      <div className="spectral-audition">
        <button type="button" className="sek" disabled={!transport.ready}
          onClick={() => transport.play(!transport.getPosition().playing)}>{t(playing ? "stem_stop" : "stem_play")}</button>
        <button type="button" className="sek" aria-pressed={bypass} disabled={!settings.bands.length}
          onClick={() => onEdit(current => ({ ...current, bypass: !current.bypass }))}>{t("stem_repair_eq_bypass")}</button>
      </div>
      <button type="button" className="sek" onClick={onClose}>{t("desktop_close")}</button>
    </div>
  </Dialog>;
}
