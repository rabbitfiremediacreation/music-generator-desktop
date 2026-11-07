import qrcode from "qrcode-generator";
import type { PhoneAccess } from "./types";

/** Link for the iPhone camera: opens the app, which takes over address (fallback: IP) and key. */
export function phoneAccessLink(status: PhoneAccess): string | null {
  if (!status.enabled || !status.addresses.length || !status.token) return null;
  const query = new URLSearchParams({ server: status.addresses[0], token: status.token });
  if (status.addresses[1]) query.set("alt", status.addresses[1]);
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
