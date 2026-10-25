import { STYLE_TAGS, SECTIONS, randomPrompt, randomStyle, randomTitle } from "./prompts";
import { extractStyleTags } from "./style-tags";
import { measureMelody, describeIdea, toWav } from "./melody";
import { modelErrorText, settingsChanges } from "./expert-mode";
import { backend } from "./backend";
import { generationModels, restoreSongModels, generationModelAllowed } from "./model-picker";
import { t, LANG, setLang } from "./i18n.js";
import { exportSong, exportFolder } from "./exports";
import { samplingForSong } from "./song-sampling";
import { initializeGenerationFormPreferences, captureGenerationFormPreferences } from "./form-preferences";
import { songErrorKey } from "./song-errors";
import { generationSeconds } from "./song-timing";
import { openUrl } from "@tauri-apps/plugin-opener";
import { startLibrarySync } from "./library-sync";
import { progressText, progressBar } from "./progress";
import { notify as alert, askName } from "./dialogs";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (sec) => (isFinite(sec) ? `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}` : "");
// Ansage für Screenreader (VoiceOver, NVDA …): unsichtbare Statuszeile; urgent = sofort, unterbricht (Fehler)
function announce(text, urgent = false) {
  const el = $(urgent ? "#srAlert" : "#srStatus");
  el.textContent = "";
  setTimeout(() => { el.textContent = text; }, 50);   // erst leeren, damit gleiche Texte erneut angesagt werden
  clearTimeout(el._t); el._t = setTimeout(() => { el.textContent = ""; }, 8000);   // nicht beim späteren Durchblättern erneut vorlesen
}

// Stil-Karten, nach Art gruppiert; der Würfel mischt daraus einen Stil
let songs = [];
const jobProgress = new Map();
let currentId = null;
let onlyFav = false;       // Favoriten-Filter der Bibliothek
const openLyrics = new Set();   // Songs, deren generierte Lyrics gerade aufgeklappt sind
let exportFmt = "wav";   // Download-Format laut Einstellung (nur für die Beschriftung des Download-Knopfs)
let folders = { folders: [], all: 0, none: 0 };
let curFolder = "";      // "" = alle, "none" = unsortiert, sonst Ordner-ID
try { curFolder = localStorage.getItem("folder") || ""; } catch {}
let dragging = false;    // während des Ziehens nicht neu zeichnen
let editingId = null;   // id des Songs, dessen Titel gerade bearbeitet wird

// Erstellungszeit anzeigen, bis ein Song zum ersten Mal abgespielt wurde (danach dauerhaft ausgeblendet)
let played = new Set();
try { played = new Set(JSON.parse(localStorage.getItem("played") || "[]")); } catch {}
const markPlayed = (id) => { played.add(id); try { localStorage.setItem("played", JSON.stringify([...played])); } catch {} };
const genTime = (s) => { const seconds = generationSeconds(s); return seconds === null ? null : fmt(seconds); };

// Würfel: zufälliger Prompt. Sechs Bauformen von kurz bis lang, gespeist aus Stimmungen, Szenen, Besetzungen,
// Produktion, Verlauf und ganzen Ideen; Gesang nur, wenn der Song nicht instrumental ist. Der Stil bleibt deine Wahl.
// ---------------------------------------------------------------- Formular
const form = $("#genForm");
function addChips(el, items, onClick) {
  el.innerHTML = items.map((t) => `<span class="chip" role="button" tabindex="0">${esc(t)}</span>`).join("");
  el.querySelectorAll(".chip").forEach((c, i) => c.addEventListener("click", () => onClick(items[i])));
}
// Karten sind Schaltflächen: mit Tab erreichbar, Enter und Leertaste lösen einen Klick aus
document.addEventListener("keydown", (e) => {
  const c = e.target.closest?.('[role="button"]');
  if (c && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); c.click(); }
});

