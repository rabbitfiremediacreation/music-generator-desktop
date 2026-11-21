const channel: unknown = import.meta.env.MUSIC_GENERATOR_BRANDING;
const brands = {
  dev: { id: "dev", label: "Dev" },
  nightly: { id: "nightly", label: "Daily" },
} as const;

export const desktopBranding = channel === "dev" || channel === "nightly" ? brands[channel] : null;

export function applyBuildBranding(): void {
  if (!desktopBranding) return;
  document.title = `Music Generator · ${desktopBranding.label}`;
  document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.setAttribute("href", `/branding/${desktopBranding.id}.svg`);
}
