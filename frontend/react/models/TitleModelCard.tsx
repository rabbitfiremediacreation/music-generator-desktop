import { useId } from "react";
import type { ModelCatalog } from "../../types";
import { useI18n } from "../i18n";

export function TitleModelCard({ catalog, disabled, onDownload }: {
  catalog: ModelCatalog; disabled: boolean; onDownload: () => void;
}) {
  const { t, language } = useI18n();
  const heading = useId();
  const model = catalog.title_model;
  const size = new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(model.estimated_bytes / 1024 ** 3);
  const required = Math.max(0, model.estimated_bytes - model.partial_bytes) + 64 * 1024 ** 2;
  const spaceLow = !model.present && catalog.free_bytes !== null && required > catalog.free_bytes;
  return <section className="title-model-card" aria-labelledby={heading}>
    <h3 id={heading}>{t("title_model")}</h3>
    <p className="small">{t("title_model_hint")}</p>
    <p className="small" role="status">Qwen3 0.6B Q8 · {size} GiB · {t(model.verified ? "picker_installed" : model.present ? "picker_verify" : "picker_missing")}</p>
    {!model.verified && <button type="button" className="sek" disabled={disabled || catalog.busy || spaceLow} onClick={onDownload}>
      {t(model.present ? "title_model_verify" : "title_model_download")}
    </button>}
  </section>;
}