// Stil-Karten sind Schalter: an = steht im Stil-Feld (gold umrandet), aus = wird dort wieder entfernt
const styleParts = () => form.style.value.split(",").map((x) => x.trim()).filter(Boolean);
function syncStyleChips() {
  const have = new Set(styleParts().map((x) => x.toLowerCase()));
  $("#tagChips").querySelectorAll(".chip").forEach((c) => {
    const on = have.has(c.textContent.toLowerCase());
    c.classList.toggle("on", on); c.setAttribute("aria-pressed", on);
  });
}
addChips($("#tagChips"), STYLE_TAGS, (tag) => {
  const parts = styleParts(), rest = parts.filter((x) => x.toLowerCase() !== tag.toLowerCase());
  form.style.value = (rest.length < parts.length ? rest : [...parts, tag]).join(", ");
  syncStyleChips();
});
form.style.addEventListener("input", syncStyleChips);
addChips($("#sectionChips"), SECTIONS, (t) => {
  if (t === "[instrumental]") { form.instrumental.checked = true; syncLyrics(); return; }   // zurück zu ohne Gesang
  const f = form.lyrics, pos = f.selectionStart ?? f.value.length;
  const before = f.value.slice(0, pos), ins = (before && !before.endsWith("\n") ? "\n\n" : "") + t + "\n";
  f.value = before + ins + f.value.slice(pos);
  f.focus(); f.selectionStart = f.selectionEnd = pos + ins.length;
});
// Bubble-Slider: Füllstand + Wert im Knopf (BPM ganz links = Auto)
const SLIDER_FMT = { dur: (v) => fmt(v), int: (v) => String(v), temp: (v) => v.toFixed(2), bpm: (v, min) => (v <= min ? ["AUTO", true] : String(v)) };
function updateSlider(box) {
  const inp = box.querySelector("input"), min = +inp.min, max = +inp.max, v = +inp.value;
  box.style.setProperty("--p", (v - min) / (max - min));
  const out = SLIDER_FMT[box.dataset.fmt](v, min), span = box.querySelector(".knob span");
  span.textContent = Array.isArray(out) ? out[0] : out;
  span.classList.toggle("small", Array.isArray(out));
  inp.setAttribute("aria-valuetext", box.dataset.fmt === "dur" ? t("vt_dur", Math.floor(v / 60), v % 60)
    : box.dataset.fmt === "bpm" ? (v <= min ? t("vt_auto") : `${v} BPM`) : span.textContent);
  if (inp.name === "duration") $("#lenHint").hidden = v <= 300;   // ab 5:00 ehrlicher Hinweis: dauert lange, braucht viel Speicher
  if (inp.name === "variants") $("#genBtn").textContent = v > 1 ? t("generate_n", v) : t("generate");
}
const showDur = () => document.querySelectorAll(".slider").forEach(updateSlider);
export function initializeStudioFormPreferences() { return initializeGenerationFormPreferences(form, showDur); }
document.querySelectorAll(".slider").forEach((b) => { b.querySelector("input").addEventListener("input", () => updateSlider(b)); updateSlider(b); });
// Lyrics: eingeklappt; bei Instrumental steht "[Instrumental]" im Feld, Klick ins Feld schaltet Instrumental aus
const LYRICS_PLACEHOLDER = "[verse]\n…\n\n[chorus]\n…";
let lyricsStash = "";
function syncLyrics() {
  const on = form.instrumental.checked, f = form.lyrics;
  if (on) { if (f.value !== "[Instrumental]") lyricsStash = f.value; f.value = "[Instrumental]"; }
  else if (f.value === "[Instrumental]") f.value = lyricsStash;
  f.classList.toggle("dim", on);
  // Leeres Feld ohne Instrumental = automatisch: das Modell schreibt die Lyrics erst beim Generieren
  const auto = !on && !f.value.trim();
  f.classList.toggle("auto", auto);
  f.placeholder = auto ? t("auto_ph") : LYRICS_PLACEHOLDER;
  $("#lyricsHint").textContent = on ? "[Instrumental]" : auto ? t("auto_lbl") : t("own_lyrics");
}
function rollAnim(btn) { btn.classList.remove("roll"); void btn.offsetWidth; btn.classList.add("roll"); }
function rollDice(btn, field, gen) { field.value = gen(); rollAnim(btn); }
$("#diceBtn").addEventListener("click", (e) => { rollDice(e.currentTarget, form.prompt, () => randomPrompt(form.instrumental.checked)); });
$("#titleDice").addEventListener("click", (e) => rollDice(e.currentTarget, form.title, randomTitle));
$("#styleDice").addEventListener("click", (e) => { rollDice(e.currentTarget, form.style, () => randomStyle(form.instrumental.checked)); syncStyleChips(); });

// Lyrics-Würfel: lässt das Modell bei der Generierung eigene Lyrics schreiben (kein Text hier, nur "auto"),
// geht nur mit vorhandenem Prompt, weil das Modell sonst nichts hat, worüber es schreiben kann.
const lyricsDice = $("#lyricsDice");
lyricsDice.addEventListener("click", (e) => {
  e.preventDefault(); e.stopPropagation();   // <summary> soll dabei nicht auf-/zuklappen
  form.instrumental.checked = false; lyricsStash = ""; form.lyrics.value = "";
  syncLyrics();
  rollAnim(e.currentTarget);
});
// Einklappen der Lyrics (Klick auf die Kopfzeile) heißt: Instrumental. Der Würfel in der Kopfzeile ist ausgenommen (stoppt oben).
$("#lyricsBox > summary").addEventListener("click", () => {
  if ($("#lyricsBox").open && !form.instrumental.checked) { form.instrumental.checked = true; syncLyrics(); }
});
form.instrumental.addEventListener("change", () => { syncLyrics(); if (!form.instrumental.checked) $("#lyricsBox").open = true; });
form.lyrics.addEventListener("focus", () => { if (form.instrumental.checked) { form.instrumental.checked = false; syncLyrics(); } });
form.lyrics.addEventListener("input", syncLyrics);
syncLyrics();

function readForm() {
  const d = Object.fromEntries(new FormData(form));
  const num = (k, def) => (d[k] === "" || d[k] == null ? def : Number(d[k]));
  return {
    model_selection: generationModels(),
    folder_id: curFolder && curFolder !== "none" ? curFolder : null,
    title: d.title || "", prompt: d.prompt || "", style: d.style || "", lyrics: form.instrumental.checked ? "" : d.lyrics || "", instrumental: form.instrumental.checked, keep_caption: form.keep_caption.checked,
    duration: Number(form.duration.value), bpm: Number(form.bpm.value) <= Number(form.bpm.min) ? 0 : Number(form.bpm.value), keyscale: d.keyscale || "", timesignature: d.timesignature || "", vocal_language: form.instrumental.checked ? "" : d.vocal_language || "en",
    seed: num("seed", -1), variants: num("variants", 1),
    inference_steps: Number(form.inference_steps.value), lm_temperature: Number(form.lm_temperature.value),
  };
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!form.prompt.value.trim() && !form.style.value.trim()) { form.prompt.focus(); return; }
  const btn = $("#genBtn");
  if (btn.disabled) return;
  if (!generationModelAllowed()) { alert(t("expert_mode_required")); return; }
  btn.classList.remove("fired"); void btn.offsetWidth; btn.classList.add("fired");   // Animation auch bei Enter/Alt+G
  btn.disabled = true;
  try {
    const r = await backend.generate(readForm());
    announce(t("an_queued", r.ids.length));
    refresh();
  } catch (err) { alert(t("error") + ": " + modelErrorText(err, t)); }
  setTimeout(() => { btn.disabled = false; }, 600);
});
form.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.tagName === "INPUT") e.preventDefault(); });

// Auswahlfeld setzen; unbekannte Werte werden ergänzt (Tonart aus der Analyse) oder fallen auf Auto zurück
function setSelect(sel, val, add = false) {
  val = val || "";
  if (![...sel.options].some((o) => o.value === val)) {
    if (add) sel.add(new Option(val, val)); else val = "";
  }
  sel.value = val;
}

