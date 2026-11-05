import { useCallback, useEffect, useRef, useState } from "react";
import { backend } from "../../backend";
import type { McpHttpConnection, McpSettings as Preferences, McpSettingsStatus } from "../../types";
import { useI18n } from "../i18n";

/** MCP changes are applied separately from the rest of the settings draft. */
export function McpSettings({ onBusyChange }: { onBusyChange: (busy: boolean) => void }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<McpSettingsStatus>();
  const [statusKnown, setStatusKnown] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [port, setPort] = useState("32123");
  const [scope, setScope] = useState<Preferences["scope"]>("local");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<"load" | "save" | undefined>();
  const [errorDetail, setErrorDetail] = useState("");
  const [copyStatus, setCopyStatus] = useState<"copied" | "failed" | "load_failed" | undefined>();
  const [connection, setConnection] = useState<McpHttpConnection>();
  const [showSecret, setShowSecret] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const mounted = useRef(false), revision = useRef(0), credentialRevision = useRef(0);
  const submitting = useRef(false), requesting = useRef(false);
  const invalidate = useCallback(() => { mounted.current = false; revision.current++; credentialRevision.current++; }, []);
  const clearCredentials = useCallback(() => {
    credentialRevision.current++; setConnection(undefined); setShowSecret(false); setCopyStatus(undefined);
  }, []);
  const accept = useCallback((value: McpSettingsStatus) => {
    setStatusKnown(true);
    setStatus(value); setEnabled(value.enabled); setPort(String(value.port)); setScope(value.scope);
    setUrl(value.urls[0] ?? ""); clearCredentials();
  }, [clearCredentials]);
  const load = useCallback(async () => {
    const current = ++revision.current;
    setLoading(true); setFailure(undefined); setErrorDetail(""); clearCredentials();
    try {
      const value = await backend.mcpSettings();
      if (mounted.current && current === revision.current) accept(value);
    } catch {
      if (mounted.current && current === revision.current) setFailure("load");
    } finally {
      if (mounted.current && current === revision.current) setLoading(false);
    }
  }, [accept, clearCredentials]);
  useEffect(() => {
    mounted.current = true; void load();
    return invalidate;
  }, [load, invalidate]);

  const validPort = /^\d+$/.test(port) && Number(port) <= 65535;
  const changed = status && (enabled !== status.enabled || Number(port) !== status.port || scope !== status.scope || !!status.error || !statusKnown);
  const canConnect = statusKnown && status?.running && !changed && !!url && !saving;
  async function apply() {
    if (!status || loading || submitting.current || status.managed_by_environment || !validPort || !changed) return;
    submitting.current = true; setSaving(true); onBusyChange(true); clearCredentials();
    setFailure(undefined); setErrorDetail("");
    try {
      const value = await backend.saveMcpSettings({ enabled, port: Number(port), scope });
      if (mounted.current) accept(value);
    } catch (error) {
      if (mounted.current) {
        setFailure("save");
        setErrorDetail(error instanceof Error ? error.message : String(error));
        setStatusKnown(false);
      }
      // A failed scope change may also fail to restore the previous listener.
      // Refresh confirmed state without replacing the user's unsaved draft.
      try {
        const actual = await backend.mcpSettings();
        if (mounted.current) { setStatus(actual); setStatusKnown(true); setUrl(actual.urls[0] ?? ""); }
      } catch { /* Keep the service state unknown and credential controls unavailable. */ }
    } finally {
      submitting.current = false;
      if (mounted.current) setSaving(false);
      onBusyChange(false);
    }
  }
  async function connect(copy: boolean) {
    if (!canConnect || requesting.current) return;
    requesting.current = true; setConnecting(true); setCopyStatus(undefined);
    const current = ++credentialRevision.current;
    const isCurrent = () => mounted.current && current === credentialRevision.current;
    try {
      const value = await backend.mcpHttpConnection(url);
      if (!isCurrent()) return;
      setConnection(value); setShowSecret(false);
      if (copy) {
        try {
          await navigator.clipboard.writeText(value.client_config);
          if (isCurrent()) setCopyStatus("copied");
        } catch {
          if (isCurrent()) { setCopyStatus("failed"); setShowSecret(true); }
        }
      }
    } catch {
      if (isCurrent()) { setConnection(undefined); setCopyStatus("load_failed"); }
    } finally {
      requesting.current = false;
      if (mounted.current) setConnecting(false);
    }
  }
  const edit = (change: () => void) => { clearCredentials(); change(); };
  const configuration = connection && (showSecret ? connection.client_config : connection.client_config.replaceAll(connection.token, "YOUR_ACCESS_KEY"));

  return <section className="mcp-settings" aria-labelledby="mcpHeading" aria-busy={loading || saving}>
    <div className="mcp-heading"><h3 id="mcpHeading">{t("mcp_title")}</h3>
      <span className={`mcp-status${statusKnown && status?.running ? " is-running" : ""}`} role="status">{loading ? t("desktop_checking") : status ? t(!statusKnown ? "mcp_failed" : status.running ? "mcp_on" : status.error ? "mcp_failed" : "mcp_off") : ""}</span>
    </div>
    <p className="small">{t("mcp_description")}</p>
    {failure === "load" && <div role="alert"><p className="small err">{t("mcp_load_failed")}</p><button type="button" className="sek" onClick={() => void load()}>{t("settings_retry")}</button></div>}
    {status && <>
      {status.managed_by_environment && <p className="small">{t("mcp_environment")}</p>}
      <fieldset disabled={loading || saving || status.managed_by_environment}>
        <label className="check-row"><input type="checkbox" checked={enabled} onChange={event => edit(() => setEnabled(event.target.checked))} />{t("mcp_enable")}</label>
        <label className="field mcp-scope"><span className="lbl">{t("mcp_scope")}</span>
          <select aria-label={t("mcp_scope")} value={scope} onChange={event => edit(() => setScope(event.target.value as Preferences["scope"]))}>
            <option value="local">{t("mcp_local")}</option><option value="network">{t("mcp_network")}</option>
          </select>{scope === "network" && <span className="small">{t("mcp_network_hint")}</span>}
        </label>
        <label className="field mcp-port"><span className="lbl">{t("mcp_port")}</span>
          <input type="text" inputMode="numeric" aria-label={t("mcp_port")} value={port} onChange={event => edit(() => setPort(event.target.value))} aria-describedby="mcpPortHint" aria-invalid={!validPort}
            onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void apply(); } }} />
          <span id="mcpPortHint" className={`small${validPort ? "" : " err"}`}>{t(validPort ? "mcp_port_hint" : "mcp_port_invalid")}</span>
        </label>
        <button type="button" className="sek" disabled={!validPort || !changed} onClick={() => void apply()}>{t(saving ? "mcp_applying" : "mcp_apply")}</button>
      </fieldset>
      <p className="small">{t("mcp_apply_hint")}</p>
      {failure === "save" && <p role="alert" className="small err">{t("mcp_save_failed")} {errorDetail}</p>}
      {status.error && failure !== "save" && <p role="alert" className="small err">{status.error}</p>}
      {statusKnown && status.running && <div className="mcp-connection">
        {status.scope === "network" && !status.urls.some(address => new URL(address).hostname !== "127.0.0.1") && <p className="small">{t("mcp_no_network")}</p>}
        <label className="field"><span className="lbl">{t("mcp_endpoint")}</span>
          <select aria-label={t("mcp_endpoint")} value={url} onChange={event => edit(() => setUrl(event.target.value))}>
            {status.urls.map(address => <option key={address} value={address}>{address}</option>)}
          </select>
        </label>
        <div className="mcp-actions">
          <button type="button" className="sek" disabled={!canConnect || connecting} onClick={() => void connect(true)}>{t("mcp_copy")}</button>
          <button type="button" className="sek" disabled={!canConnect || connecting} onClick={() => void connect(false)}>{t("mcp_connection")}</button>
        </div>
        {connecting && <p role="status" className="small">{t("desktop_checking")}</p>}
        {copyStatus && <p role={copyStatus === "copied" ? "status" : "alert"} className={`small${copyStatus === "copied" ? "" : " err"}`}>{t(copyStatus === "copied" ? "mcp_copied" : copyStatus === "failed" ? "mcp_copy_failed" : "mcp_credentials_failed")}</p>}
        {connection && <div className="mcp-details">
          <p className="small">{t("mcp_connection_hint")}</p>
          <label className="field"><span className="lbl">{t("mcp_token")}</span><input aria-label={t("mcp_token")} type={showSecret ? "text" : "password"} readOnly value={connection.token} autoComplete="off" spellCheck={false} /></label>
          <label className="check-row"><input type="checkbox" checked={showSecret} onChange={event => setShowSecret(event.target.checked)} />{t("mcp_show_token")}</label>
          <textarea aria-label={t("mcp_connection")} readOnly rows={6} value={configuration} spellCheck={false} />
        </div>}
      </div>}
    </>}
  </section>;
}
