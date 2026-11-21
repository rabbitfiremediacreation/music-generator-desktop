import { bundledProfile, modelErrorText } from "../expert-mode";
import { pathErrorText } from "../path-dialogs";
import { useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { GenerationProgress } from "../GenerationActivity";
import type { ModelSelection } from "../types";
import { useI18n } from "./i18n";
import { AudioControls } from "./audio/AudioControls";
import type { ReferenceAudio } from "./audio/useReferenceAudio";
import { useGenerationStatus } from "./generation/GenerationStatus";
import { generationPolicyQuery } from "./data";

export function Header({selection,onAnalysis,reference,blocked=false}:{
  selection:ModelSelection|null;onAnalysis:(values:Record<string,unknown>,microphone:boolean)=>void;
  reference?:ReferenceAudio;blocked?:boolean;
}){
  const {t}=useI18n();
  const policy=useQuery(generationPolicyQuery(selection));
  const abilities = policy.data?.capabilities ?? bundledProfile(selection)?.capabilities;
  const hasLanguageModel = abilities?.advanced ?? (selection === null || Boolean(selection.language));
  const canAnalyze = policy.data?.analysis_available ?? abilities?.analysis ?? hasLanguageModel;
  const supportsReference = Boolean(abilities?.reference_audio);
  const { active } = useGenerationStatus();
  const referenceLabel = t("mulacover_reference_pick");
  const referenceLoading = t("audio_reference_loading");
  const referenceError = reference?.error ? pathErrorText(modelErrorText(reference.error, t)) : "";
  return <header className="top">
    <AudioControls key={`${selection?.provider ?? ""}:${canAnalyze}`} selection={selection} onAnalysis={onAnalysis} enabled={canAnalyze}
      unavailableHint={selection?.provider === "yue2" ? t("yue2_analysis_requires_ace_step") : undefined}
      blocked={blocked} generating={active} referencePicker={supportsReference && reference ? {
        label: referenceLabel,
        descriptionId: "generation-reference-hint",
        selected: Boolean(reference.file),
        disabled: !selection || policy.data?.available === false || reference.picking,
        pick: () => { void reference.pick(referenceLabel); },
      } : undefined} />
    <a className="brand-link" href="https://alphatester.rabbitfire.de/" title={t("brand_title")} onClick={event=>{event.preventDefault();void openUrl(event.currentTarget.href);}}><img className="brand" src="/alphatester.png" alt="Alphatester"/></a>
    <div className="divider"/><h1 className="title"><span>MUSIC</span><span>GENERATOR</span></h1>
    {supportsReference && reference && <div className="reference-audio-status">
      <span id="generation-reference-hint" className="small">{t("mulacover_reference_hint")}</span>
      {reference.picking && <GenerationProgress wave={false} className="reference-audio-progress" label={referenceLoading} details={referenceLoading} />}
      {reference.file && <>
        <span className="reference-audio-file">{reference.file.name ?? t("mulacover_previous_reference")}</span>
        <label className="reference-audio-rights"><input type="checkbox" checked={reference.approved} disabled={blocked || reference.picking}
          onChange={event => reference.setApproved(event.target.checked)} />{t("mulacover_reference_rights")}</label>
      </>}
      {referenceError && <span className="setup-error" role="alert">{referenceError}</span>}
    </div>}
  </header>;
}
