import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { backend } from "../../backend";
import { stemApi, stemError, type StemMix } from "../../stems";
import { useI18n } from "../i18n";
import { ModelPickerBar } from "../models/ModelPickerBar";
import { ModelDownloadProgress } from "../models/ModelDownloadProgress";
import { Dialog } from "../ui";
import { layerModels } from "./layer-models";
import { StemGenerationStatus } from "./StemGenerationStatus";
import type { useStemGeneration } from "./useStemGeneration";

const instruments = ["drums", "bass", "guitar", "keyboard", "percussion", "strings", "synth", "brass", "woodwinds", "fx"];

export function GenerateStemTrack({ mix, generation, onClose, onManage }: {
  mix: StemMix; generation: ReturnType<typeof useStemGeneration>; onClose: () => void; onManage?: () => void;
}) {
  const { t, language } = useI18n();
  const catalog = useQuery({
    queryKey: ["models", "catalog"], queryFn: backend.modelCatalog, networkMode: "always", retry: false,
  });
  const [choice, setChoice] = useState("");
  const [track, setTrack] = useState(instruments[0]);
  const [prompt, setPrompt] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<unknown>();
  const choices = useMemo(() => catalog.data ? layerModels(catalog.data) : undefined, [catalog.data]);
  const options = choices?.options ?? [];
  const model = options.find(option => option.value === choice) ?? options[0];
  const offer = choices?.prepare;
  const prepare = useMutation({
    mutationKey: ["models", "stem-prepare"], mutationFn: stemApi.prepareTrackModel, networkMode: "always",
    onSettled: () => catalog.refetch(),
  });
  const active = generation.running;
  const running = !!active || prepare.isPending;
  const title = t("stem_layer_generate");
  const failure = error || generation.error || active?.cancelError;
  const download = offer && offer.download > 0
    ? ` (${new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(offer.download / 1024 ** 3)} GiB)` : "";

  function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (running || generation.occupied || !model) return;
    setError(undefined);
    void generation.start({ selection: model.selection, track, name: t(`stem_role_${track}`), prompt: prompt.trim(), mix });
  }

  async function prepareModel() {
    if (running || !offer) return;
    setError(undefined);
    try { await prepare.mutateAsync(offer.selection); }
    catch (cause) { if (stemError(cause, t) !== "Operation cancelled") setError(cause); }
    finally { setCancelling(false); }
  }

  async function cancel() {
    if (active) { await generation.cancel(); return; }
    if (!running) { onClose(); return; }
    setCancelling(true);
    try {
      if (prepare.variables) await backend.cancelProfileTransfer("stem-model", prepare.variables);
    }
    catch (cause) { setError(cause); setCancelling(false); }
  }

  return <Dialog open title={title} onClose={onClose} className="stem-generate-dialog">
    <div className="col-title">{title}</div>
    <form className="stem-generate-form" onSubmit={generate}>
      {!active && <>
        <ModelPickerBar scope="stem" selection={model?.selection} options={options} loading={catalog.isPending} disabled={running}
          allowed={!!model} hintId={choices?.hint || model?.verified === false ? "stem-generation-model-hint" : undefined}
          onChange={setChoice} onManage={!running && onManage ? () => { onClose(); onManage(); } : undefined} />
        {choices?.hint && <p id="stem-generation-model-hint" className="small">{t(choices.hint)}</p>}
        {model?.verified === false && <p id="stem-generation-model-hint" className="small">{t("stem_layer_model_verify_hint")}</p>}
        {offer && <div className="stem-row">
          <button type="button" className="sek" disabled={running} onClick={() => void prepareModel()}>
            {t("stem_layer_model_download")} · {offer.label}{download}
          </button>
        </div>}
        <ModelDownloadProgress busy={prepare.isPending} />
        {catalog.error && <p role="alert" className="err">{stemError(catalog.error, t)}
          {" "}<button type="button" className="sek mini" onClick={() => void catalog.refetch()}>{t("retry")}</button></p>}
        <label className="field">{t("stem_layer_instrument")}<select value={track} disabled={running} onChange={event => setTrack(event.target.value)}>
          {instruments.map(name => <option key={name} value={name}>{t(`stem_role_${name}`)}</option>)}
        </select></label>
        <label className="field">{t("stem_layer_prompt")}<textarea value={prompt} maxLength={1000} rows={3} disabled={running}
          onChange={event => setPrompt(event.target.value)} placeholder={t("stem_layer_prompt_example")} /></label>
        <p className="small">{t("stem_layer_context_hint")}</p>
      </>}
      {active && <StemGenerationStatus job={active} />}
      {Boolean(failure) && <p className="err" role="alert">{stemError(failure, t)}</p>}
      <div className="stem-row">
        {!active && <button type="submit" className="aktion" disabled={running || generation.occupied || !model}>{title}</button>}
        <button type="button" className="sek" disabled={cancelling || active?.cancelling || (!!active && !active.progress)} onClick={() => void cancel()}>{t("cancel")}</button>
        {running && <button type="button" className={active ? "aktion" : "sek"} onClick={onClose}>{t(active ? "stem_layer_background" : "queue_background")}</button>}
      </div>
    </form>
  </Dialog>;
}
