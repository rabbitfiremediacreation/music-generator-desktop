import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { backend } from "../../backend";
import type { CpuIterationBehavior, GenerationPolicy } from "../../types";
import { useI18n } from "../i18n";
import type { CpuChoice } from "./admission";
import "../../cpu-i18n";

export function CpuConfirmation({ device, onChoice }: { device: GenerationPolicy["backend"]; onChoice: (choice: CpuChoice) => void }) {
  const { t } = useI18n(), client = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null), saving = useRef(false);
  const [remember, setRemember] = useState(false);
  const mutation = useMutation({ mutationFn: (behavior: CpuIterationBehavior) => backend.saveSettings({ cpu_iteration_behavior: behavior }), networkMode: "always", onSuccess: async () => {
    await Promise.all([client.invalidateQueries({ queryKey: ["settings"] }), client.invalidateQueries({ queryKey: ["generation-policy"] })]);
  } });
  useEffect(() => { dialog.current?.showModal(); dialog.current?.querySelector("button")?.focus(); }, []);
  async function choose(choice: CpuChoice) {
    if (saving.current) return;
    if (choice && remember) {
      saving.current = true;
      try { await mutation.mutateAsync(choice === "reduce" ? "limit_30" : "continue"); }
      catch { return; }
      finally { saving.current = false; }
    }
    onChoice(choice);
  }
  return <dialog ref={dialog} className="cpu-dialog" aria-labelledby="cpuDialogTitle" aria-describedby="cpuDialogText" onCancel={event => { event.preventDefault(); if (!saving.current) onChoice(null); }}>
    <h2 id="cpuDialogTitle">{t("cpu_title")}</h2><p id="cpuDialogText">{t(device === "cpu" ? "cpu_warning" : "cpu_unknown_warning")}</p>
    <form onSubmit={event => event.preventDefault()} aria-busy={mutation.isPending}>
      <label className="check-row"><input type="checkbox" name="remember_cpu_decision" checked={remember} disabled={mutation.isPending} onChange={event => setRemember(event.target.checked)} />{t("cpu_remember")}</label>
      {mutation.isError && <p className="setup-error" role="alert">{t("cpu_remember_error")}</p>}
      <div className="submit"><button type="button" className="aktion" disabled={mutation.isPending} onClick={() => { void choose("reduce"); }}>{t("cpu_reduce")}</button><button type="button" className="sek" disabled={mutation.isPending} onClick={() => { void choose("continue"); }}>{t("cpu_continue")}</button><button type="button" className="sek" disabled={mutation.isPending} onClick={() => { void choose(null); }}>{t("cancel")}</button></div>
    </form>
  </dialog>;
}
