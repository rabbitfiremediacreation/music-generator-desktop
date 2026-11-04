import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { backend } from "../../backend";
import { settingsChanges } from "../../expert-mode";
import { pickFolder } from "../../path-dialogs";
import type { Settings, SettingsPatch } from "../../types";

/** Keep durable device writes separate from the dialog's unsaved settings draft. */
export function useSettingsDraft(open: boolean, onClose: () => void, onBusyChange: (busy: boolean) => void) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<Settings>();
  const [status, setStatus] = useState("");
  const [failure, setFailure] = useState<unknown>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState(false);
  const revision = useRef(0);
  const before = useRef<Settings | undefined>(undefined);
  const active = useRef<Promise<Settings> | undefined>(undefined);
  const submitting = useRef(false);
  const choosing = useRef(false);
  const save = useMutation({ mutationKey: ["settings", "save"], mutationFn: (values: SettingsPatch) => backend.saveSettings(values), retry: false, networkMode: "always" });
  const mutate = save.mutateAsync;
  const invalidateSession = useCallback(() => { revision.current++; }, []);

  async function refresh() {
    await Promise.all([ ["settings"], ["models", "catalog"], ["generation-policy"], ["health"] ].map(queryKey => client.invalidateQueries({ queryKey })));
  }

  async function load() {
    const current = ++revision.current;
    setLoading(true); setDraft(undefined); before.current = undefined;
    setFailure(undefined); setStatus("settings_loading");
    if (active.current) await active.current.catch(() => undefined);
    if (current !== revision.current) return;
    try {
      const settings = await client.fetchQuery({ queryKey: ["settings"], queryFn: backend.settings, staleTime: 0, retry: false, networkMode: "always" });
      if (current !== revision.current) return;
      before.current = settings; setDraft(settings); setStatus("");
    } catch {
      if (current === revision.current) setStatus("settings_load_failed");
    } finally { if (current === revision.current) setLoading(false); }
  }

  useEffect(() => {
    if (open) void load();
    else invalidateSession();
    return invalidateSession;
    // Opening starts one fresh read; query refreshes must preserve the current draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => { onBusyChange(open || pending || saving); }, [open, pending, saving, onBusyChange]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);

  const change = (values: SettingsPatch) => setDraft(value => value ? { ...value, ...values } : value);
  async function selectDirectory() {
    if (!draft || choosing.current) return;
    const current = revision.current;
    choosing.current = true; setFailure(undefined);
    try {
      const path = await pickFolder("songs", draft.songs_dir, true);
      if (path && current === revision.current) change({ songs_dir: path });
    } catch (error) { if (current === revision.current) setFailure(error); }
    finally { choosing.current = false; }
  }
  async function device(value: Settings["lm_device"]) {
    if (!before.current || active.current || loading || saving) return;
    const current = revision.current;
    const previous = before.current.lm_device;
    change({ lm_device: value }); setPending(true); setStatus("settings_device_saving");
    const operation = mutate({ lm_device: value }); active.current = operation;
    try {
      const result = await operation;
      if (current === revision.current && before.current) {
        before.current = { ...before.current, lm_device: result.lm_device };
        setStatus("settings_device_saved");
      }
      await refresh();
    } catch {
      if (current === revision.current) { change({ lm_device: previous }); setStatus("settings_device_failed"); }
    } finally {
      if (active.current === operation) active.current = undefined;
      setPending(false);
    }
  }
  async function submit() {
    if (!draft || !before.current || active.current || loading || submitting.current) return;
    submitting.current = true;
    const current = revision.current;
    const values = settingsChanges(before.current, {
      lm_device: draft.lm_device, cpu_iteration_behavior: draft.cpu_iteration_behavior,
      timeout_minutes: Number(draft.timeout_minutes), songs_dir: draft.songs_dir.trim(),
      export_format: draft.export_format, expert_mode: draft.expert_mode,
    });
    setSaving(true); setFailure(undefined); setStatus("");
    try {
      if (Object.keys(values).length) {
        const operation = mutate(values); active.current = operation;
        try { await operation; } finally { if (active.current === operation) active.current = undefined; }
      }
      await refresh();
      if (current === revision.current) onClose();
    } catch (error) { if (current === revision.current) setFailure(error); }
    finally { submitting.current = false; setSaving(false); }
  }
  return { draft, status, failure, loading, saving, pending, load, change, device, submit, selectDirectory };
}
