import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { backend } from "../../backend";
import { phoneAccessLink, phoneAccessQrSvg, phoneWebAccessLink } from "../../phone-access";
import type { PhoneAccess } from "../../types";
import { useI18n } from "../i18n";

const phoneAccessKey = ["phone-access"] as const;

/** Applies immediately through its own command, independent of the settings dialog's Save. */
export function PhoneAccessField() {
  const { t } = useI18n();
  const hintId = useId();
  const client = useQueryClient();
  const status = useQuery({ queryKey: phoneAccessKey, queryFn: backend.phoneAccess, staleTime: 0 });
  const [failure, setFailure] = useState<string | null>(null);
  const change = useMutation({
    mutationFn: backend.setPhoneAccess,
    onMutate: () => setFailure(null),
    onSuccess: next => client.setQueryData<PhoneAccess>(phoneAccessKey, next),
    onError: reason => {
      setFailure(reason instanceof Error ? reason.message : String(reason));
      void client.invalidateQueries({ queryKey: phoneAccessKey });   // show the actual state
    },
  });
  const current = status.data;
  const port = current?.port ?? 8767;
  const link = current ? phoneAccessLink(current) : null;
  const webLink = current ? phoneWebAccessLink(current) : null;
  const errorText = failure === null ? "" : failure === "phone_access_port_busy" ? t("remote_port_busy", port)
    : failure === "phone_access_https_port_busy" ? t("remote_https_port_busy", current?.web_port ?? 8768)
    : failure === "phone_access_tls_failed" ? t("remote_tls_failed") : `${t("remote_failed")} ${failure}`;
  const busy = change.isPending || !current;
  return <section className="phone-access" aria-busy={change.isPending}>
    <label className="phone-access-row">
      <span className="lbl">{t("remote")}</span>
      <span className="phone-access-control">
        <input type="checkbox" role="switch" disabled={busy} checked={current?.enabled ?? false} aria-describedby={hintId} onChange={event => change.mutate({ enabled: event.target.checked })} />
        <span aria-hidden="true">{t(current?.enabled ? "remote_on" : "remote_off")}</span>
      </span>
    </label>
    <p id={hintId} className="small">{t("remote_tip")}</p>
    <span className="small">{t("remote_hint")}</span>
    {current?.enabled && <div className="phone-access-info">
      <div className="phone-access-codes">
        {link && <div>
          <h3>{t("remote_native")}</h3>
          <span className="small">{t("remote_scan")}</span>
          <div className="remote-qr" data-testid="phone-access-qr" dangerouslySetInnerHTML={{ __html: phoneAccessQrSvg(link) }} />
        </div>}
        {webLink && <div>
          <h3>{t("remote_web")}</h3>
          <span className="small">{t("remote_web_scan")}</span>
          <div className="remote-qr" data-testid="phone-access-web-qr" dangerouslySetInnerHTML={{ __html: phoneAccessQrSvg(webLink) }} />
        </div>}
      </div>
      {current.certificate_fingerprint && <p className="small phone-access-fingerprint">{t("remote_certificate")}<br /><code>{current.certificate_fingerprint}</code></p>}
      <span className="small">{t("remote_addr")}</span>
      <ul className="upd-list">{current.addresses.map(address => <li key={address}>{address}</li>)}</ul>
      <div className="upd-row">
        <input className="phone-access-token" readOnly aria-label={t("remote_token")} value={current.token} onFocus={event => event.currentTarget.select()} />
        <button type="button" className="sek" disabled={busy} onClick={() => change.mutate({ newToken: true })}>{t("remote_new")}</button>
      </div>
    </div>}
    {errorText && <span className="small err" role="alert">{errorText}</span>}
  </section>;
}
