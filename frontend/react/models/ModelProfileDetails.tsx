import { openUrl } from "@tauri-apps/plugin-opener";
import { useId } from "react";
import type { CatalogProfile } from "../../types";
import { useI18n } from "../i18n";

export function ProfileLink({ url, children }: { url: string; children: string }) {
  return <a href={url} onClick={event => { event.preventDefault(); void openUrl(url).catch(() => {}); }}>{children}</a>;
}

export function ModelProfileDetails({ profile, bytes, total }: { profile: CatalogProfile; bytes: (value: number) => string; total: number }) {
  const { t } = useI18n();
  const commandId = useId();
  return <section className="model-summary-card model-profile-details" aria-label={t("provider_license_usage")}>
    <dl>
      {profile.capabilities.output_kind === "midi"
        ? <div><dt>{t("browser_format")}</dt><dd>{t("midi_format")}</dd></div>
        : <div><dt>{t("length")}</dt><dd>{t("provider_duration_hint", profile.capabilities.min_duration, profile.capabilities.max_duration)}</dd></div>}
      <div><dt>{t("provider_runtime")}</dt><dd><ProfileLink url={profile.runtime.source}>{profile.runtime.name}</ProfileLink>{" "}<code>{profile.runtime.revision}</code> · <ProfileLink url={profile.runtime.license_url}>{profile.runtime.license}</ProfileLink></dd></div>
      {profile.install_command && <div>
        <dt><label htmlFor={commandId}>{t("provider_runtime_install")}</label></dt>
        <dd><textarea id={commandId} className="model-runtime-command" readOnly rows={3} spellCheck={false} value={profile.install_command} onFocus={event => event.currentTarget.select()} /></dd>
      </div>}
      {profile.upstream_sources.map(source => <div key={source.id}>
        <dt>{t(`provider_source_${source.role}`)}</dt>
        <dd><ProfileLink url={`https://huggingface.co/${source.repository}/tree/${source.revision}`}>{source.repository}</ProfileLink>{" "}<code>{source.revision}</code> · <ProfileLink url={source.license_url}>{source.license}</ProfileLink></dd>
      </div>)}
      <div><dt>{t("provider_model_use")}</dt><dd>
        {t(profile.usage.model_use)}
        {profile.usage.policy_url && <> · <ProfileLink url={profile.usage.policy_url}>{t("provider_usage_policy")}</ProfileLink></>}
      </dd></div>
      <div><dt>{t("provider_redistribution")}</dt><dd>{t(profile.usage.redistribution)}</dd></div>
      <div><dt>{t("provider_outputs")}</dt><dd>{t(profile.usage.outputs)}</dd></div>
      <div><dt>{t("provider_acquisition")}</dt><dd>{t(profile.acquisition === "manual" ? "provider_manual_hint" : "provider_download_hint")}</dd></div>
      {total > 0 && <div><dt>{t(profile.acquisition === "manual" ? "browser_size" : "provider_total_download")}</dt><dd>{bytes(total)}</dd></div>}
      <div><dt>{t("provider_tested_platforms")}</dt><dd>
        {profile.platforms.length ? <ul>{profile.platforms.map(platform => <li key={`${platform.os}/${platform.arch}/${platform.backend}`}>
          {`${platform.os} · ${platform.arch} · ${platform.backend} · RAM ${bytes(platform.minimum_ram_bytes)}`}
          {platform.minimum_vram_bytes != null && ` · VRAM ${bytes(platform.minimum_vram_bytes)}`}
        </li>)}</ul> : t("provider_no_tested_platforms")}
      </dd></div>
    </dl>
    {!profile.available && <p className="setup-error" role="status">{t(profile.unavailable_reason || "provider_unavailable")}</p>}
  </section>;
}
