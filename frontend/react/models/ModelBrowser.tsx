import { useId, useState, type ReactNode } from "react";
import { familyName, familySelection, modelFamilies, type ModelFilter } from "../../model-browser";
import { profileKey } from "../../creator-models";
import { modelProfile, profileModels } from "../../model-options";
import type { ModelCatalog, ModelSelection } from "../../types";
import { useI18n } from "../i18n";
import "./model-browser.css";

export function ModelBrowser({ catalog, draft, currentSelection, onChange, compatibleOnly, onCompatibleChange, busy, children }: {
  catalog: ModelCatalog; draft: ModelSelection; onChange: (selection: ModelSelection) => void;
  currentSelection?: ModelSelection | null; compatibleOnly: boolean; onCompatibleChange: (value: boolean) => void; busy: boolean; children: ReactNode;
}) {
  const { t, language } = useI18n();
  const [query, setQuery] = useState(""), [filter, setFilter] = useState<ModelFilter>("all");
  const [previousLegacy, setPreviousLegacy] = useState<ModelSelection>();
  const detailsId = useId();
  const metadata = modelProfile(catalog, draft);
  const legacy = metadata ? previousLegacy ?? catalog.model_profiles?.["ace-step"] ?? catalog.recommended_profiles.find(selection => !modelProfile(catalog, selection)) : draft;
  const families = legacy ? modelFamilies(catalog, legacy, compatibleOnly, query, filter) : [];
  const profiles = (catalog.profiles ?? []).filter(item => {
    if (filter === "installed") {
      const files = profileModels(catalog, item.selection);
      if (!files.length || files.some(model => !model.verified)) return false;
    }
    if (filter === "recommended" && !catalog.recommended_profiles.some(selection => profileKey(selection) === profileKey(item.selection))) return false;
    const searchable = `${item.name} ${item.selection.provider} ${item.selection.synthesis}`.toLocaleLowerCase();
    return query.trim().toLocaleLowerCase().split(/\s+/).every(term => searchable.includes(term));
  });
  const model = catalog.models.find(item => item.file === draft.synthesis && item.provider === draft.provider);
  const provider = catalog.providers.find(item => item.id === draft.provider);
  const recommended = catalog.recommended_profiles.some(item => item.provider === draft.provider && item.synthesis === draft.synthesis);
  const current = currentSelection ?? catalog.selection;
  const active = current.provider === draft.provider && current.synthesis === draft.synthesis && current.language === draft.language;
  const bytes = (value: number) => `${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value / 1024 ** 3)} GiB`;
  function selectProfile(next: ModelSelection) {
    if (!metadata) setPreviousLegacy(draft);
    onChange(next);
  }
  function selectProvider(id: string) {
    const next = catalog.profiles?.find(profile => profile.selection.provider === id)?.selection
      ?? (legacy?.provider === id ? legacy : catalog.model_profiles?.[id])
      ?? catalog.recommended_profiles.find(selection => selection.provider === id);
    if (next) selectProfile(next);
  }
  return <div className="model-browser-shell"><div className="model-browser">
    <aside className="model-browser-sidebar" aria-label={t("browser_catalog")}>
      <div className="model-browser-tools">
        <label className="model-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg>
          <input type="search" aria-label={t("browser_search")} placeholder={t("browser_search")} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} />
        </label>
        <div className="model-browser-filters" role="group" aria-label={t("browser_filter")}>
          {(["all", "installed", "recommended"] as const).map(value => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{t(`browser_${value}`)}</button>)}
        </div>
        {catalog.expert_mode && <>
          <label className="model-provider"><span className="sr-only">{t("picker_provider")}</span><select disabled={busy} value={draft.provider} onChange={event => selectProvider(event.target.value)}>{catalog.providers.map(item => <option key={item.id} value={item.id}>{item.name}{item.status === "planned" ? ` · ${t("picker_planned")}` : ""}</option>)}</select></label>
          {legacy && <label className="check-row model-compatible"><input type="checkbox" checked={compatibleOnly} disabled={busy} onChange={event => onCompatibleChange(event.target.checked)} /><span>{t("picker_compatible")}</span></label>}
        </>}
      </div>
      <ul className="model-family-list" aria-label={t("browser_catalog")}>
        {legacy && families.map(family => <li key={family.id}><button type="button" className="model-family" aria-label={family.name} aria-describedby={`${detailsId}-${family.id}`} aria-pressed={!metadata && model?.family === family.id} aria-controls={detailsId} disabled={busy} onClick={() => onChange(familySelection(catalog, legacy, family))}>
          <span className={`model-family-icon${family.id.includes("-xl-") ? " is-xl" : ""}`} aria-hidden="true">{family.id.includes("-xl-") ? "XL" : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M4 10v4m4-8v12m4-15v18m4-15v12m4-8v4" /></svg>}</span>
          <span className="model-family-copy"><span className="model-family-title">{family.name}{family.recommended && <span className="model-recommended-dot" title={t("desktop_recommended")} aria-label={t("desktop_recommended")}>✦</span>}</span>
            <span className="model-family-meta" id={`${detailsId}-${family.id}`}>{family.variants.length} {t("browser_variants")} · {family.variants.filter(item => item.verified).length} {t("browser_installed").toLocaleLowerCase()}{family.recommended && <span className="sr-only"> · {t("desktop_recommended")}</span>}</span>
          </span>
          <span className="model-family-chevron" aria-hidden="true">›</span>
        </button></li>)}
        {profiles.map(item => <li key={profileKey(item.selection)}><button type="button" className="model-family" aria-label={item.name} aria-pressed={item === metadata} aria-controls={detailsId} disabled={busy} onClick={() => selectProfile(item.selection)}>
          <span className="model-family-icon" aria-hidden="true">♪</span>
          <span className="model-family-copy"><span className="model-family-title">{item.name}</span>
            {!item.available && <span className="model-family-meta">{t("provider_unavailable_short")}</span>}
          </span>
          <span className="model-family-chevron" aria-hidden="true">›</span>
        </button></li>)}
      </ul>
      {!families.length && !profiles.length && <p className="model-browser-empty" role="status">{t("browser_empty")}</p>}
      <div className="model-browser-count">{families.length + profiles.length} {t("browser_families")}</div>
    </aside>
    <div className="model-browser-details" id={detailsId}>
      <header className="model-detail-heading"><div>{(!metadata || provider?.name !== metadata.name) && <p>{provider?.name ?? draft.provider}</p>}<h4>{metadata?.name ?? familyName(model?.family ?? draft.synthesis)}</h4></div>{active && <span className="model-badge is-active">{t("browser_active")}</span>}</header>
      {!metadata && <div className="model-summary-card">
        <p className="model-description">{t("browser_profile_hint")}</p>
        <div className="model-metadata"><span><small>{t("browser_format")}</small><strong>GGUF</strong></span><span><small>{t("browser_precision")}</small><strong>{model?.precision ?? "—"}</strong></span><span><small>{t("browser_size")}</small><strong>{model ? bytes(model.estimated_bytes) : "—"}</strong></span></div>
        <div className="model-badges"><span className={`model-badge${model?.verified ? " is-installed" : ""}`}>{t(model?.verified ? "picker_installed" : model?.present ? "picker_verify" : "picker_missing")}</span>{recommended && <span className="model-badge is-recommended">✦ {t("desktop_recommended")}</span>}</div>
      </div>}
      {children}
    </div>
  </div></div>;
}
