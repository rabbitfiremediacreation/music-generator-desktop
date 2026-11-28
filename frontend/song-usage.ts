import catalog from "../models/catalog.json";
import outputUsage from "../models/output-usage.json";
import { bundledProfile } from "./expert-mode";
import { songMachineGeneratedBy } from "./song-result";
import type { Song } from "./types";

export interface SongUsage {
  text: string;
  sources: string[];
  reference: boolean;
  badge: string;
  modelLicense?: string;
}

const modelSourceRoles = ["official", "weights", "checkpoint", "weights_codec", "mimetic_weights_vae"];
const aceStepSources = [
  catalog.ace_step_terms.policy_url,
  "https://huggingface.co/ACE-Step/Ace-Step1.5#key-features",
  "https://huggingface.co/spaces/ACE-Step/Ace-Step-v1.5/blob/cd892b3afc8348027b61f8a60c1dc96d919563a6/LICENSE",
  "https://github.com/ace-step/ACE-Step-1.5/discussions/1256",
];
const miniMaxProfile = catalog.profiles.find(({ selection }) => selection.provider === "minimax-music3");

function isHttpsSource(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { return new URL(value).protocol === "https:"; }
  catch { return false; }
}

function savedUsage(value: unknown, language: string) {
  if (!value || typeof value !== "object" || !("text" in value) || typeof value.text !== "string" || !value.text.trim()) return null;
  if (!("source_urls" in value) || !Array.isArray(value.source_urls)) return null;
  const sources = [...new Set(value.source_urls.filter(isHttpsSource))];
  if (!sources.length) return null;
  const text = language === "de" && "text_de" in value && typeof value.text_de === "string" && value.text_de.trim()
    ? value.text_de : value.text;
  return { text, sources, originalText: value.text };
}

const profileBadges: Readonly<Record<string, string>> = {
  yue2: "song_output_creator_sales",
  mulacover: "song_usage_noncommercial",
  "minimax-music3": "song_output_ai_label",
  audiocraft: "song_output_check",
  text2midi: "song_output_check",
};

/** Resolve output terms from the song's own data, independently of the active model and installed files. */
export function songUsage(song: Song, language: string, translate: (key: string) => string): SongUsage {
  const selection = song.params.model_selection;
  const legacyMiniMax = (!selection || selection.provider === "minimax-music3") &&
    (song.engine === "minimax-music3" || songMachineGeneratedBy(song) === "MiniMax-Music3");
  const knownProfile = bundledProfile(selection) ?? (legacyMiniMax ? miniMaxProfile : undefined);
  const engineProvider = song.engine === "acestep_cpp" ? "ace-step" : song.engine;
  const provider = knownProfile?.selection.provider ?? selection?.provider ?? song.params.generation_profile?.provider ?? engineProvider;
  const provenance = song.result_meta?.audio_provenance;
  const reference = Boolean(song.params.reference_audio || song.params.remix || provider === "mulacover" ||
    (provenance && typeof provenance === "object" && "reference_audio" in provenance && provenance.reference_audio === true));
  const saved = savedUsage(song.result_meta?.output_usage, language);
  if (knownProfile) {
    const { usage, upstream_sources } = knownProfile;
    const modelSource = upstream_sources.find(source => modelSourceRoles.includes(source.role)) ?? upstream_sources[0];
    const modelLicense = modelSource && (!saved || saved.sources.includes(modelSource.license_url)) ? modelSource.license : undefined;
    const badge = profileBadges[knownProfile.selection.provider] ?? "song_output_terms";
    if (saved) {
      const texts: Readonly<Record<string, string>> = outputUsage.en;
      const matches = saved.originalText === (texts[usage.outputs] ?? usage.outputs);
      return { text: saved.text, sources: saved.sources, reference, modelLicense, badge: matches ? badge : "song_output_recorded" };
    }
    const sources = [...new Set([usage.policy_url, modelSource?.license_url].filter((url): url is string => Boolean(url)))];
    const text = translate(provider === "yue2" && language === "de" ? "yue2_usage_outputs" : usage.outputs);
    return { text, sources, reference, modelLicense, badge };
  }

  if (provider === "ace-step") {
    const knownWeights = catalog.models.some(model => model.provider === provider && model.role === "synthesis" && model.file === selection?.synthesis);
    return { text: saved?.text ?? translate("song_usage_ace_step"), sources: saved?.sources ?? aceStepSources,
      reference, modelLicense: knownWeights ? catalog.ace_step_terms.licenses[0].license : undefined, badge: saved ? "song_output_recorded" : "song_output_unclear" };
  }
  if (saved) return { text: saved.text, sources: saved.sources, reference, badge: "song_output_recorded" };
  const knownProvider = catalog.providers.some(candidate => candidate.id === provider);
  return { text: translate(knownProvider ? "song_usage_unconfirmed" : "song_usage_unknown"), sources: [], reference, badge: "song_output_unclear" };
}
