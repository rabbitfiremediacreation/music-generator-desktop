import { Fragment } from "react";
import { ace_step_terms as aceStep } from "../../../models/catalog.json";
import type { CatalogProfile } from "../../types";
import { useI18n } from "../i18n";
import { ProfileLink } from "./ProfileLink";
import "./model-license-summary.css";

export function ModelLicenseSummary({ id, profile }: { id: string; profile?: CatalogProfile }) {
  const { t, language } = useI18n();
  const usage = profile?.usage ?? aceStep;
  const sources = profile?.upstream_sources ?? aceStep.licenses;
  const licenses = sources.filter((source, index) => sources.findIndex(other => other.license === source.license) === index);
  const yue2 = profile?.selection.provider === "yue2";
  const localizedYue2 = yue2 && language === "de";
  const publisherNotes = !profile || profile.usage.noncommercial_evaluation;
  const policyLabel = yue2 ? "yue2_usage_policy" : publisherNotes ? "provider_publisher_notes" : "provider_usage_policy";

  return <dl id={id} className="model-license-summary">
    <div>
      <dt>{t("model_weight_license")}</dt>
      <dd>
        {!profile && <>ACE-Step 1.5 · </>}
        {licenses.map(({ license, license_url }, index) => <Fragment key={license}>
          {index > 0 && " · "}
          {license_url === usage.policy_url ? license : <ProfileLink url={license_url} label={t("model_license_text", license)}>{license}</ProfileLink>}
        </Fragment>)}
        <span>{t(localizedYue2 ? "yue2_usage_model_use" : usage.model_use)}</span>
      </dd>
    </div>
    <div>
      <dt>{t("provider_outputs")}</dt>
      <dd>
        {t(localizedYue2 ? "yue2_usage_outputs" : usage.outputs?.trim() || "model_output_terms_absent")}
        {usage.policy_url && <>{" "}<ProfileLink url={usage.policy_url}>{t(policyLabel)}</ProfileLink></>}
      </dd>
    </div>
  </dl>;
}
