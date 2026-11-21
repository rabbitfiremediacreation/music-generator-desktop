import qrcode from "qrcode-generator";
import type { PhoneAccess } from "./types";

/** The native app and PWA share the HTTPS listener. The native app needs the origin. */
export function phoneNativeAddresses(status: PhoneAccess): string[] {
  return (status.web_addresses ?? []).flatMap(address => {
    if (!URL.canParse(address)) return [];
    const url = new URL(address);
    return url.protocol === "https:" && !url.username && !url.password ? [url.origin] : [];
  });
}

/** Link for the iPhone camera: opens the app with a trusted HTTPS endpoint and key. */
export function phoneAccessLink(status: PhoneAccess): string | null {
  const [server, alt] = phoneNativeAddresses(status);
  if (!status.enabled || !server || !status.token) return null;
  const query = new URLSearchParams({ server, token: status.token });
  if (alt) query.set("alt", alt);
  return `musicgenerator://connect?${query}`;
}

/** Public onboarding page; the key stays in the fragment and is never sent in the URL. */
export function phoneWebAccessLink(status: PhoneAccess): string | null {
  if (!status.enabled || !status.addresses.length || !status.token) return null;
  const url = new URL("/mobile/", status.addresses[0]);
  url.hash = new URLSearchParams({ token: status.token }).toString();
  return url.toString();
}

/** QR code as SVG markup; generated locally, the link never leaves the computer. */
export function phoneAccessQrSvg(link: string): string {
  const code = qrcode(0, "M");
  code.addData(link);
  code.make();
  return code.createSvgTag({ cellSize: 4, margin: 8, scalable: true });
}