function fillForm(s) {
  const p = s.params;
  restoreSongModels(p.model_selection);
  form.title.value = s.title || "";
  form.style.value = p.style ?? p.caption;   // ältere Songs haben nur einen Text
  form.prompt.value = p.prompt ?? ""; syncStyleChips();
  form.instrumental.checked = p.lyrics === "[Instrumental]";
  form.keep_caption.checked = true;   // Prompt wörtlich ist fest die Vorgabe
  lyricsStash = ""; form.lyrics.value = form.instrumental.checked ? "" : p.lyrics || "";
  syncLyrics(); $("#lyricsBox").open = !form.instrumental.checked && !!(p.lyrics || "").trim();
  form.duration.value = p.duration || 90;
  form.bpm.value = p.bpm || form.bpm.min;
  const sampling = samplingForSong(p);
  form.inference_steps.value = sampling.inference_steps;
  form.lm_temperature.value = sampling.lm_temperature;
  showDur();
  setSelect(form.keyscale, p.keyscale, true);
  setSelect(form.timesignature, p.timesignature);
  form.vocal_language.value = p.vocal_language || "en";
  form.seed.value = p.seed;
  form.variants.value = 1; showDur();
  captureGenerationFormPreferences();
  $("#advBox").open = true;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------------------------------------------------------------- Song-Upload (Analyse)
// Geheime Dropzone: das Logo. Unauffällig, bis man draufzeigt, zieht oder es gerade etwas tut.
const dz = $("#dropzone"), bubble = $("#dzBubble"), fileInput = $("#fileInput");
let dzHideTimer = null;
function dzState(cls, text) {
  clearTimeout(dzHideTimer);
  dz.className = "logo-wrap" + (cls ? ` ${cls}` : "");
  bubble.textContent = text || "";
  bubble.classList.toggle("show", !!text);
  if (cls === "ok") dzHideTimer = setTimeout(() => { dz.className = "logo-wrap"; bubble.classList.remove("show"); }, 4000);
}
// Stilbegriffe aus der Beschreibung der Analyse ziehen: [Tag, Muster, Art]. Art "v" = Stimme (nur bei Songs mit Gesang).
// Die Tags heißen wie die Stil-Karten, damit diese aufleuchten. Weitere Begriffe stehen einfach im Stil-Feld.
async function analyzeFile(file, idea = null) {   // idea = Messwerte einer Mikrofon-Aufnahme (measureMelody)
  if (!file) return;
  dzState("busy", t("analyzing", file.name));
  try {
    const r = await backend.analyze(file, generationModels());
    form.prompt.value = idea ? describeIdea(idea, r.caption, r.keyscale) : r.caption || "";
    // Keep explicit titles; blank titles are named from the finished song locally.
   
    // Nur echter Text außerhalb von [Strukturmarkern] zählt als Gesang — sonst schreibt das
    // Modell manchmal Dinge wie "[Acoustic guitar intro]" gefolgt von "[Instrumental]".
    const hasVocals = (r.lyrics || "").replace(/\[[^\]]*\]/g, "").trim().length > 0;
    if (hasVocals) {
      // Song hat Gesang: nicht den transkribierten Text übernehmen, sondern wie beim Lyrics-Würfel
      // das Modell bei der Generierung selbst welche schreiben lassen (Prompt ist ja gerade gesetzt).
      form.instrumental.checked = false; lyricsStash = ""; form.lyrics.value = "";
      $("#lyricsBox").open = true;
      const lang = (r.vocal_language || "").toLowerCase();
      if ([...form.vocal_language.options].some(o => o.value === lang)) form.vocal_language.value = lang;
    } else { form.instrumental.checked = true; }
    syncLyrics();
    // Stil: Begriffe aus der Beschreibung ergänzen; was schon im Stil-Feld steht, bleibt
    const have = styleParts(), low = new Set(have.map((x) => x.toLowerCase()));
    const add = idea ? [] : extractStyleTags(r.caption, hasVocals).filter((x) => !low.has(x.toLowerCase()));   // bei Ideen rät die Analyse das Instrument falsch
    form.style.value = [...have, ...add].join(", "); syncStyleChips();
    if (r.bpm) { form.bpm.value = r.bpm; }
    if (r.duration && !idea) form.duration.value = Math.min(+form.duration.max, Math.max(+form.duration.min, Math.round(r.duration / 5) * 5));
    showDur();
    setSelect(form.keyscale, r.keyscale, true);
    setSelect(form.timesignature, String(r.timesignature || ""));
    captureGenerationFormPreferences();
    dzState("ok", idea ? t("idea_ready") : t("analyzed", file.name));
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (err) {
    dzState("err", `${t("error")}: ${modelErrorText(err, t)}`);
  }
}
dz.addEventListener("click", () => fileInput.click());

// ---------------------------------------------------------------- Ideengeber (Aufnahme vom Mikrofon)
// Knopf im Kopf: gedrückt halten = aufnehmen (Maus, Finger oder Leertaste), 5 bis REC_MAX Sekunden.
// Die Aufnahme geht als WAV durch dieselbe Analyse wie ein hochgeladener Song: Beschreibung, Tempo, Tonart, Takt
// kommen ins Formular; Stil und Länge bleiben unverändert. Die Melodie selbst wird nicht übernommen (ACE-Step kann keine Melodie als
// Vorgabe verarbeiten, getestet im Oktober 2026). Bewusst nur Mikrofon, kein Datei-Upload.
const REC_MAX = 30, REC_MIN = 5;
// Die Analyse des Modells kennt nur fertige Songs und hält Summen für Glockenspiel oder Synthesizer (getestet Okt. 2026).
// Deshalb beschreiben wir eine Mikrofon-Idee selbst aus Messungen: Tonhöhenverlauf (YIN), Tempo der Töne, Bindung.
// Vom Modell übernehmen wir nur Stimmungswörter, dazu Tempo und Tonart; den Stil wählt der Nutzer.
const recBtn = $("#recBtn"), recTime = $("#recTime");
let rec = null;   // laufende Aufnahme: { stream, mr, chunks, start, timer }
let recToggle = false;   // Screenreader: einmal aktivieren = Start, noch einmal = Stopp (Gedrückthalten geht mit VoiceOver nicht)

async function recStart() {
  if (rec || recBtn.classList.contains("busy")) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { dzState("err", t("rec_unsupported")); return; }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false } });
  } catch { dzState("err", t("rec_denied")); return; }
  if (!recBtn.classList.contains("held") && !recToggle) { stream.getTracks().forEach((tr) => tr.stop()); return; }   // beim Nachfragen schon losgelassen
  const mr = new MediaRecorder(stream);
  rec = { stream, mr, chunks: [], start: performance.now(), timer: 0 };
  mr.addEventListener("dataavailable", (e) => { if (e.data.size) rec.chunks.push(e.data); });
  mr.addEventListener("stop", recFinish);
  mr.start();
  recBtn.classList.add("on");
  recBtn.setAttribute("aria-pressed", "true");
  rec.timer = setInterval(() => {
    const sec = (performance.now() - rec.start) / 1000;
    recBtn.style.setProperty("--p", Math.min(1, sec / REC_MAX));
    recTime.textContent = String(Math.floor(sec));
    if (sec >= REC_MAX) recStop();
  }, 100);
}
function recStop() {
  recBtn.classList.remove("held");
  recToggle = false;
  if (!rec) return;
  clearInterval(rec.timer);
  if (rec.mr.state === "recording") rec.mr.stop();
}
async function recFinish() {
  const { stream, chunks, mr, start } = rec;
  rec = null;
  stream.getTracks().forEach((tr) => tr.stop());
  recBtn.classList.remove("on"); recBtn.style.removeProperty("--p"); recTime.textContent = "";
  recBtn.setAttribute("aria-pressed", "false");
  if (performance.now() - start < REC_MIN * 1000) { dzState("err", t("rec_short")); return; }
  recBtn.classList.add("busy");
  try {
    const { wav, mono, rate } = await toWav(new Blob(chunks, { type: mr.mimeType }));
    const idea = measureMelody(mono, rate) || { range: 5, rate: 2.5, drift: 0, legato: 0.8 };   // nichts Tonales gefunden: neutrale Werte
    await analyzeFile(new File([wav], t("rec_name"), { type: "audio/wav" }), idea);   // Name ohne Endung: so steht er in der Meldung
  } catch (err) { dzState("err", `${t("error")}: ${modelErrorText(err, t)}`); }
  recBtn.classList.remove("busy");
}
// Browser-Aufnahme (webm/mp4) in Mono-WAV 16 Bit umwandeln; leise Mikrofone werden auf -1 dB angehoben
// Gedrückt halten: Zeigerereignisse decken Maus und Finger ab, Tastatur über Leertaste/Enter
recBtn.addEventListener("pointerdown", (e) => { if (e.button === 0) { recBtn.classList.add("held"); recStart(); } });
["pointerup", "pointercancel"].forEach((ev) => window.addEventListener(ev, () => { if (recBtn.classList.contains("held")) recStop(); }));
recBtn.addEventListener("keydown", (e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); recBtn.classList.add("held"); recStart(); } });
recBtn.addEventListener("keyup", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); recStop(); } });
recBtn.addEventListener("contextmenu", (e) => e.preventDefault());
// Klick ohne Maus (detail 0) kommt vom Screenreader: umschalten statt halten. Erst ansagen, dann das Mikrofon öffnen,
// damit die Ansage nicht mit aufgenommen wird.
recBtn.addEventListener("click", (e) => {
  if (e.detail !== 0) return;
  if (rec) { recStop(); return; }
  recToggle = true;
  announce(t("an_rec_start"));
  setTimeout(() => { if (recToggle) recStart(); }, 1800);
});
window.addEventListener("blur", recStop);
dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
fileInput.addEventListener("change", () => analyzeFile(fileInput.files[0]));
["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
["dragleave", "dragend"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("drag"); analyzeFile(e.dataTransfer.files[0]); });

