import { openUrl } from "@tauri-apps/plugin-opener";

export function ProfileLink({ url, label, children }: { url: string; label?: string; children: string }) {
  return <a href={url} aria-label={label} onClick={event => { event.preventDefault(); void openUrl(url).catch(() => {}); }}>{children}</a>;
}
