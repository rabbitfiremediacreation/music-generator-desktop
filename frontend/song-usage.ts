import catalog from "../models/catalog.json";
import { bundledProfile } from "./expert-mode";
import { songMachineGeneratedBy } from "./song-result";
import type { Song } from "./types";

const modelSourceRoles = ["official", "weights", "checkpoint", "weights_codec", "mimetic_weights_vae"];
const aceStepSources = [
  "https://github.com/ace-step/ACE-Step-1.5#-license--disclaimer",
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
  return { text, sources };
}

/** Resolve output terms from the song's own data, independently of the active model and installed files. */
export function songUsage(song: Song, language: string, translate: (key: string) => string) {
  const selection = song.params.model_selection;
  const legacyMiniMax = (!selection || selection.provider === "minimax-music3") &&
    (song.engine === "minimax-music3" || songMachineGeneratedBy(song) === "MiniMax-Music3");
  const knownProfile = bundledProfile(selection) ?? (legacyMiniMax ? miniMaxProfile : undefined);
  const engineProvider = song.engine === "acestep_cpp" ? "ace-step" : song.engine;
  const provider = knownProfile?.selection.provider ?? selection?.provider ?? engineProvider;
  const reference = Boolean(song.params.reference_audio || song.params.remix || provider === "mulacover");
  const saved = savedUsage(song.result_meta?.output_usage, language);
  if (saved) return { ...saved, reference, short: undefined };

  if (knownProfile) {
    const { usage, upstream_sources } = knownProfile;
    const modelSource = upstream_sources.find(source => modelSourceRoles.includes(source.role)) ?? upstream_sources[0];
    const sources = [...new Set([usage.policy_url, modelSource?.license_url].filter((url): url is string => Boolean(url)))];
    const text = translate(provider === "yue2" && language === "de" ? "yue2_usage_outputs" : usage.outputs);
    return { text, sources, reference, short: usage.outputs === "mulacover_outputs" ? "song_usage_noncommercial" : undefined };
  }

  if (provider === "ace-step") {
    return { text: translate("song_usage_ace_step"), sources: aceStepSources, reference, short: undefined };
  }

  const knownProvider = catalog.providers.some(candidate => candidate.id === provider);
  return { text: translate(knownProvider ? "song_usage_unconfirmed" : "song_usage_unknown"), sources: [], reference, short: undefined };
}
