import { useCallback, useEffect, useRef, useState } from "react";
import { backend } from "../../backend";
import type { McpSettingsStatus } from "../../types";
import { useI18n } from "../i18n";

/** MCP changes are applied separately from the rest of the settings draft. */
export function McpSettings({ onBusyChange }: { onBusyChange: (busy: boolean) => void }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<McpSettingsStatus>();
  const [enabled, setEnabled] = useState(false);
  const [port, setPort] = useState("0");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<"load" | "save" | undefined>();
  const [errorDetail, setErrorDetail] = useState("");
  const [copyStatus, setCopyStatus] = useState<"copied" | "failed" | undefined>();
  const [showConfig, setShowConfig] = useState(false);
  const mounted = useRef(false);
  const revision = useRef(0);
  const submitting = useRef(false);
  const copying = useRef(false);
  const invalidate = useCallback(() => { mounted.current = false; revision.current++; }, []);

  const accept = (value: McpSettingsStatus) => {
    setStatus(value); setEnabled(value.enabled); setPort(String(value.port));
    setCopyStatus(undefined); setShowConfig(false);
  };
  const load = useCallback(async () => {
    const current = ++revision.current;
    setLoading(true); setFailure(undefined); setErrorDetail("");
    try {
      const value = await backend.mcpSettings();
      if (mounted.current && current === revision.current) accept(value);
    } catch {
      if (mounted.current && current === revision.current) setFailure("load");
    } finally {
      if (mounted.current && current === revision.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true; void load();
    return invalidate;
  }, [load, invalidate]);

  const validPort = /^\d+$/.test(port) && Number(port) <= 65535;
  const changed = status && (enabled !== status.enabled || Number(port) !== status.port || !!status.error);
  async function apply() {
    if (!status || loading || submitting.current || status.managed_by_environment || !validPort || !changed) return;
    submitting.current = true; setSaving(true); onBusyChange(true);
    setFailure(undefined); setErrorDetail(""); setCopyStatus(undefined);
    try {
      const value = await backend.saveMcpSettings({ enabled, port: Number(port) });
      if (mounted.current) accept(value);
    } catch (error) {
      if (mounted.current) {
        setFailure("save");
        setErrorDetail(error instanceof Error ? error.message : String(error));
      }
    } finally {
      submitting.current = false;
      if (mounted.current) setSaving(false);
      onBusyChange(false);
    }
  }
  async function copy() {
    if (!status?.running || copying.current) return;
    copying.current = true; setCopyStatus(undefined);
    try {
      await navigator.clipboard.writeText(status.client_config);
      if (mounted.current) setCopyStatus("copied");
    } catch {
      if (mounted.current) { setCopyStatus("failed"); setShowConfig(true); }
    } finally { copying.current = false; }
  }

  return <section className="mcp-settings" aria-labelledby="mcpHeading" aria-busy={loading || saving}>
    <div className="mcp-heading"><h3 id="mcpHeading">{t("mcp_title")}</h3>
      <span className={`mcp-status${status?.running ? " is-running" : ""}`} role="status">{loading ? t("desktop_checking") : status ? t(status.running ? "mcp_on" : status.error ? "mcp_failed" : "mcp_off") : ""}</span>
    </div>
    <p className="small">{t("mcp_description")}</p>
    {failure === "load" && <div role="alert"><p className="small err">{t("mcp_load_failed")}</p><button type="button" className="sek" onClick={() => void load()}>{t("settings_retry")}</button></div>}
    {status && <>
      {status.managed_by_environment && <p className="small">{t("mcp_environment")}</p>}
      <fieldset disabled={loading || saving || status.managed_by_environment}>
        <label className="check-row"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />{t("mcp_enable")}</label>
        <label className="field mcp-port"><span className="lbl">{t("mcp_port")}</span>
          <input type="text" inputMode="numeric" aria-label={t("mcp_port")} value={port} onChange={event => setPort(event.target.value)} aria-describedby="mcpPortHint" aria-invalid={!validPort}
            onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void apply(); } }} />
          <span id="mcpPortHint" className={`small${validPort ? "" : " err"}`}>{t(validPort ? "mcp_port_hint" : "mcp_port_invalid")}</span>
        </label>
        <button type="button" className="sek" disabled={!validPort || !changed} onClick={() => void apply()}>{t(saving ? "mcp_applying" : "mcp_apply")}</button>
      </fieldset>
      <p className="small">{t("mcp_apply_hint")}</p>
      {failure === "save" && <p role="alert" className="small err">{t("mcp_save_failed")} {errorDetail}</p>}
      {status.error && failure !== "save" && <p role="alert" className="small err">{status.error}</p>}
      {status.running && <div className="mcp-connection">
        {status.url && <p><span className="small">{t("mcp_endpoint")}</span><code>{status.url}</code></p>}
        <button type="button" className="sek" disabled={saving} onClick={() => void copy()}>{t("mcp_copy")}</button>
        {copyStatus && <p role={copyStatus === "failed" ? "alert" : "status"} className={`small${copyStatus === "failed" ? " err" : ""}`}>{t(copyStatus === "copied" ? "mcp_copied" : "mcp_copy_failed")}</p>}
        <details open={showConfig} onToggle={event => setShowConfig(event.currentTarget.open)}>
          <summary>{t("mcp_connection")}</summary>
          <p className="small">{t("mcp_connection_hint")}</p>
          <p><span className="small">{t("mcp_connection_file")}</span><code>{status.config_path}</code></p>
          <textarea aria-label={t("mcp_connection")} readOnly rows={8} value={status.client_config} spellCheck={false} />
        </details>
      </div>}
    </>}
  </section>;
}
