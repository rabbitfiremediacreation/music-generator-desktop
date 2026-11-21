import { useI18n } from "../i18n";
import { ModelManager, type ModelManagerProps } from "./ModelManager";
import { ModelPickerDialog } from "./ModelPickerDialog";

type ModelDialogProps = ModelManagerProps & { onClose: () => void; title?: string };

export function ModelDialog({ onClose, title, ...props }: ModelDialogProps) {
  const { t } = useI18n();
  return <ModelPickerDialog title={title ?? t("picker_title")} onClose={onClose}>
    <ModelManager {...props} />
  </ModelPickerDialog>;
}
