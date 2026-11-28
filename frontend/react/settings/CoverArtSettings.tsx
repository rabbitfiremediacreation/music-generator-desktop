import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { backend } from "../../backend";
import { useI18n } from "../i18n";
import { ModelDownloadProgress } from "../models/ModelDownloadProgress";
import { MissingCoverSettings } from "./MissingCoverSettings";

const installKey = ["models", "cover-art"] as const;

export function CoverArtSettings({ supported, installed }: { supported?: boolean; installed?: boolean }) {
  const { t } = useI18n();
  const client = useQueryClient();
  const downloading = useIsMutating({ mutationKey: installKey }) > 0;
  const modelBusy = useIsMutating({ mutationKey: ["models"] }) > 0;
  const install = useMutation({
    mutationKey: installKey,
    mutationFn: backend.installCoverArt,
    onSettled: () => client.invalidateQueries({ queryKey: ["settings"] }),
  });
  const cancel = useMutation({
    mutationFn: () => backend.cancelTransfer("models", "cover-art"),
  });
  const error = cancel.error ?? install.error;

  return <div className="settings-section">
    <h4>SDXS-512 DreamShaper</h4>
    {!supported ? <p className="small">{t("cover_art_unsupported")}</p> :
      <div className="field">
        {!installed && <span className="small">{t("cover_art_download_size")}</span>}
        {installed && <p className="small" role="status">{t("cover_art_installed")}</p>}
        {error && error.message !== "Operation cancelled" && <p className="small err" role="alert">{t(error.message)}</p>}
        {downloading ? <div className="installed-models-progress">
          <ModelDownloadProgress busy source="cover-art-progress" />
          <button type="button" className="sek" disabled={cancel.isPending} onClick={() => cancel.mutate()}>{t("picker_cancel_download")}</button>
        </div> : !installed && <div>
          <button type="button" className="sek" disabled={modelBusy} onClick={() => install.mutate()}>{t("cover_art_install")}</button>
        </div>}
      </div>}
    {supported && <MissingCoverSettings installed={!!installed} />}
  </div>;
}
