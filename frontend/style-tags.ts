const STYLE_VOCAB = [
  ["hip hop", "hip ?hop"], ["rap", "\\brap(?:per|ping)?\\b", "v"], ["boom bap", "boom ?bap"], ["trap", "\\btrap\\b"], ["lo-fi", "lo ?fi"],
  ["trip hop", "trip ?hop"], ["downtempo", "downtempo"], ["dub", "\\bdub\\b"], ["dubstep", "dubstep"],
  ["deep house", "deep house"], ["house", "\\bhouse (?:music|track|beat|groove|vibe|style|rhythm)\\b|\\b(?:tech|progressive|acid|funky|french|chicago|piano) house\\b"],
  ["techno", "techno"], ["trance", "\\btrance\\b"], ["drum and bass", "drum ?(?:and|&|n) ?bass|\\bdnb\\b|\\bjungle\\b"],
  ["breakbeat", "break ?beat"], ["garage", "uk garage|2 step|garage (?:beat|track)"], ["electro", "\\belectro\\b"], ["electronic", "electronic|\\bedm\\b"],
  ["synthwave", "synthwave|retrowave|outrun"], ["synthpop", "synth ?pop"], ["new wave", "new wave"],
  ["disco", "disco"], ["funk", "\\bfunk(?:y)?\\b"], ["soul", "\\bsoul(?:ful)?\\b"], ["neo-soul", "neo ?soul"], ["r&b", "\\br ?(?:&|and|n) ?b\\b|rhythm and blues"],
  ["gospel", "gospel"], ["jazz", "\\bjazz(?:y)?\\b"], ["blues", "\\bblues\\b"], ["rock", "\\brock\\b"], ["post-rock", "post ?rock"], ["hard rock", "hard rock"],
  ["punk", "\\bpunk\\b"], ["metal", "heavy metal|\\bmetal (?:music|track|riffs?|guitars?|band)\\b"], ["grunge", "grunge"], ["indie", "\\bindie\\b"],
  ["shoegaze", "shoegaze"], ["pop", "\\bpop\\b"], ["folk", "\\bfolk\\b"], ["country", "country (?:music|ballad|song|track|guitar)"],
  ["80s pop", "(?:80s|eighties|1980s) pop"], ["eurotrash", "euro ?trash|euro ?dance"], ["90s dance", "(?:90s|nineties|1990s) dance"], ["chillout", "chill ?out"],
  ["reggae", "reggae"], ["ska", "\\bska\\b"], ["reggaeton", "reggaeton"], ["afrobeat", "afro ?beats?"], ["latin", "\\blatin\\b|salsa|bossa ?nova|samba|cumbia"],
  ["orchestral", "orchestra"], ["cinematic", "cinematic|film score|soundtrack"], ["classical", "classical"],
  ["ambient", "\\bambient\\b"], ["dark ambient", "dark ambient"], ["acoustic", "acoustic"], ["chill", "chillhop|\\bchill\\b(?! ?out)"],
  ["piano", "\\bpiano\\b"], ["electric piano", "electric piano|rhodes|wurlitzer"], ["organ", "\\borgan\\b|hammond"], ["synth", "\\bsynth(?:esizers?|s)?\\b"],
  ["guitar", "guitar"], ["funk guitar", "funk(?:y)? guitar|wah ?wah|chicken scratch"], ["slap bass", "slap bass"], ["808 bass", "\\b808\\b"], ["bass", "\\bbass(?:line)?\\b"],
  ["drums", "\\bdrums?\\b|drum (?:break|machine|beat)"], ["strings", "\\bstrings?\\b|violin|cello"], ["brass", "\\bbrass\\b|\\bhorns?\\b|trumpet|trombone"],
  ["saxophone", "\\bsax(?:ophone)?\\b"], ["flute", "flute"], ["harp", "\\bharp\\b"], ["clavinet", "clavinet"], ["vinyl crackle", "vinyl|crackle"],
  ["turntable scratches", "scratch(?:es|ing)?\\b|turntable"], ["choir", "choir|choral"], ["vocoder", "vocoder|talk ?box"],
  ["male vocals", "\\bmale (?:vocals?|singer|voice|rapper|lead)\\b", "v"], ["female vocals", "\\bfemale (?:vocals?|singer|voice|rapper|lead)\\b", "v"], ["falsetto", "falsetto", "v"],
  ["upbeat", "upbeat|energetic|uplifting"], ["melancholic", "melancholi[cy]"], ["dreamy", "dreamy|ethereal"], ["dark", "\\bdark\\b"],
  ["groovy", "\\bgroov(?:y|e)\\b"], ["mellow", "mellow|laid ?back|relaxed"], ["gritty", "gritty|\\braw\\b"],
].map(([tag, re, kind]) => ({ tag, re: new RegExp(re, "g"), vocal: kind === "v" }));

// Reihenfolge der Plätze: Genre, Stimme, Instrument, Stimmung. Innerhalb davon in der Reihenfolge des Textes.
const TAG_VOICE = new Set(["rap", "male vocals", "female vocals", "falsetto"]);
const TAG_MOOD = new Set(["upbeat", "melancholic", "dreamy", "dark", "groovy", "mellow", "gritty"]);
const TAG_INSTR = new Set(["piano", "electric piano", "organ", "synth", "guitar", "funk guitar", "slap bass", "808 bass", "bass", "drums", "strings", "brass",
  "saxophone", "flute", "harp", "clavinet", "vinyl crackle", "turntable scratches", "choir", "vocoder"]);
const tagRank = (tag: string) => (TAG_VOICE.has(tag) ? 1 : TAG_INSTR.has(tag) ? 2 : TAG_MOOD.has(tag) ? 3 : 0);

function extractStyleTags(text: string, hasVocals: boolean, max = 6) {
  const t = String(text || "").toLowerCase().replace(/[-_/]/g, " ");
  const hits: {tag: string; start: number}[] = [];
  for (const v of STYLE_VOCAB) {
    if (v.vocal && !hasVocals) continue;
    v.re.lastIndex = 0;
    const m = v.re.exec(t);
    if (m) hits.push({ tag: v.tag, start: m.index });
  }
  // allgemeiner Begriff entfällt, wenn ein genauerer da ist: "deep house" statt auch "house", "808 bass" statt auch "bass"
  const keep = hits.filter((h) => !hits.some((o) => o.tag !== h.tag && (o.tag.endsWith(" " + h.tag) || o.tag.endsWith("-" + h.tag))));
  return keep.sort((a, b) => tagRank(a.tag) - tagRank(b.tag) || a.start - b.start).slice(0, max).map((h) => h.tag);
}


/** Merge detected sound and tempo into the editable YuE2 style tags. */
export function analyzedYue2Style(style: string, analysis: Record<string, unknown>): string {
  const description = String(analysis.caption || analysis.prompt || "").trim();
  const hasVocals = Boolean(String(analysis.lyrics || "").replace(/\[[^\]]*\]/g, "").trim());
  const tags = extractStyleTags(description, hasVocals);
  if (!tags.length && description) tags.push(...description.split(",").map(tag => tag.trim()).filter(Boolean));
  const bpm = Number(analysis.bpm);
  if (Number.isFinite(bpm) && bpm > 0 && bpm <= 300) tags.push(`${Math.round(bpm)} bpm`);
  const existing = style.split(",").map(tag => tag.trim()).filter(Boolean);
  const seen = new Set(existing.map(tag => tag.toLowerCase()));
  for (const tag of tags) {
    if (seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    existing.push(tag);
  }
  return existing.join(", ");
}

export { extractStyleTags };