// ---------------------------------------------------------------- Bibliothek
function refresh() { librarySync.refresh(); }

async function loadLibrary() {
  const nextFolders = await backend.folders();
  folders = nextFolders;
  if (curFolder && curFolder !== "none" && !folders.folders.some((f) => f.id === curFolder)) setFolder("", false);
  const filter = { q: $("#search").value, favorites: onlyFav, folder: curFolder };
  const [nextSongs, qu] = await Promise.all([backend.songs(filter), backend.queue()]);
  songs = nextSongs;
  const active = new Set(qu.running.map((s) => s.id));
  for (const id of jobProgress.keys()) if (!active.has(id)) jobProgress.delete(id);
  if (qu.progress && active.has(qu.progress.job_id)) rememberProgress(qu.progress);
  announceChanges(songs);
  if (!dragging) renderFolders();
  if (!editingId && !dragging) render();
  libStats = qu.library; showLibStats();
}

// Update only the active row; keep players, focus, drag state and open lyrics intact.
function applyProgress(progress) {
  const song = songs.find((s) => s.id === progress.job_id);
  if (song && song.status !== "running") return;
  if (!rememberProgress(progress)) return;
  const row = $("#library").querySelector(`[data-id="${CSS.escape(progress.job_id)}"]`);
  const status = row?.querySelector(".generation-progress");
  if (status) status.innerHTML = progressMarkup(progress);
}

function rememberProgress(progress) {
  const previous = jobProgress.get(progress.job_id);
  if (previous && previous.sequence >= progress.sequence) return false;
  jobProgress.set(progress.job_id, progress);
  return true;
}

function progressMarkup(progress, message = "0:00") {
  return `<div class="s run">${esc(progress ? progressText(progress, t) : message)}</div>${progressBar(progress)}`;
}

// Ansage, wenn ein Song fertig wird oder scheitert (beim ersten Laden nur merken, nichts sagen)
const lastStatus = new Map();
function announceChanges(list) {
  const first = lastStatus.size === 0;
  for (const s of list) {
    const was = lastStatus.get(s.id);
    if (!first && was && was !== s.status) {
      const name = (s.title || s.caption.split(",").slice(0, 3).join(",")) + (s.letter ? ` ${s.letter}` : "");
      if (s.status === "done") announce(t("an_done", name));
      if (s.status === "error") announce(t("an_error", name), true);
    }
    lastStatus.set(s.id, s.status);
  }
}

