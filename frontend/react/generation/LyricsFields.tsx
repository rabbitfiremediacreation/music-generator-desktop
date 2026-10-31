import { useRef } from "react";
import { SECTIONS } from "../../prompts";
import { useI18n } from "../i18n";
import { VOCAL_LANGUAGES, type FormValues } from "./form-state";
import { DiceButton } from "./DiceButton";

interface Props { values: FormValues; update: (patch: Partial<FormValues>) => void; open: boolean; setOpen: (open: boolean) => void }
export function LyricsFields({ values, update, open, setOpen }: Props) {
  const { t } = useI18n(), textarea = useRef<HTMLTextAreaElement>(null);
  const auto = !values.instrumental && !values.lyrics.trim();
  function section(value: string) {
    if (value === "[instrumental]") { update({ instrumental: true }); return; }
    const field = textarea.current, lyrics = values.lyrics;
    const pos = field?.selectionStart ?? lyrics.length, before = lyrics.slice(0, pos), insert = `${before && !before.endsWith("\n") ? "\n\n" : ""}${value}\n`;
    update({ instrumental: false, lyrics: before + insert + lyrics.slice(pos) });
    requestAnimationFrame(() => { field?.focus(); field?.setSelectionRange(pos + insert.length, pos + insert.length); });
  }
  return <details id="lyricsBox" open={open} title={t("lyrics_tip")}>
    <summary onClick={event => { event.preventDefault(); if (open && !values.instrumental) update({ instrumental: true }); setOpen(!open); }}><span>{t("lyrics")} <span id="lyricsHint" className="sumhint">{values.instrumental ? "[Instrumental]" : auto ? t("auto_lbl") : t("own_lyrics")}</span></span><span className="dice-wrap"><DiceButton id="lyricsDice" label={t("lyrics_dice")} onClick={() => update({ instrumental: false, lyrics: "" })} /></span></summary>
    <label className="field lang"><span className="lbl">{t("language")}</span><select name="vocal_language" aria-label={t("language_aria")} value={values.vocal_language} onChange={event => update({ vocal_language: event.target.value })}>{VOCAL_LANGUAGES.map(language => <option key={language} value={language}>{t(language)}</option>)}</select></label>
    <textarea ref={textarea} name="lyrics" aria-label={t("lyrics")} rows={7} className={values.instrumental ? "dim" : auto ? "auto" : undefined} value={values.instrumental ? "[Instrumental]" : values.lyrics} placeholder={auto ? t("auto_ph") : "[verse]\n…\n\n[chorus]\n…"} onFocus={() => { if (values.instrumental) update({ instrumental: false }); }} onChange={event => update({ lyrics: event.target.value })} />
    <div className="chips" id="sectionChips">{SECTIONS.map(value => <button type="button" className="chip" key={value} onClick={() => section(value)}>{value}</button>)}</div>
  </details>;
}
