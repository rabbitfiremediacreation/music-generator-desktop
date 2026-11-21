import type { ReactNode } from "react";
import type { EnginePackage, EngineVersion } from "../../types";
import { useI18n } from "../i18n";

const engineLabels: Record<string, { runtime: string; models: string }> = {
  "ace-step": { runtime: "acestep.cpp", models: "ACE-Step" },
  "audio-cpp": { runtime: "audio.cpp", models: "HeartMuLa, Stable Audio 3, MuLaCover" },
  yue2: { runtime: "yue2.cpp", models: "YuE2" },
  pytorch: { runtime: "PyTorch", models: "Mimetic A0, Text2midi" },
  mimetic: { runtime: "PyTorch", models: "Mimetic A0" },
  magenta: { runtime: "MLX", models: "Magenta RealTime 2" },
  audiocraft: { runtime: "PyTorch", models: "AudioCraft (MusicGen, MAGNeT)" },
  diffrhythm2: { runtime: "PyTorch CUDA", models: "DiffRhythm 2" },
  text2midi: { runtime: "PyTorch", models: "Text2midi" },
};

function Version({ version, showBuild = false }: { version: EngineVersion; showBuild?: boolean }) {
  const parts = showBuild ? version.revision : version.revision.split(":", 1)[0];
  const revision = parts.replace(/\b([0-9a-f]{12})[0-9a-f]{28,}\b/gi, "$1").replaceAll(":", " · ");
  return <code className="wrap-anywhere" title={version.revision}>{[version.tag, revision].filter(Boolean).join(" · ")}</code>;
}

export function EngineTable({ packages, busy, onInstall, onRemove, children }: {
  packages: EnginePackage[]; busy: boolean; onInstall: (id: string) => void; onRemove: (id: string) => void;
  children?: ReactNode;
}) {
  const { t, language } = useI18n();
  const number = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
  const downloadSize = (bytes: number) => bytes >= 1024 ** 3
    ? `${number.format(bytes / 1024 ** 3)} GiB`
    : `${number.format(bytes / 1024 ** 2)} MiB`;
  return <div className="settings-inventory-table engine-table">
    <table aria-label={t("settings_page_engines")}>
      <thead><tr><th scope="col">{t("settings_page_engines")}</th><th scope="col">{t("version")}</th><th scope="col">{t("browser_size")}</th><th scope="col"><span className="sr-only">{t("model_actions")}</span></th></tr></thead>
      <tbody>{packages.map(engine => {
        const { runtime = engine.id, models } = engineLabels[engine.id] ?? {};
        const packageLabel = models ? `${runtime} · ${models}` : runtime;
        const status = engine.update_available ? "engine_update_available" : engine.installed ? "picker_installed" : "picker_missing";
        const action = engine.update_available ? "update" : "install";
        const install = t(`engine_${action}`);
        const remove = t("engine_remove");
        const { installed_version: installed, available_version: available } = engine;
        const compareVersions = Boolean(installed && available && engine.update_available);
        const showBuild = compareVersions && installed?.revision.split(":", 1)[0] === available?.revision.split(":", 1)[0];
        return <tr key={engine.id}>
          <th scope="row">
            <span className="settings-inventory-name">{runtime}</span>
            {models && <span className="small">{models}</span>}
            <span className="small">{t(status)}</span>
            {engine.install_command && <span className="small">{t("engine_manual")} <code className="wrap-anywhere">{engine.install_command}</code></span>}
          </th>
          <td className="engine-versions">
            {installed && <div>
              {compareVersions && <span className="engine-version-label">{t("engine_version_installed")} </span>}
              <Version version={installed} showBuild={showBuild} />
            </div>}
            {available && (!installed || compareVersions) && <div>
              {compareVersions && <span className="engine-version-label">{t("engine_version_available")} </span>}
              <Version version={available} showBuild={showBuild} />
            </div>}
          </td>
          <td>{engine.bytes > 0 ? downloadSize(engine.bytes) : "—"}</td>
          <td><div className="settings-inventory-actions engine-actions">
            {engine.bytes > 0 && (!engine.installed || engine.update_available) &&
              <button type="button" className={`sek engine-action--${action}`} disabled={busy} aria-label={`${install} · ${packageLabel}`} onClick={() => onInstall(engine.id)}>{install}</button>}
            {engine.removable && <button type="button" className="sek engine-action--remove" disabled={busy}
              aria-label={`${remove} · ${packageLabel}`} onClick={() => onRemove(engine.id)}>{remove}</button>}
          </div></td>
        </tr>;
      })}{children}</tbody>
    </table>
  </div>;
}