// Tastenkürzel (mit Alt bzw. Option, damit sie nicht mit dem Tippen oder dem Screenreader kollidieren):
// Alt+G generieren, Alt+R Aufnahme starten/beenden, Alt+B zur Bibliothek, Alt+N zum Formular
document.addEventListener("keydown", (e) => {
  if (!e.altKey || e.ctrlKey || e.metaKey) return;
  const act = { KeyG: () => form.requestSubmit(), KeyR: () => recBtn.dispatchEvent(new MouseEvent("click", { detail: 0 })),
                KeyB: () => $("#libHeading").focus(), KeyN: () => form.prompt.focus() }[e.code];
  if (act) { e.preventDefault(); act(); }
});

let libStats = null;
function showLibStats() {
  if (!libStats) return;
  const mb = libStats.bytes / 1048576, nf = (v, d) => v.toLocaleString(LANG, { maximumFractionDigits: d });
  $("#libStats").textContent = libStats.count ? `${libStats.count} Songs · ${mb >= 1024 ? nf(mb / 1024, 1) + " GB" : nf(mb, 0) + " MB"}` : "";
}

function render() {
  const lib = $("#library");
  if (!songs.length) { lib.innerHTML = `<div class="empty">${t("empty")}</div>`; return; }
  lib.innerHTML = songs.map((s, i) => {
    const m = s.result_meta || {}, p = s.params || {};
    const newGroup = i > 0 && songs[i - 1].group_id !== s.group_id;
    const title = (s.title || s.caption.split(",").slice(0, 3).join(",")) + (s.letter ? ` ${s.letter}` : "");
    const meta = [
      m.bpm && `${m.bpm}BPM`,
      p.inference_steps ? `${p.inference_steps}IT` : null,
      p.lm_temperature != null ? `${(+p.lm_temperature).toFixed(1)}VAR` : null,
      m.keyscale, m.duration && fmt(m.duration),
    ].filter(Boolean).join(" · ");
    const playing = s.id === currentId && ws?.isPlaying();
    let left, state = "";
    if (s.status === "done") left = `<button class="aktion round" data-a="play" aria-label="${t("play")}">${playing ? "❚❚" : "▶"}</button>`;
    else if (s.status === "error") left = `<div class="slot err" title="${esc(s.message)}">!</div>`;
    else if (s.status === "running") left = `<div class="slot run">♪</div>`;
    else left = `<div class="slot">${s.status === "cancelled" ? "✕" : "…"}</div>`;
    if (s.status === "running") state = `<div class="generation-progress">${progressMarkup(jobProgress.get(s.id), s.message || "0:00")}</div>`;
    if (s.status === "queued") state = `<div class="s">${t("waiting")}</div>`;
    if (s.status === "cancelled") state = `<div class="s">${t("cancelled")}</div>`;
    if (s.status === "error") state = `<div class="s err" title="${esc(s.message)}">${t("error")} · ${esc(shortErr(s.message))}</div>`;
    if (s.status === "done" && !played.has(s.id)) { const tm = genTime(s); if (tm) state = `<div class="s took">${t("created_in")} ${tm}</div>`; }
    // Vom Modell geschriebener Text (nur bei Songs mit Gesang)
    if (s.status === "done" && m.title_generation_error) state += `<div class="s err" title="${esc(m.title_generation_error)}">${t("title_failed")}</div>`;
    const lyr = s.status === "done" && s.lyrics !== "[Instrumental]" && /[^\s\[\]]/.test((m.lyrics || "").replace(/\[[^\]]*\]/g, "")) ? m.lyrics.trim() : "";
    const actions = [
      s.status === "done" && `<button class="sek icon ${s.favorite ? "on" : ""}" data-a="fav" title="${t("fav")}">${s.favorite ? "★" : "☆"}</button>`,
      s.status === "done" && `<button type="button" class="download icon fmt" data-a="export" title="${t("download")}">${exportFmt === "mp3" || s.file.endsWith(".mp3") ? "MP3" : "WAV"}</button>`,
      lyr && `<button class="sek icon txt ${openLyrics.has(s.id) ? "on" : ""}" data-a="lyrics" title="${t("show_lyrics")}">TXT</button>`,
      folders.folders.length > 0 && `<button class="sek icon" data-a="move" title="${t("move")}"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></button>`,
      `<button class="sek icon" data-a="more" title="${t("more")}">＋</button>`,
      `<button class="sek icon" data-a="reuse" title="${t("reuse")}"><svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M12 3l7 7h-4v10h-6V10H5l7-7z"/></svg></button>`,
      ["error", "cancelled"].includes(s.status) && `<button class="sek icon" data-a="retry" title="${t("retry")}">↻</button>`,
      armedKey === `song:${s.id}`
        ? `<button class="sek icon del armed" data-a="del" data-arm="song:${s.id}" title="${t("del_q")}">?</button>`
        : `<button class="sek icon del" data-a="del" data-arm="song:${s.id}" title="${["queued", "running"].includes(s.status) ? t("cancel") : t("del")}">✕</button>`,
    ].filter(Boolean).join("");
    return `<div class="song ${s.id === currentId ? "playing" : ""}${newGroup ? " new-group" : ""}" data-id="${s.id}" draggable="${folders.folders.length > 0 && s.id !== editingId}">
      ${left}
      <div style="min-width:0">${s.id === editingId
        ? `<input class="t-edit" data-id="${s.id}" value="${esc(s.title || "")}" placeholder="${esc(s.caption.split(",").slice(0, 3).join(","))}">`
        : `<div class="t" data-a="rename" role="heading" aria-level="3" title="${t("rename")}">${esc(title)}</div>`
      }<div class="m" title="${t("meta_tip")}">${esc(meta)}</div>${state}</div>
      <div class="actions">${actions}</div>${lyr && openLyrics.has(s.id)
        ? `<div class="lyr-wrap"><pre class="lyr">${esc(lyr)}</pre><button type="button" class="download mini lyr-dl" data-a="export-lyrics" title="${t("lyrics_dl")}">TXT ↓</button></div>`
        : ""}</div>`;
  }).join("");
  // Symbolknöpfe: Tooltip auch als Name für Screenreader
  lib.querySelectorAll("button[title]:not([aria-label]), a[title]:not([aria-label])")
    .forEach((el) => el.setAttribute("aria-label", el.title));
}
function shortErr(msg = "") {
  return t(songErrorKey(msg));
}

