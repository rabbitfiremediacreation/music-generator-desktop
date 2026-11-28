import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { backend } from "../../backend";
import type { Song } from "../../types";
import { invalidateLibrary } from "../data";
import { useI18n } from "../i18n";

export interface CoverModel {
  installed: boolean;
  busy: boolean;
  onManage?: () => void;
}

export function useSongCoverAction(song: Song, model: CoverModel | undefined) {
  const { t } = useI18n(), client = useQueryClient();
  const key = ["cover-art", song.id];
  const pending = useIsMutating({ mutationKey: key }) > 0;
  const cover = useMutation({
    mutationKey: key, mutationFn: () => backend.generateCoverArt(song.id),
    onSuccess: () => invalidateLibrary(client),
  });
  const cancel = useMutation({ mutationFn: () => backend.cancelCoverArt(song.id) });
  const failure = cancel.error ?? cover.error;
  const error = failure instanceof Error ? failure.message : failure ?? song.result_meta?.cover_art_error;
  const available = model && (model.installed || model.onManage) && song.status === "done" && song.output_kind !== "midi" && song.path && !song.audio_missing && !song.cover_url;
  const action = available ? {
    label: t(pending ? "cover_art_cancel" : model.installed ? "cover_art_enable" : "cover_art_install"),
    disabled: pending ? cancel.isPending : model.installed && model.busy,
    run() {
      if (pending) cancel.mutate();
      else if (model.installed) cover.mutate();
      else model.onManage?.();
    },
  } : null;
  return { action, pending, failed: Boolean(failure),
    error: !song.cover_url && !pending && typeof error === "string" && error !== "Operation cancelled" ? error : undefined };
}
