import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { samePin, stemApi, stemError, type HubHit, type Pin, type StemProfile } from "../../stems";
import { useI18n } from "../i18n";
import { mib, stemInstallLabel, StemModelUpdate, StemRemovalConfirmation, StemRuntimeRequirement, StemTransferProgress } from "./StemModelTasks";
import type { StemModelManager } from "./useStemModelManager";

const catalogPin = (model: StemProfile): Pin => ({ model: model.id, repository: model.repository, revision: model.revision });

export function StemModelCatalog({ manager, onOpenEngines }: {
  manager: StemModelManager; onOpenEngines: () => void;
}) {
  const { t } = useI18n();
  const { catalog, error, working, transfer, updates, install, run } = manager;
  const [local, setLocal] = useState("");
  const [filter, setFilter] = useState("all");
  const [role, setRole] = useState("");
  const [compatible, setCompatible] = useState(false);
  const [input, setInput] = useState("");
  const [limit, setLimit] = useState(15);
  const [hits, setHits] = useState<HubHit[]>();
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  useEffect(() => {
    if (!input.trim()) return;
    let current = true;
    const timer = setTimeout(() => {
      setSearching(true);
      setSearchError("");
      void stemApi.search(input, limit).then(
        value => { if (current) setHits(value); },
        cause => { if (current) { setHits(undefined); setSearchError(stemError(cause, t)); } },
      ).finally(() => { if (current) setSearching(false); });
    }, 300);
    return () => {
      current = false;
      clearTimeout(timer);
      void stemApi.cancelSearch().catch(() => {});
    };
  }, [input, limit, t]);

  const models = catalog.data?.models ?? [];
  const visible = models.filter(profile =>
    [profile.name, profile.author, profile.repository].some(value => value.toLocaleLowerCase().includes(local.toLocaleLowerCase()))
    && (filter !== "installed" || profile.installed.length > 0)
    && (filter !== "updates" || Boolean(updates[profile.id]?.pin && !samePin(updates[profile.id].pin, profile.active)))
    && (!role || profile.roles.includes(role))
    && (!compatible || profile.status !== "unsupported"),
  );

  return <section className="stem-models" onKeyDown={event => {
    if (event.key === "Enter" && event.target instanceof HTMLInputElement && event.target.type === "search") event.preventDefault();
  }}>
    {catalog.isPending && <p role="status">{t("desktop_checking")}</p>}
    {(error || catalog.error) && <p className="err" role="alert">{error || stemError(catalog.error, t)}</p>}
    <StemRuntimeRequirement catalog={catalog.data} onOpenEngines={onOpenEngines} />
    <StemTransferProgress manager={manager} />
    <div className="stem-row">
      <label className="field">{t("stem_search_local")}<input type="search" value={local} onChange={event => setLocal(event.target.value)} /></label>
      <label className="field">{t("stem_model")}<select value={filter} onChange={event => setFilter(event.target.value)}>
        <option value="all">{t("stem_all_models")}</option><option value="installed">{t("stem_installed")}</option><option value="updates">{t("stem_updates")}</option>
      </select></label>
      <label className="field">{t("stem_track")}<select value={role} onChange={event => setRole(event.target.value)}>
        <option value="">{t("stem_all_models")}</option>
        {[...new Set(models.flatMap(model => model.roles))].map(value => <option key={value} value={value}>{t(`stem_role_${value}`)}</option>)}
      </select></label>
      <label className="stem-check"><input type="checkbox" checked={compatible} onChange={event => setCompatible(event.target.checked)} />{t("stem_compatible_device")}</label>
    </div>
    {visible.map(profile => {
      const pin = catalogPin(profile);
      const updating = transfer === profile.id;
      const pendingArtifact = profile.pending?.artifact ?? profile.active?.artifact ?? profile.artifact;
      const done = profile.downloaded;
      const needsInstall = profile.status !== "ready" || Boolean(profile.pending);
      const total = pendingArtifact.bytes + profile.configuration.bytes;
      return <article className="stem-block" key={profile.id}>
        <div className="stem-row stem-spread">
          <strong>{profile.name}</strong>
          <span className="small">{t(updating ? "stem_installing" : `stem_${profile.status}`)}</span>
        </div>
        <p className="small">{profile.roles.map(value => t(`stem_role_${value}`)).join(" · ")} · CPU · {mib(profile.artifact.bytes + profile.configuration.bytes)}</p>
        <div className="stem-row">
          {needsInstall && catalog.data?.engine_ready && <button type="button" className="sek" disabled={working} onClick={() => install(profile.pending ?? profile.active ?? pin)}>
            {t(stemInstallLabel(profile))}
          </button>}
          {!working && profile.pending && <button type="button" className="sek" onClick={() => void run(() => stemApi.discard(profile.id))}>{t("stem_discard")}</button>}
          <StemModelUpdate manager={manager} profile={profile} />
        </div>
        {profile.pending && !updating && <div className="stem-progress">
          <progress value={done} max={total} aria-label={t("picker_download")} />
          <span className="small">{mib(done)} / {mib(total)}</span>
        </div>}
        {profile.error && <p className="small err" role="alert">{t(profile.error)}</p>}
        <details><summary>{t("stem_advanced")}</summary>
          <button type="button" className="sek mini" onClick={() => void openUrl(`https://huggingface.co/${profile.repository}`)}>{profile.repository}</button>
          <p className="small">{profile.author} · {profile.architecture} · {profile.engine} {profile.engine_version} · {profile.code_license}</p>
          <p className="small">{t("stem_weight_terms")}</p>
          {[profile.configuration, profile.artifact].map(file => <p key={file.file} className="small">{file.file} · <code>{file.sha256}</code></p>)}
          <p className="small">{t("stem_revision")} <code>{profile.revision}</code></p>
          {profile.installed.map(installed => <div className="stem-row" key={`${installed.repository}:${installed.revision}`}>
            <span className="small" title={installed.revision}>{installed.repository} · {installed.revision.slice(0, 12)} · {mib(installed.artifact.bytes)}</span>
            {samePin(installed, profile.active) ? <span className="small">{t("stem_ready")}</span> :
              <button type="button" className="sek mini" disabled={working} onClick={() => manager.activate(installed)}>{t("stem_activate")}</button>}
            <button type="button" className="sek mini" disabled={working} onClick={() => manager.inspectRemoval(installed)}>{t("stem_remove")}</button>
          </div>)}
        </details>
      </article>;
    })}
    {catalog.isSuccess && !visible.length && <p>{t("stem_no_results")}</p>}
    <StemRemovalConfirmation manager={manager} />
    <div className="stem-block">
      <label className="field">{t("stem_search_hf")}<input type="search" placeholder={t("stem_hf_hint")} value={input}
        onChange={event => { setInput(event.target.value); setLimit(15); setHits(undefined); setSearchError(""); setSearching(false); }} /></label>
      {searching && <p role="status">{t("hf_loading")}</p>}
      {searchError && <p className="err" role="alert">{searchError}</p>}
      {hits?.length === 0 && <p>{t("stem_no_results")}</p>}
      {hits?.map(hit => <div className="stem-row stem-hit" key={hit.repository}>
        <button type="button" className="sek mini" onClick={() => void openUrl(`https://huggingface.co/${hit.repository}`)}>{hit.repository}</button>
        <span className="small">{t(hit.pin && hit.adapter_check_required ? "stem_candidate" : hit.pin ? (catalog.data?.engine_ready ? "stem_hf_supported" : "stem_hf_engine") : "stem_hf_unconfirmed")}
          {hit.license ? ` · ${hit.license}` : ""}{hit.restricted ? ` · ${t("stem_hf_restricted")}` : ""}</span>
        {hit.pin && catalog.data?.engine_ready && <button type="button" className="sek mini" disabled={working} onClick={() => install(hit.pin!)}>{t("stem_install")}</button>}
      </div>)}
      {hits && hits.length >= limit && limit < 60 && <button type="button" className="sek" onClick={() => setLimit(limit + 15)}>{t("stem_load_more")}</button>}
    </div>
  </section>;
}