$("#library").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-a]");
  if (!btn) return;
  const id = btn.closest(".song").dataset.id, s = songs.find((x) => x.id === id);
  const a = btn.dataset.a;
  if (a === "play") return play(s);
  if (a === "rename") { editingId = id; render(); const inp = $(`.t-edit[data-id="${id}"]`); inp?.focus(); inp?.select(); return; }
  if (a === "export" || a === "export-lyrics") { await exportSong(s, a === "export-lyrics").catch(e => alert(e.message)); return; }
  if (a === "fav") await backend.patch(id, { favorite: !s.favorite });
  if (a === "reuse") return fillForm(s);
  if (a === "move") return moveMenu(btn, id);
  if (a === "lyrics") { openLyrics.has(id) ? openLyrics.delete(id) : openLyrics.add(id); return render(); }
  if (a === "retry") {
    try { await backend.retry(id); } catch (error) { alert(modelErrorText(error, t)); }
  }
  if (a === "more") {
    const p = s.params;
    try {
      await backend.generate({ ...p, instrumental: false, keep_caption: p.use_cot_caption !== true, title: s.title || "", seed: -1, variants: 1, group_id: s.group_id, folder_id: s.folder_id });
    } catch (error) { alert(modelErrorText(error, t)); }
  }
  if (a === "del") {
    // Löschen in zwei Klicks: erster Klick macht aus ✕ ein ?, zweiter Klick auf dieselbe Stelle löscht.
    // Abbrechen laufender oder wartender Songs geht weiter mit einem Klick.
    if (!["queued", "running"].includes(s.status) && armedKey !== `song:${id}`) { arm(`song:${id}`); return; }
    disarm(false);
    await backend.remove(id).catch((err) => alert(modelErrorText(err, t)));
  }
  refresh();
});
// Zwei-Klick-Bestätigung statt Browser-Dialog (Song löschen, Ordner löschen, Server stoppen): der erste Klick
// schaltet den Knopf scharf (rot, Rückfrage im Knopf), der zweite an derselben Stelle führt aus. Nach 3 s oder bei
// einem Klick woandershin fällt er zurück. armedKey sagt, welcher Knopf scharf ist: "song:<id>", "folder:<id>", "stop".
let armedKey = null, armedTimer = 0;
function arm(key) {
  armedKey = key;
  clearTimeout(armedTimer);
  armedTimer = setTimeout(() => disarm(), 3000);
  redrawArmed();
  document.querySelector(`[data-arm="${CSS.escape(key)}"]`)?.focus();   // Tastatur: Enter ein zweites Mal führt aus
  announce(t("an_armed"));
}
function disarm(redraw = true) {
  if (!armedKey) return;
  armedKey = null;
  clearTimeout(armedTimer);
  if (redraw) redrawArmed();
}
function redrawArmed() { render(); renderFolders(); }
document.addEventListener("click", (e) => { if (armedKey && !e.target.closest("[data-arm]")) disarm(); }, true);

