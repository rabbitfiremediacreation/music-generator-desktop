import TITLE from "../assets/random-titles.json";

const STYLE_GROUPS = {
  genre: ["trip hop", "downtempo", "dub", "deep house", "techno", "drum and bass", "post-rock", "neo-soul", "dark ambient", "boom bap", "orchestral",
    "pop", "rock", "hip hop", "electronic", "lo-fi", "jazz", "ambient", "synthwave", "acoustic", "cinematic",
    "country", "80s pop", "eurotrash", "90s dance", "chillout"],
  vocals: ["female vocals", "male vocals"],
  instr: ["piano", "guitar"],
  mood: ["upbeat", "melancholic", "dreamy"],
};
const STYLE_TAGS = [...STYLE_GROUPS.genre, ...STYLE_GROUPS.vocals, ...STYLE_GROUPS.instr, ...STYLE_GROUPS.mood];
const SECTIONS = ["[intro]", "[verse]", "[pre-chorus]", "[chorus]", "[bridge]", "[outro]", "[instrumental]"];

const R = {
  mood: ["dark", "dreamy", "melancholic", "hypnotic", "warm", "tense", "nostalgic", "euphoric", "lonely", "mysterious", "hopeful", "gritty",
    "serene", "haunting", "playful", "triumphant", "bittersweet", "restless", "tender", "icy", "sun-drenched", "menacing", "weightless", "feverish",
    "majestic", "wistful", "cheeky", "solemn", "glowing", "ghostly"],
  scene: ["a late night drive through a neon city", "a rainy afternoon in an empty café", "walking through fog at dawn", "an abandoned space station",
    "a quiet forest after snowfall", "a crowded market at sunset", "floating above the clouds", "a smoky club after midnight", "a desert road at sunrise",
    "an old arcade at closing time", "a lighthouse during a storm", "the last train home", "a rooftop above a sleeping city", "an underwater research lab",
    "a ballroom after the guests have left", "a carnival packing up at dawn", "a cathedral filled with candlelight", "a slow river at golden hour",
    "a highway at 3 a.m. with the windows down", "a childhood bedroom found years later", "a spaceship drifting past Jupiter", "a wedding in a thunderstorm",
    "a boxing gym before the big fight", "a lonely gas station in the snow", "a parade marching through a ghost town", "a greenhouse humming with bees",
    "a submarine running silent", "a rooftop garden in the rain", "a film noir stakeout", "a summer fair at twilight", "the first morning after a breakup",
    "a mountain village waking up", "a chase across the rooftops of an old city", "a cold war radio station at night", "a jazz bar on a cruise ship",
    "a library where the books whisper", "the final lap of a race", "a long goodbye at an airport", "a campfire by a black lake", "a robot learning to dance"],
  band: ["a full symphony orchestra", "a string quartet", "solo piano", "a brass band", "a lone acoustic guitar", "a big band with screaming horns",
    "a church organ", "a chamber choir", "vintage analog synthesizers", "a drum machine and a single bass line", "a mariachi ensemble", "a gospel choir and Hammond organ",
    "a harp and distant woodwinds", "marching drums and a trumpet", "a jazz trio late in the set", "a wall of distorted guitars", "a music box and cello",
    "steel drums and upright bass", "a bluegrass band on a porch", "a lone trumpet over sparse piano", "pipe organ and timpani", "a ukulele and whistling",
    "a tango orchestra", "a string section and a ticking drum machine", "an accordion and a double bass", "a 90s rave rig", "a bedroom producer with a cheap sampler",
    "a children's choir and glockenspiel", "an 80s synth-pop setup with gated drums", "a lo-fi cassette four-track"],
  production: ["recorded live in one take", "lo-fi and dusty", "polished and radio-ready", "wide and cinematic", "dry and intimate", "drenched in reverb",
    "crisp and modern", "warm tape saturation", "slightly out of tune on purpose", "huge stadium sound", "crackling like an old record", "crystal clear and spacious",
    "raw garage recording", "glossy 80s production", "muffled as if heard through a wall"],
  arc: ["building gradually to a huge finale", "starting almost silent", "with a sudden drop in the middle", "quiet verses and an explosive chorus",
    "slowly falling apart at the end", "with a false ending", "steady from the first second to the last", "with a long atmospheric intro",
    "breaking down to a single instrument halfway", "ending on an unresolved chord", "getting faster and faster", "like a dream that keeps changing shape",
    "with a breakdown that feels like holding your breath", "circling the same idea until it transforms"],
  detail: ["slow and spacious", "with a steady pulse", "sparse and minimal", "with swelling strings", "with a soft melodic hook", "with a hypnotic repeating motif",
    "with deep warm bass", "with distant echoing textures", "with a syncopated groove", "with a bright, singable melody", "with odd time signatures",
    "with handclaps and stomps", "with a driving half-time beat", "with shimmering arpeggios", "with a wordless hum in the background", "with a melody that aches",
    "with playful call and response", "with a bass line that never stops moving", "with silence used as an instrument", "with a riff you can't shake"],
  vocals: ["sung by a raspy male voice", "with a soft female lead", "with layered harmonies", "with a choir answering the lead", "half spoken, half sung",
    "with a powerful belting vocal", "whispered close to the mic", "with a lazy, laid-back delivery", "with a soulful ad-lib at the end", "a duet between two voices"],
  idea: ["a sea shanty sung on a spaceship", "a tango for two robots", "a lullaby for a thunderstorm", "a marching band in slow motion", "a love song to a city that doesn't exist",
    "a western theme for a dusty planet", "a waltz for the last day of summer", "a funeral march that turns into a party", "a video game boss fight as an opera",
    "a disco track for ghosts", "a hymn for a lighthouse keeper", "a jingle for a shop that sells time", "a spy theme set in a rainforest", "a cowboy lost in Tokyo",
    "a tiny orchestra inside a music box", "a victory anthem for a losing team", "a dance track for a thunder god", "a lullaby a robot sings to itself",
    "a chase scene scored by a string quartet", "a sad song that pretends to be happy", "the national anthem of a country made of clouds", "a monk discovering techno",
    "a pirate ballad about missing home", "a late-night infomercial from the future", "a bedtime story for a dragon", "the sound of a train station remembering everyone",
    "a surf rock song about the moon", "an opera about a lost sock", "a reggae song for a snowstorm", "a baroque fugue played by a jazz trio"],
};
const pick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];
const cap = (str: string) => str.charAt(0).toUpperCase() + str.slice(1);
const randomPrompt = (instrumental: boolean) => {
  const vox = !instrumental && Math.random() < 0.4 ? pick(R.vocals) : "";
  const forms = [
    () => pick(R.idea),                                                           // ganze Idee, kurz
    () => `${pick(R.mood)} ${pick(R.band)}, ${pick(R.scene)}`,                     // Stimmung + Besetzung + Szene
    () => `${pick(R.mood)}, ${pick(R.scene)}, ${pick(R.detail)}`,                  // klassisch
    () => `${pick(R.idea)}, ${pick(R.production)}, ${pick(R.arc)}`,                // Idee ausgebaut
    () => `${pick(R.band)} playing something ${pick(R.mood)} and ${pick(R.mood)}, ${pick(R.detail)}, ${pick(R.production)}`,
    () => `${pick(R.scene)}: ${pick(R.band)}, ${pick(R.mood)} and ${pick(R.mood)}, ${pick(R.detail)}, ${pick(R.production)}, ${pick(R.arc)}`,   // lang
  ];
  let text = pick(forms)();
  text = text.replace(/\b(\w+) and \1\b/, "$1");   // zweimal dieselbe Stimmung vermeiden
  return cap(vox ? `${text}, ${vox}` : text);
};

// Ein Genre, dazu null bis zwei weitere Begriffe (zweites Genre, Instrument, Stimmung, bei Gesang auch Stimme):
// höchstens drei Begriffe, gern auch nur einer
const randomStyle = (instrumental: boolean) => {
  const genre = pick(STYLE_GROUPS.genre);
  let second;
  do second = pick(STYLE_GROUPS.genre); while (second === genre);
  const pool = [second, pick(STYLE_GROUPS.instr), pick(STYLE_GROUPS.mood)];
  if (!instrumental) pool.push(pick(STYLE_GROUPS.vocals));
  const extra = Math.floor(Math.random() * 3);   // 0, 1 oder 2
  const parts = [genre];
  for (let i = 0; i < extra; i++) parts.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return parts.join(", ");
};
const randomTitle = () => `${pick(TITLE.adj)} ${pick(TITLE.noun)}`;

export { STYLE_TAGS, SECTIONS, randomPrompt, randomStyle, randomTitle };
