import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { backend } from "../../backend";
import { useI18n } from "../i18n";

const statusKey = ["hugging-face-token-status"] as const;

export function HuggingFaceTokenField() {
  const { t } = useI18n();
  const client = useQueryClient();
  const status = useQuery({ queryKey: statusKey, queryFn: () => backend.huggingFaceTokenStatus(), networkMode: "always", retry: false });
  const input = useRef<HTMLInputElement>(null);
  const writing = useRef(false);
  const [hasInput, setHasInput] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function apply(remove: boolean) {
    if (writing.current || !input.current) return;
    const token = remove ? null : input.current.value.trim();
    if (token === "") return;
    writing.current = true;
    setBusy(true);
    setError("");
    try {
      const configured = await backend.setHuggingFaceToken(token);
      await client.cancelQueries({ queryKey: statusKey });
      client.setQueryData(statusKey, configured);
      void client.invalidateQueries({ queryKey: ["hugging-face-models"] });
      if (input.current) input.current.value = "";
      setHasInput(false);
    } catch (cause) {
      setError(cause instanceof Error && cause.message === "hf_token_invalid" ? "hf_token_invalid" : "hf_token_write_failed");
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  return <div className="settings-section">
    <div className="field">
      <label className="lbl" htmlFor="hfToken">{t("hf_token")}</label>
      <input id="hfToken" ref={input} type="password" autoComplete="new-password" autoCapitalize="none" spellCheck={false}
        maxLength={256} disabled={busy} placeholder={t(status.data ? "hf_token_replace" : "hf_token_placeholder")}
        aria-describedby="hfTokenHint" onChange={event => setHasInput(Boolean(event.target.value.trim()))}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void apply(false); } }} />
      <span id="hfTokenHint" className="small">{t("hf_token_hint")}</span>
    </div>
    <div className="settings-actions">
      <button type="button" className="sek" disabled={!hasInput || busy} onClick={() => void apply(false)}>{t("hf_token_save")}</button>
      {(status.data || status.isError) && <button type="button" className="sek" disabled={busy} onClick={() => void apply(true)}>{t("hf_token_remove")}</button>}
    </div>
    {error || status.isError
      ? <p role="alert" className="small err">{t(error || "hf_token_read_failed")}</p>
      : <p role="status" className="small">{status.data ? t("hf_token_saved") : ""}</p>}
  </div>;
}
