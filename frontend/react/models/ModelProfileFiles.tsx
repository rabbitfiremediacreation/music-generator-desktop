import { modelName, modelRoleLabel, type profile } from "../../model-options";
import { useI18n } from "../i18n";
import { ProfileLink } from "./ProfileLink";

export function ModelProfileFiles({ selected }: { selected: ReturnType<typeof profile> }) {
  const { t, language } = useI18n();
  const number = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
  const bytes = (value: number) => {
    if (value < 1024) return `${number.format(value)} B`;
    if (value < 1024 ** 2) return `${number.format(value / 1024)} KiB`;
    if (value < 1024 ** 3) return `${number.format(value / 1024 ** 2)} MiB`;
    return `${number.format(value / 1024 ** 3)} GiB`;
  };
  return <details className="model-picker-disclosure model-files-card">
    <summary>{t("browser_files")}</summary>
    <ul>{selected.models.map(model => <li key={model.file}>
      <span className="model-file-icon" aria-hidden="true">{model.verified ? "✓" : "↓"}</span>
      <span className="model-file-name" title={model.file}><strong>{model.source ? <ProfileLink url={`https://huggingface.co/${model.source.repository}/blob/${model.source.revision}/${model.source.path.split("/").map(encodeURIComponent).join("/")}`}>{model.file}</ProfileLink> : modelName(model.file)}</strong><span>{t(modelRoleLabel(model.role))}</span></span>
      <span className="model-file-status"><span title={model.source ? `${number.format(model.estimated_bytes)} B · SHA-256 ${model.sha256}` : undefined}>{bytes(model.estimated_bytes)}</span><small>{t(model.verified ? "picker_installed" : model.present ? "picker_verify" : "picker_missing")}</small></span>
    </li>)}</ul>
  </details>;
}