// ---------------------------------------------------------------- Ordner
function setFolder(id, reload = true) {
  curFolder = id;
  try { localStorage.setItem("folder", id); } catch {}
  if (reload) refresh();
}
function renderFolders() {
  const chip = (id, name, n) => `<span class="chip fold${id === curFolder ? " on" : ""}" role="button" tabindex="0" aria-pressed="${id === curFolder}" data-f="${id}" title="${esc(name)}">${esc(name)} <b>${n}</b></span>`;
  const cur = folders.folders.find((f) => f.id === curFolder);
  const hadFocus = document.activeElement?.closest?.("#folderBar") ? document.activeElement.dataset.f : undefined;   // Tastaturfokus nach dem Neuzeichnen behalten
  $("#folderBar").innerHTML =
    chip("", t("f_all"), folders.all) +
    (folders.folders.length ? chip("none", t("f_none"), folders.none) : "") +
    folders.folders.map((f) => chip(f.id, f.name, f.count)).join("") +
    `<button type="button" class="chip add" data-fa="new" title="${t("f_new")}" aria-label="${t("f_new")}">＋</button>` +
    `<span class="fold-actions">` +
    (cur ? `<button type="button" class="sek mini" data-fa="rename">${t("f_rename")}</button>${armedKey === `folder:${cur.id}`
      ? `<button type="button" class="sek mini armed" data-fa="delete" data-arm="folder:${cur.id}" title="${esc(t("f_delete_q", cur.name))}">${t("f_delete_sure")}</button>`
      : `<button type="button" class="sek mini" data-fa="delete" data-arm="folder:${cur.id}">${t("f_delete")}</button>`}` : "") +
    `<button type="button" class="download mini" data-fa="zip" title="${t("f_zip_tip")}">${cur ? t("f_zip") : t("f_zip_all")}</button></span>`;
  if (hadFocus !== undefined) $("#folderBar").querySelector(`[data-f="${CSS.escape(hadFocus)}"]`)?.focus();
}
async function moveSong(id, folderId) {
  await backend.patch(id, { folder_id: folderId === "none" ? null : folderId }).catch((e) => alert(e.message));
  refresh();
}
$("#folderBar").addEventListener("click", async (e) => {
  const c = e.target.closest("[data-f]");
  if (c) return setFolder(c.dataset.f);
  const a = e.target.closest("[data-fa]")?.dataset.fa;
  const cur = folders.folders.find((f) => f.id === curFolder);
  try {
    if (a === "new") {
      const name = await askName(t("f_name_q"));
      if (name?.trim()) setFolder((await backend.saveFolder(name)).id);
    } else if (a === "rename" && cur) {
      const name = await askName(t("f_name_q"), cur.name);
      if (name?.trim()) { await backend.saveFolder(name, cur.id); refresh(); }
    } else if (a === "delete" && cur) {
      if (armedKey !== `folder:${cur.id}`) { arm(`folder:${cur.id}`); return; }
      disarm(false);
      await backend.deleteFolder(cur.id); setFolder("");
    } else if (a === "zip") { await exportFolder(curFolder); }
  } catch (err) { alert(t("error") + ": " + modelErrorText(err, t)); }
});
// Song auf einen Ordner ziehen
// (Text in den Lyrics soll markierbar bleiben, Knöpfe sollen klicken statt ziehen)
$("#library").addEventListener("mousedown", (e) => {
  const row = e.target.closest(".song");
  if (row) row.draggable = folders.folders.length > 0 && !e.target.closest(".lyr, .t-edit, button, a");
});
$("#library").addEventListener("dragstart", (e) => {
  const row = e.target.closest?.(".song");
  if (!row) return;
  dragging = true;
  e.dataTransfer.setData("text/song", row.dataset.id);
  e.dataTransfer.effectAllowed = "move";
});
document.addEventListener("dragend", () => { dragging = false; document.querySelectorAll(".chip.drop").forEach((c) => c.classList.remove("drop")); refresh(); });
const dropChip = (e) => (e.dataTransfer.types.includes("text/song") ? e.target.closest?.(".chip.fold:not([data-f=''])") : null);
$("#folderBar").addEventListener("dragover", (e) => { const c = dropChip(e); if (c) { e.preventDefault(); c.classList.add("drop"); } });
$("#folderBar").addEventListener("dragleave", (e) => e.target.closest?.(".chip")?.classList.remove("drop"));
$("#folderBar").addEventListener("drop", (e) => {
  const c = dropChip(e);
  if (!c) return;
  e.preventDefault(); dragging = false;
  moveSong(e.dataTransfer.getData("text/song"), c.dataset.f);
});
// Ordner-Knopf in der Songzeile: kleines Menü mit allen Ordnern
function moveMenu(btn, id) {
  document.querySelector(".movemenu")?.remove();
  const s = songs.find((x) => x.id === id), m = document.createElement("div");
  m.className = "movemenu";
  m.innerHTML = [["none", t("f_none")], ...folders.folders.map((f) => [f.id, f.name])]
    .map(([fid, name]) => `<button type="button" data-f="${fid}" class="${(s.folder_id || "none") === fid ? "on" : ""}">${esc(name)}</button>`).join("");
  document.body.append(m);
  const r = btn.getBoundingClientRect();
  m.style.top = `${Math.min(r.bottom + 4, innerHeight - m.offsetHeight - 8)}px`;
  m.style.left = `${Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8))}px`;
  m.addEventListener("click", (e) => { const b = e.target.closest("[data-f]"); if (b) { m.remove(); moveSong(id, b.dataset.f); } });
  setTimeout(() => document.addEventListener("click", function close(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener("click", close); } }), 0);
}
window.addEventListener("scroll", () => document.querySelector(".movemenu")?.remove(), true);

async function commitRename(inp) {
  const id = inp.dataset.id;
  if (editingId !== id) return;   // per Escape schon abgebrochen
  editingId = null;
  const s = songs.find((x) => x.id === id), title = inp.value.trim();
  if (s && title !== (s.title || "")) await backend.patch(id, { title });
  refresh();
}
$("#library").addEventListener("focusout", (e) => { const inp = e.target.closest(".t-edit"); if (inp) commitRename(inp); });
$("#library").addEventListener("keydown", (e) => {
  const inp = e.target.closest(".t-edit");
  if (!inp) return;
  if (e.key === "Enter") { e.preventDefault(); inp.blur(); }
  if (e.key === "Escape") { e.preventDefault(); editingId = null; render(); }
});
$("#search").addEventListener("input", () => { clearTimeout(refresh.s); refresh.s = setTimeout(refresh, 250); });
$("#onlyFav").addEventListener("click", (e) => {
  onlyFav = !onlyFav;
  e.currentTarget.setAttribute("aria-pressed", onlyFav);
  e.currentTarget.textContent = onlyFav ? "★" : "☆";
  refresh();
});

// ---------------------------------------------------------------- Player
let ws = null;
function initPlayer() {
  const css = getComputedStyle(document.documentElement);
  ws = WaveSurfer.create({
    container: "#waveform", height: 44, barWidth: 2, barGap: 1, barRadius: 2,
    waveColor: css.getPropertyValue("--border").trim() || "#2a2e38",
    progressColor: css.getPropertyValue("--accent2").trim() || "#d1a75c", cursorWidth: 0,
  });
  const upd = () => { $("#pTime").textContent = `${fmt(ws.getCurrentTime())} / ${fmt(ws.getDuration())}`; };
  ws.on("timeupdate", upd); ws.on("ready", upd);
  ws.on("play", () => { $("#playBtn").textContent = "❚❚"; render(); });
  ws.on("pause", () => { $("#playBtn").textContent = "▶"; render(); });
  ws.on("finish", () => { $("#playBtn").textContent = "▶"; render(); });
  $("#playBtn").onclick = () => ws.playPause();
  initVolume();
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !e.target.closest?.('input, textarea, select, button, [role="button"]') && currentId) { e.preventDefault(); ws.playPause(); }
  });
}
// Lautstärke: Regler klappt beim Zeigen auf den Lautsprecher aus; Klick auf den Lautsprecher = stumm
let volume = 1, muted = false;
try {
  const saved = localStorage.getItem("volume");
  if (saved !== null && isFinite(+saved)) volume = Math.min(1, Math.max(0, +saved));
  muted = localStorage.getItem("muted") === "1";
} catch {}
function applyVolume() {
  ws?.setVolume(muted ? 0 : volume);
  const v = muted ? 0 : volume;
  $("#vol").dataset.level = v === 0 ? "off" : v < 0.5 ? "low" : "high";
  $("#volRange").value = Math.round(volume * 100);
  $("#volRange").setAttribute("aria-valuetext", `${Math.round(volume * 100)} %`);
  $("#vol").style.setProperty("--v", volume);
  $("#volBtn").title = $("#volBtn").ariaLabel = t(muted ? "unmute" : "mute");
  try { localStorage.setItem("volume", String(volume)); localStorage.setItem("muted", muted ? "1" : "0"); } catch {}
}
function initVolume() {
  $("#volRange").addEventListener("input", (e) => { volume = e.target.value / 100; muted = false; applyVolume(); });
  $("#volBtn").addEventListener("click", () => { muted = !muted; if (!muted && volume === 0) volume = 0.5; applyVolume(); });
  applyVolume();
}

