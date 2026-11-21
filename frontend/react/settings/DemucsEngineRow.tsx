import type { StemCatalog } from "../../stems";
import { useI18n } from "../i18n";

export function DemucsEngineRow({ catalog, busy, installing, onInstall }: {
  catalog: StemCatalog; busy: boolean; installing: boolean; onInstall: () => void;
}) {
  const { t } = useI18n();
  const { platform_supported: supported, engine_ready: installed, python_required: python } = catalog;
  const status = !supported ? "stem_unsupported" : installing ? "engine_installing" : installed ? "picker_installed" : "picker_missing";
  const install = t("engine_install");
  const name = t("stem_engine");
  const version = catalog.models[0]?.engine_version;
  return <tr>
    <th scope="row">
      <span className="settings-inventory-name">{name}</span>
      <span className="small">{t("stem_models")}</span>
      <span className="small">{t(status)}</span>
      {supported && !installed && <span className="small">{t(python ? "stem_engine_hint" : "stem_shared_engine_hint")}</span>}
    </th>
    <td className="engine-versions">{version ? <code>{version}</code> : "—"}</td>
    <td>—</td>
    <td><div className="settings-inventory-actions engine-actions">
      {supported && !installed && <button type="button" className="sek engine-action--install" disabled={busy}
        aria-label={`${install} · ${name}`} onClick={onInstall}>{install}</button>}
    </div></td>
  </tr>;
}
