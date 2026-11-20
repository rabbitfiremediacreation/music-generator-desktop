import { openUrl } from "@tauri-apps/plugin-opener";
import { useId } from "react";
import type { CatalogProfile, ProfilePlatform } from "../../types";
import { useI18n } from "../i18n";

export function ProfileLink({ url, children }: { url: string; children: string }) {
  return <a href={url} onClick={event => { event.preventDefault(); void openUrl(url).catch(() => {}); }}>{children}</a>;
}

export function ModelProfileDetails({ profile, bytes, total, folder }: { profile: CatalogProfile; bytes: (value: number) => string; total: number; folder?: string }) {
  const { t } = useI18n();
  const platforms = (targets: ProfilePlatform[]) => <ul>{targets.map(platform => <li key={`${platform.os}/${platform.arch}/${platform.backend}`}>
    {`${platform.os} · ${platform.arch} · ${platform.backend}`}
    {platform.minimum_ram_bytes > 0 && ` · RAM ${bytes(platform.minimum_ram_bytes)}`}
    {platform.minimum_vram_bytes != null && ` · VRAM ${bytes(platform.minimum_vram_bytes)}`}
  </li>)}</ul>;
  const commandId = useId();
  const { bars, min_duration, max_duration, output_kind } = profile.capabilities;
  return <section className="model-summary-card model-profile-details" aria-label={t("provider_license_usage")}>
    <dl>
      <div><dt>{t("provider_model_use")}</dt><dd>
        {t(profile.usage.model_use)}
        {profile.usage.policy_url && !profile.usage.noncommercial_evaluation && <> · <ProfileLink url={profile.usage.policy_url}>{t("provider_usage_policy")}</ProfileLink></>}
      </dd></div>
      <div><dt>{t("provider_outputs")}</dt><dd>{t(profile.usage.outputs)}{profile.usage.policy_url && profile.usage.noncommercial_evaluation && <> · <ProfileLink url={profile.usage.policy_url}>{t("provider_publisher_notes")}</ProfileLink></>}</dd></div>
      {output_kind === "midi"
        ? <div><dt>{t("browser_format")}</dt><dd>{t("midi_format")}</dd></div>
        : <div><dt>{t(profile.capabilities.reference_audio ? "mulacover_maximum_duration" : "length")}</dt><dd>{bars?.length ? t("clip_duration_hint", bars.join(" / "), max_duration) : t("provider_duration_hint", min_duration, max_duration)}</dd></div>}
      <div><dt>{t("provider_runtime")}</dt><dd><ProfileLink url={profile.runtime.source}>{profile.runtime.name}</ProfileLink>{" "}<code>{profile.runtime.revision}</code> · <ProfileLink url={profile.runtime.license_url}>{profile.runtime.license}</ProfileLink></dd></div>
      {!!profile.runtime.components?.length && <div><dt>{t("provider_runtime_components")}</dt><dd>
        <ul>{profile.runtime.components.map(component => <li key={component.name}>
          <ProfileLink url={component.source}>{component.name}</ProfileLink>{" "}<code>{component.revision}</code> · <ProfileLink url={component.license_url}>{component.license}</ProfileLink>
        </li>)}</ul>
      </dd></div>}
      {profile.install_command && <div>
        <dt><label htmlFor={commandId}>{t("provider_runtime_install")}</label></dt>
        <dd><textarea id={commandId} className="model-runtime-command" readOnly rows={3} spellCheck={false} value={profile.install_command} onFocus={event => event.currentTarget.select()} /></dd>
      </div>}
      {profile.upstream_sources.map(source => <div key={source.id}>
        <dt>{t(`provider_source_${source.role}`)}</dt>
        <dd><ProfileLink url={source.source_url ?? `https://huggingface.co/${source.repository}/tree/${source.revision}`}>{source.repository}</ProfileLink>{" "}<code>{source.revision}</code> · <ProfileLink url={source.license_url}>{source.license}</ProfileLink>
          {source.gated && <> · <ProfileLink url={`https://huggingface.co/${source.repository}`}>{t("provider_review_download_terms")}</ProfileLink></>}
        </dd>
      </div>)}
      <div><dt>{t("provider_redistribution")}</dt><dd>{t(profile.usage.redistribution)}</dd></div>
      <div><dt>{t("provider_acquisition")}</dt><dd>{t(profile.acquisition === "manual" ? "provider_manual_hint" : "provider_download_hint")}</dd></div>
      {folder && <div><dt>{t("provider_model_folder")}</dt><dd><code>{folder}</code></dd></div>}
      {total > 0 && <div><dt>{t(profile.acquisition === "manual" ? "browser_size" : "provider_total_download")}</dt><dd>{bytes(total)}</dd></div>}
      <div><dt>{t("provider_tested_platforms")}</dt><dd>
        {profile.platforms.length ? platforms(profile.platforms) : t("provider_no_tested_platforms")}
      </dd></div>
      {!!profile.evaluation_platforms?.length && <div><dt>{t("provider_evaluation_platforms")}</dt><dd>{platforms(profile.evaluation_platforms)}</dd></div>}
    </dl>
    {profile.runtime_note && <p className="small" role="note">{t(profile.runtime_note)}</p>}
    {!profile.available && <p className="setup-error" role="status">{t(profile.unavailable_reason || "provider_unavailable")}</p>}
  </section>;
}
