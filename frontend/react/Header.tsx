import { bundledProfile } from "../expert-mode";
import { useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { ModelSelection } from "../types";
import { useI18n } from "./i18n";
import { AudioControls } from "./audio/AudioControls";
import { generationPolicyQuery } from "./data";

export function Header({selection,onAnalysis}:{selection:ModelSelection|null;onAnalysis:(values:Record<string,unknown>,microphone:boolean)=>void}){
  const {t}=useI18n();
  const policy=useQuery(generationPolicyQuery(selection));
  const abilities = policy.data?.capabilities ?? bundledProfile(selection)?.capabilities;
  const hasLanguageModel = abilities?.advanced ?? (selection === null || Boolean(selection.language));
  return <header className="top">
    {(abilities?.analysis ?? hasLanguageModel) && <AudioControls selection={selection} onAnalysis={onAnalysis}/>}
    <a className="brand-link" href="https://alphatester.rabbitfire.de/" title={t("brand_title")} onClick={event=>{event.preventDefault();void openUrl(event.currentTarget.href);}}><img className="brand" src="/alphatester.png" alt="Alphatester"/></a>
    <div className="divider"/><h1 className="title"><span>MUSIC</span><span>GENERATOR</span></h1>
  </header>;
}
