import { useId, useRef, useState, type ReactNode } from "react";
import { familyName, familySelection, modelFamilies, nativeProfileFamily, type ModelFilter } from "../../model-browser";
import { profileKey } from "../../creator-models";
import { Switch } from "../../Switch";
import { modelProfile, profileModels } from "../../model-options";
import type { ModelCatalog, ModelSelection } from "../../types";
import { useI18n } from "../i18n";
import "./model-browser.css";

export function ModelBrowser({ catalog, draft, currentSelection, onChange, compatibleOnly, onCompatibleChange, busy, children, footer }: {
  catalog: ModelCatalog; draft: ModelSelection; onChange: (selection: ModelSelection) => void;
  currentSelection?: ModelSelection | null; compatibleOnly: boolean; onCompatibleChange: (value: boolean) => void; busy: boolean;
  children: ReactNode; footer?: ReactNode;
}) {
  const { t, language } = useI18n();
  const [query, setQuery] = useState(""), [filter, setFilter] = useState<ModelFilter>("all");
  const [previousLegacy, setPreviousLegacy] = useState<ModelSelection>();
  const detailsId = useId();
  const detailsRef = useRef<HTMLDivElement>(null);
  const metadata = modelProfile(catalog, draft);
  const legacy = catalog.ace_step_available === false ? undefined : metadata ? previousLegacy ?? catalog.model_profiles?.["ace-step"] ?? catalog.recommended_profiles.find(selection => !modelProfile(catalog, selection)) : draft;
  const families = legacy ? modelFamilies(catalog, legacy, compatibleOnly, query, filter) : [];
  const profiles = new Map<string, NonNullable<ModelCatalog["profiles"]>[number]>();
  const installed = (catalog.profiles ?? []).filter(item => item.engine_installed !== false);
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const providerName = (id: string) => catalog.providers.find(item => item.id === id)?.name ?? id;
  for (const item of installed) {
    if (filter === "installed") {
      const files = profileModels(catalog, item.selection);
      if (!files.length || files.some(model => !model.verified)) continue;
    }
    if (filter === "recommended" && !catalog.recommended_profiles.some(selection => profileKey(selection) === profileKey(item.selection))) continue;
    const searchable = [item.name, providerName(item.selection.provider), item.selection.provider, item.selection.synthesis,
      item.runtime.name, ...item.upstream_sources.map(source => source.repository)].join(" ").toLocaleLowerCase();
    if (!terms.every(term => searchable.includes(term))) continue;
    const key = nativeProfileFamily(item);
    if (!profiles.has(key) || item === metadata) profiles.set(key, item);
  }
  const model = catalog.models.find(item => item.file === draft.synthesis && item.provider === draft.provider);
  const provider = catalog.providers.find(item => item.id === draft.provider);
  const recommended = catalog.recommended_profiles.some(item => item.provider === draft.provider && item.synthesis === draft.synthesis);
  const current = currentSelection ?? catalog.selection;
  const active = current.provider === draft.provider && current.synthesis === draft.synthesis && current.language === draft.language;
  const bytes = (value: number) => `${new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value / 1024 ** 3)} GiB`;
  function selectProfile(next: ModelSelection) {
    if (!metadata) setPreviousLegacy(draft);
    if (detailsRef.current) detailsRef.current.scrollTop = 0;
    onChange(next);
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
        {catalog.expert_mode && legacy && <Switch className="model-compatible" label={t("picker_compatible")} checked={compatibleOnly} disabled={busy}
          onChange={event => onCompatibleChange(event.target.checked)} />}
      </div>
      <ul className="model-family-list" aria-label={t("browser_catalog")}>
        {legacy && families.map(family => <li key={family.id}><button type="button" className="model-family" aria-label={family.name} aria-describedby={`${detailsId}-${family.id}`} aria-pressed={!metadata && model?.family === family.id} aria-controls={detailsId} disabled={busy} onClick={() => selectProfile(familySelection(catalog, legacy, family))}>
          <span className={`model-family-icon${family.id.includes("-xl-") ? " is-xl" : ""}`} aria-hidden="true">{family.id.includes("-xl-") ? "XL" : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M4 10v4m4-8v12m4-15v18m4-15v12m4-8v4" /></svg>}</span>
          <span className="model-family-copy"><span className="model-family-title">{family.name}{family.recommended && <span className="model-recommended-dot" title={t("desktop_recommended")} aria-label={t("desktop_recommended")}>✦</span>}</span>
            <span className="model-family-meta" id={`${detailsId}-${family.id}`}>{family.variants.length} {t("browser_variants")} · {family.variants.filter(item => item.verified).length} {t("browser_installed").toLocaleLowerCase()}{family.recommended && <span className="sr-only"> · {t("desktop_recommended")}</span>}</span>
          </span>
          <span className="model-family-chevron" aria-hidden="true">›</span>
        </button></li>)}
        {[...profiles].map(([key, item]) => <li key={key}><button type="button" className="model-family" aria-label={item.name} aria-pressed={!!metadata && key === nativeProfileFamily(metadata)} aria-controls={detailsId} disabled={busy} onClick={() => selectProfile(item.selection)}>
          <span className="model-family-icon" aria-hidden="true">♪</span>
          <span className="model-family-copy"><span className="model-family-title">{item.name}</span>
            <span className="model-family-meta">{item.runtime.name}{!item.available && ` · ${t("provider_unavailable_short")}`}</span>
          </span>
          <span className="model-family-chevron" aria-hidden="true">›</span>
        </button></li>)}
      </ul>
      {!families.length && !profiles.size && <p className="model-browser-empty" role="status">{t("browser_empty")}</p>}
      <div className="model-browser-count">{families.length + profiles.size} {t("browser_families")}</div>
    </aside>
    <div className="model-browser-main" id={detailsId}>
      <header className="model-detail-heading">
        <div><p>{metadata?.runtime.name ?? provider?.name ?? draft.provider}</p><h4>{metadata?.name ?? familyName(model?.family ?? draft.synthesis)}</h4></div>
        <div className="model-badges">
          {active && <span className="model-badge is-active">{t("browser_active")}</span>}
          {!metadata && <span className={`model-badge${model?.verified ? " is-installed" : ""}`}>{t(model?.verified ? "picker_installed" : model?.present ? "picker_verify" : "picker_missing")}</span>}
          {recommended && <span className="model-badge is-recommended">{t("desktop_recommended")}</span>}
        </div>
      </header>
      <div className="model-browser-details" ref={detailsRef}>
        {!metadata && model && <dl className="model-metadata">
          <div><dt>{t("browser_format")}</dt><dd>GGUF</dd></div>
          <div><dt>{t("browser_size")}</dt><dd>{bytes(model.estimated_bytes)}</dd></div>
        </dl>}
        {children}
      </div>
      {footer && <footer className="model-browser-footer">{footer}</footer>}
    </div>
  </div></div>;
}