let playSeq = 0;   // jede Wiedergabe-Anfrage bekommt eine Nummer: nach dem Laden zählt nur die neueste
async function play(s) {
  if (!ws) initPlayer();
  if (currentId === s.id) return ws.playPause();
  const seq = ++playSeq;
  if (ws.isPlaying()) ws.pause();   // der bisherige Song verstummt sofort, nicht erst nach dem Laden des neuen
  if (!played.has(s.id)) { markPlayed(s.id); render(); }
  currentId = s.id;
  $("#player").hidden = false;
  if (!play.ro) {   // Höhe des Players ändert sich, sobald die Wellenform geladen ist
    play.ro = new ResizeObserver(() => document.documentElement.style.setProperty("--player-h", $("#player").offsetHeight + "px"));
    play.ro.observe($("#player"));
  }
  $("#pTitle").textContent = s.title || s.caption;
  $("#pTitle").title = `Seed ${s.seed}` + (s.result_meta?.keyscale ? ` · ${s.result_meta.keyscale}` : "");
  try { await ws.load(s.url); } catch (err) { if (seq === playSeq) throw err; return; }   // abgebrochen, weil inzwischen ein anderer Song gewählt wurde
  if (seq !== playSeq) return;
  ws.play();
  render();
}

// ---------------------------------------------------------------- Einstellungen & Status
async function checkHealth() {
  const el = $("#status");
  try {
    const h = await backend.health();
    el.className = "box small " + (h.ok ? "" : "err");
    el.textContent = h.ok ? "" : t("offline");   // bei "alles ok" nichts anzeigen
    el.title = h.error || (h.props ? `${t("models")}: ${Object.values(h.props.models || {}).flat().join(", ")}` : t("model_server"));
    return h;
  } catch { el.className = "box small err"; el.textContent = t("backend_offline"); }
}
const dlg = $("#settingsDlg"), sf = $("#settingsForm");
let settingsBefore;
$("#btnSettings").onclick = async () => {
  const s = await backend.settings();
  settingsBefore = s;
  sf.expert_mode.checked = s.expert_mode;
  for (const k of ["timeout_minutes", "songs_dir", "lm_device", "export_format"]) sf[k].value = s[k];
  sf.export_format.querySelector("option[value=mp3]").disabled = !s.mp3_available;
  $("#expHint").hidden = s.mp3_available;
  $("#settingsIntelHint").hidden = !s.cpu_only;
  sf.songs_dir.placeholder = s.songs_dir_default;   // Standard als Platzhalter, leer lassen = Standard
  dlg.returnValue = "";
  dlg.showModal();
};
const saveSettings = async () => {
  const values = settingsChanges(settingsBefore, { expert_mode: sf.expert_mode.checked, timeout_minutes: Number(sf.timeout_minutes.value), songs_dir: sf.songs_dir.value.trim(), lm_device: sf.lm_device.value, export_format: sf.export_format.value });
  if (!Object.keys(values).length) return;
  try { await backend.saveSettings(values); }
  catch (err) { alert(err.message === "mp3_failed" ? t("mp3_failed") : modelErrorText(err, t)); $("#btnSettings").click(); }
};
document.addEventListener("open-settings", () => { $("#btnSettings").click(); });
$("#settingsModelPicker").onclick = () => { dlg.close("cancel"); document.dispatchEvent(new Event("open-model-picker")); };
// Anordnung: untereinander oder Generator links / Bibliothek rechts
function setLayout(l) {
  document.querySelector(".wrap").classList.toggle("side", l !== "stack");
  document.documentElement.classList.toggle("side", l !== "stack");
  document.querySelectorAll("[data-layout]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.layout === l)));
  try { localStorage.setItem("desktop_layout", l); } catch {}
}
document.querySelectorAll("[data-layout]").forEach(b => b.onclick = () => setLayout(b.dataset.layout));
try { setLayout(localStorage.getItem("desktop_layout") || "auto"); } catch { setLayout("auto"); }

// Desktop releases are downloaded as complete bundles.
const updInfo = $("#updInfo"), updList = $("#updList"), updApply = $("#updApply");
$("#updCheck").onclick = async () => {
  updInfo.textContent = t("upd_search"); updApply.hidden = true;
  try {
    const r = await backend.checkUpdate();
    updInfo.textContent = r.available ? r.current + " → " + r.latest : t("upd_current", r.current);
    updApply.hidden = !r.available;
    updApply.onclick = () => openUrl(r.url);
  } catch (e) { updInfo.textContent = e.message; }
};
$("#manageModels").onclick = () => { dlg.close("cancel"); document.dispatchEvent(new Event("manage-models")); };

const loadExportFmt = () => backend.settings().then((s) => { exportFmt = s.export_format === "mp3" ? "mp3" : "wav"; }).catch(() => {});
dlg.addEventListener("close", async () => { if (dlg.returnValue === "save") { await saveSettings(); await loadExportFmt(); render(); checkHealth(); } });

// Sprachumschalter (DE | EN)
$("#uiLang").addEventListener("change", (e) => setLang(e.target.value));
document.addEventListener("langchange", () => {
  showDur(); syncLyrics(); render(); renderFolders(); showLibStats(); checkHealth();
  updInfo.textContent = ""; updList.hidden = true; updApply.hidden = true;
});

checkHealth();
setInterval(checkHealth, 15000);
loadExportFmt().then(() => render());
const librarySync = startLibrarySync(loadLibrary, applyProgress);
export const studioReady = librarySync.ready;
window.addEventListener("focus", refresh);
window.addEventListener("pagehide", () => librarySync.stop(), { once: true });

document.addEventListener("studio-ready", () => { void refresh(); void checkHealth(); });
