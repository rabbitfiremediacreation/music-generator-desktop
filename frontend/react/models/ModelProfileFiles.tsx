import { modelName, type profile } from "../../model-options";
import { useI18n } from "../i18n";

export function ModelProfileFiles({ selected }: { selected: ReturnType<typeof profile> }) {
  const { t, language } = useI18n();
  const bytes = (value: number) => `${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value / 1024 ** 3)} GiB`;
  return <section className="model-files-card" aria-label={t("browser_files")}>
    <h5>{t("browser_files")}</h5>
    <ul>{selected.models.map(model => <li key={model.file}>
      <span className="model-file-icon" aria-hidden="true">{model.verified ? "✓" : "↓"}</span>
      <span className="model-file-name" title={model.file}><strong>{modelName(model.file)}</strong><span>{t(model.role === "synthesis" ? "dit" : model.role === "language" ? "desktop_language_model" : "picker_dependencies")}</span></span>
      <span className="model-file-status"><span>{bytes(model.estimated_bytes)}</span><small>{t(model.verified ? "picker_installed" : model.present ? "picker_verify" : "picker_missing")}</small></span>
    </li>)}</ul>
  </section>;
}
