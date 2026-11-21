import { samePin, type StemProfile, type StemRevision } from "../../stems";
import { useI18n } from "../i18n";
import { mib, StemModelUpdate } from "./StemModelTasks";
import type { StemModelManager } from "./useStemModelManager";

function inventory(profiles: StemProfile[]) {
  const rows: { profile: StemProfile; revision: StemRevision }[] = [];
  const files = new Map<string, number>();
  for (const profile of profiles) {
    for (const revision of profile.installed) {
      rows.push({ profile, revision });
      for (const file of [profile.configuration, revision.artifact]) files.set(`${file.sha256}/${file.file}`, file.bytes);
    }
  }
  return { rows, bytes: [...files.values()].reduce((total, bytes) => total + bytes, 0) };
}

export function StemInstalledModels({ manager, onAdd }: { manager: StemModelManager; onAdd: () => void }) {
  const { t } = useI18n();
  const { catalog, working, activate, inspectRemoval, install } = manager;
  const data = catalog.data;
  const { rows, bytes } = inventory(data?.models ?? []);
  return <section aria-labelledby="installed-stem-models">
    <div className="installed-models-heading">
      <div>
        <h4 id="installed-stem-models">{t("models_installed_title")} {data && <span>{rows.length}</span>}</h4>
        {data && <p className="small">{t("models_total_size")}: {mib(bytes)}</p>}
      </div>
      <button type="button" className="aktion" disabled={!data?.platform_supported} onClick={onAdd}>
        <span aria-hidden="true">＋ </span>{t("models_add")}
      </button>
    </div>
    {!!rows.length && <div className="settings-inventory-table">
      <table aria-label={t("settings_page_stems")}>
        <thead><tr><th scope="col">{t("picker_title")}</th><th scope="col">{t("stem_revision")}</th><th scope="col">{t("browser_size")}</th><th scope="col"><span className="sr-only">{t("model_actions")}</span></th></tr></thead>
        <tbody>{rows.map(({ profile, revision }) => {
          const active = samePin(revision, profile.active);
          const damaged = active && profile.status === "damaged";
          const shortRevision = revision.revision.slice(0, 12);
          return <tr key={`${profile.id}:${revision.repository}:${revision.revision}`}>
            <td>
              <span className="settings-inventory-name">{profile.name} {active && <span className="installed-active">{t("browser_active")}</span>}</span>
              <span className="small">{profile.roles.map(role => t(`stem_role_${role}`)).join(" · ")}</span>
              <span className="small">{t(active ? `stem_${profile.status}` : "stem_installed")}</span>
            </td>
            <td title={revision.revision}><code>{shortRevision}</code><span className="small stem-inventory-repository">{revision.repository}</span></td>
            <td>{mib(revision.artifact.bytes + profile.configuration.bytes)}</td>
            <td><div className="settings-inventory-actions">
              {damaged && <button type="button" className="sek" disabled={working || !data?.engine_ready}
                onClick={() => install(revision)}>{t("stem_repair")}</button>}
              {!active && <button type="button" className="sek" disabled={working || !data?.engine_ready}
                onClick={() => activate(revision)}>{t("stem_activate")}</button>}
              {active && <StemModelUpdate manager={manager} profile={profile} />}
              <button type="button" className="sek danger" aria-label={`${t("stem_remove")} · ${profile.name} · ${shortRevision}`}
                disabled={working} onClick={() => inspectRemoval(revision)}>{t("stem_remove")}</button>
            </div></td>
          </tr>;
        })}</tbody>
      </table>
    </div>}
    {data?.platform_supported && !rows.length && <p className="installed-models-empty">{t("models_installed_empty")}</p>}
  </section>;
}
