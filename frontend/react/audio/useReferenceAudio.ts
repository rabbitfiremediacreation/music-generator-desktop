import { useCallback, useRef, useState } from "react";
import { backend } from "../../backend";
import { profileKey } from "../../creator-models";
import type { ModelSelection } from "../../types";

export function useReferenceAudio(selection: ModelSelection | null) {
  const key = selection ? profileKey(selection) : "";
  const [reference, setReference] = useState<{ id: string; name?: string; profile: string }>();
  const [approved, setApproved] = useState(false);
  const [picking, setPicking] = useState(false);
  const [failure, setFailure] = useState<{ profile: string; cause: unknown }>();
  const pending = useRef(false);
  const revision = useRef(0);

  const restore = useCallback((profile?: ModelSelection, id?: string) => {
    revision.current++;
    setReference(profile && id ? { id, profile: profileKey(profile) } : undefined);
    setApproved(false);
    setFailure(undefined);
  }, []);

  async function pick(title: string) {
    if (!key || pending.current) return;
    const before = revision.current;
    pending.current = true;
    setPicking(true);
    setFailure(undefined);
    try {
      const file = await backend.pickReferenceAudio(title);
      if (file && before === revision.current) {
        setReference({ ...file, profile: key });
        setApproved(false);
      }
    } catch (cause) {
      if (before === revision.current) setFailure({ cause, profile: key });
    } finally {
      pending.current = false;
      setPicking(false);
    }
  }

  return { file: reference?.profile === key ? reference : undefined, approved, setApproved, picking, error: failure?.profile === key ? failure.cause : undefined, pick, restore };
}

export type ReferenceAudio = ReturnType<typeof useReferenceAudio>;
