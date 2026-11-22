import { randomTitle, STYLE_TAGS } from "../../prompts";
import { useI18n } from "../i18n";
import { DiceButton } from "./DiceButton";

export function GenerationTitleField({ id, diceId, value, onChange }: {
  id: string; diceId: string; value: string; onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  return <div className="field">
    <div className="lblrow">
      <label className="lbl" htmlFor={id} title={t("title_tip")}>{t("title")}</label>
      <DiceButton id={diceId} label={t("title_dice")} onClick={() => onChange(randomTitle())} />
    </div>
    <input id={id} name="title" value={value} placeholder={t("title_ph")} onChange={event => onChange(event.target.value)} />
  </div>;
}

export function GenerationPromptField({ id, diceId, label, hint, title, value, placeholder, rows, required, generated, generatedId, onChange, onRoll }: {
  id: string; diceId: string; label: string; hint: string; title?: string; value: string; placeholder: string; rows: number;
  required: boolean; generated?: boolean; generatedId?: string; onChange: (value: string) => void; onRoll?: () => void;
}) {
  const { t } = useI18n();
  const hintId = `${id}-hint`;
  return <div className="field">
    <div className="lblrow">
      <div className="prompt-label">
        <label className="lbl" htmlFor={id} title={title}>{label}</label>
        {generated && <span id={generatedId} className="generated-chip" role="status"
          title={t("prompt_generated")} aria-label={t("prompt_generated")}>GENERATED</span>}
      </div>
      {onRoll && <DiceButton id={diceId} label={t("prompt_dice")} onClick={onRoll} />}
    </div>
    <textarea id={id} name="prompt" rows={rows} required={required} aria-describedby={hintId}
      value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} />
    <span className="small" id={hintId}>{hint}</span>
  </div>;
}

export function GenerationStyleField({ id, diceId, chipId, label, hint, descriptionId, value, required, onChange, onRoll }: {
  id: string; diceId: string; chipId: string; label: string; hint: string; descriptionId?: string; value: string;
  required?: boolean; onChange: (value: string) => void; onRoll?: () => void;
}) {
  const { t } = useI18n();
  const styles = value.split(",").map(tag => tag.trim()).filter(Boolean);
  const hintId = `${id}-hint`;
  return <div className="field">
    <div className="lblrow">
      <label className="lbl" htmlFor={id} title={hint}>{label}</label>
      {onRoll && <DiceButton id={diceId} label={t("style_dice")} onClick={onRoll} />}
    </div>
    <textarea id={id} name="style" required={required} rows={2} aria-describedby={descriptionId ?? hintId}
      value={value} onChange={event => onChange(event.target.value)} />
    {!descriptionId && <span className="small" id={hintId}>{hint}</span>}
    {onRoll && <details className="style-suggestions">
      <summary>{t("styles")}</summary>
      <div className="chips" id={chipId}>{STYLE_TAGS.map(tag => {
        const sameStyle = (value: string) => value.toLowerCase() === tag.toLowerCase();
        const active = styles.some(sameStyle);
        return <button type="button" key={tag} className={`chip${active ? " on" : ""}`} aria-pressed={active}
          onClick={() => onChange((active ? styles.filter(value => !sameStyle(value)) : [...styles, tag]).join(", "))}>{tag}</button>;
      })}</div>
    </details>}
  </div>;
}
