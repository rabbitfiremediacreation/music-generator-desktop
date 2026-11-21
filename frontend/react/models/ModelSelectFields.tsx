import { nativeProfileFamily } from "../../model-browser";
import { aceStepMemory, modelOptions, modelName, profile, profileModels } from "../../model-options";
import { modelLabel } from "../../expert-mode";
import type { CatalogProfile, HuggingFaceCandidate, HuggingFacePin, ModelCatalog, ModelSelection } from "../../types";
import { useI18n } from "../i18n";

interface QuantizationOption {
  value: string; name: string; size: number; present: boolean; verified: boolean; compatible?: boolean;
  discovered?: boolean; memory: number;
}

type OnlineVariant = HuggingFaceCandidate & { memory?: number };

function QuantizationList({ label, name, options, value, onChange, disabled, online, expert, onAdopt }: {
  label: string; name: string; options: QuantizationOption[]; value: string;
  onChange: (value: string) => void; disabled: boolean;
  online: OnlineVariant[]; expert: boolean; onAdopt: (pin: HuggingFacePin) => void;
}) {
  const { t, language } = useI18n();
  const number = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
  const gib = (bytes: number) => `${number.format(bytes / 1024 ** 3)} GiB`;
  return <fieldset className="model-quantizations" disabled={disabled}>
    <legend>{label}</legend>
    {options.length || online.length ? <ul>{options.map(option => <li key={option.value}>
      <label>
        <input type="radio" name={name} value={option.value} checked={option.value === value} onChange={() => onChange(option.value)} />
        <strong>{option.name}</strong>
        <span>{gib(option.size)}</span>
        <small>{t(option.verified ? "picker_installed" : option.present ? "picker_verify" : "picker_missing")}
          {` · ${t("picker_memory")} ${gib(option.memory)}`}
          {option.compatible === false && ` · ${t("picker_low_ram")}`}
          {option.discovered && ` · ${t("hf_unverified_variant")}`}
        </small>
      </label>
    </li>)}
      {online.map(({ pin, precision, role, memory }) => {
        const title = role === "language" ? modelName(pin.source.path) : precision;
        return <li key={`${pin.source.repository}/${pin.source.path}`} className="model-remote-variant">
          <div><strong title={pin.source.path}>{title}</strong>
            <small>{t("hf_unverified_variant")} · {gib(pin.bytes)}
              {memory != null && ` · ${t("picker_memory")} ${gib(memory)}`}
            </small>
          </div>
          <button type="button" className="sek" disabled={!expert} aria-label={`${t("hf_adopt")} ${title}`} onClick={() => onAdopt(pin)}>{t("hf_adopt")}</button>
        </li>;
      })}
    </ul> : <p className="small">{t("expert_mode_locked")}</p>}
    {online.length > 0 && !expert && <p className="small">{t("hf_expert_hint")}</p>}
  </fieldset>;
}

export function ModelSelectFields({ catalog, draft, metadata, onChange, compatibleOnly, busy, discovered, onAdopt }: {
  catalog: ModelCatalog; draft: ModelSelection; metadata?: CatalogProfile; onChange: (selection: ModelSelection) => void;
  compatibleOnly: boolean; busy: boolean;
  discovered: HuggingFaceCandidate[]; onAdopt: (pin: HuggingFacePin) => void;
}) {
  const { t } = useI18n();
  const online = discovered.filter(({ selection, provider, pin }) => !selection && provider === draft.provider &&
    !catalog.models.some(model => model.provider === provider && model.sha256 === pin.sha256 &&
      model.source?.repository === pin.source.repository && model.source?.path === pin.source.path));
  if (metadata) {
    const variants = (catalog.profiles ?? []).filter(item => item.engine_installed !== false && nativeProfileFamily(item) === nativeProfileFamily(metadata));
    const families = new Set(profileModels(catalog, metadata.selection).filter(file => file.role === "weights").map(file => file.family));
    const options = variants.flatMap(variant => {
      const selected = profile(catalog, variant.selection);
      const model = selected.models.find(asset => asset.precision && (asset.role === "weights" || asset.role === "synthesis"));
      if (!model) return [];
      return [{
        value: variant.selection.synthesis, name: model.precision,
        size: selected.models.reduce((total, asset) => total + asset.estimated_bytes, 0),
        discovered: model.hf_discovered,
        memory: selected.memory,
        present: selected.models.every(asset => asset.present || asset.verified),
        verified: selected.models.length === variant.files.length && selected.models.every(asset => asset.verified),
        compatible: variant.available ? selected.compatible : undefined,
      }];
    });
    return <QuantizationList label={t("browser_precision")} name="native-precision" options={options} value={draft.synthesis}
      onChange={value => { const variant = variants.find(item => item.selection.synthesis === value); if (variant) onChange(variant.selection); }}
      online={online.filter(item => item.role === "weights" && families.has(item.family))
        .map(item => ({ ...item, memory: item.estimated_ram_bytes ?? undefined }))} expert={catalog.expert_mode} onAdopt={onAdopt}
      disabled={busy} />;
  }

  const family = catalog.models.find(model => model.file === draft.synthesis && model.provider === draft.provider)?.family;
  const currentModels = profileModels(catalog, draft);
  const recommended = catalog.recommended_profiles.find(item => item.provider === draft.provider && item.synthesis === draft.synthesis);
  function nextSelection(role: "synthesis" | "language", value: string) {
    const next = { ...draft, [role]: value };
    if (role === "synthesis" && !catalog.expert_mode) {
      next.language = catalog.recommended_profiles.find(item => item.provider === draft.provider && item.synthesis === value)?.language ?? next.language;
    }
    return next;
  }
  return <div className="model-quantization-fields">
    {(["synthesis", "language"] as const).map(role => {
      const label = t(role === "synthesis" ? "browser_precision" : "desktop_language_model");
      if (role === "language" && !catalog.expert_mode) return <div className="field" key={role}>
        <span className="lbl">{label}</span><span className="small">{recommended ? `${modelLabel(recommended.language, false)} · ${t("desktop_recommended")}` : "—"}</span>
      </div>;
      const options = modelOptions(catalog, draft, role, compatibleOnly)
        .filter(model => role !== "synthesis" || model.family === family)
        .map(model => {
          const next = profile(catalog, nextSelection(role, model.file));
          return {
            value: model.file, name: role === "synthesis" ? model.precision : modelName(model.source?.path ?? model.file),
            size: model.estimated_bytes, present: model.present, verified: model.verified,
            discovered: model.hf_discovered, memory: next.memory, compatible: next.compatible,
          };
        });
      return <QuantizationList key={role} label={label} name={`precision-${role}`} options={options} value={draft[role]}
        online={online.filter(item => item.role === role && (role === "language" || item.family === family))
          .map(item => ({ ...item, memory: aceStepMemory(currentModels, { role, estimated_bytes: item.pin.bytes }) }))}
        expert={catalog.expert_mode} onAdopt={onAdopt}
        onChange={value => onChange(nextSelection(role, value))} disabled={busy} />;
    })}
  </div>;
}
