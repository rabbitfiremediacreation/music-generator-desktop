import { expect, it } from "vitest";
import qrcode from "qrcode-generator";
import jsQR from "jsqr";
import { LANGS } from "./locales";
import { I18N } from "./i18n.js";
import { phoneAccessKeys, phoneAccessTranslations } from "./phone-access-i18n";
import { phoneAccessLink, phoneAccessQrSvg, phoneWebAccessLink } from "./phone-access";
import type { PhoneAccess } from "./types";

const off: PhoneAccess = { enabled: false, port: 8767, token: "", addresses: ["http://studio.local:8767", "http://192.168.1.20:8767"] };
const on: PhoneAccess = { ...off, enabled: true, token: "abc-DEF_123" };

it("provides every phone access text in all registered languages", () => {
  expect(Object.keys(phoneAccessTranslations).sort()).toEqual(Object.keys(LANGS).sort());
  for (const language of Object.keys(LANGS)) {
    const messages = (I18N as Record<string, Record<string, unknown>>)[language];
    for (const key of phoneAccessKeys) expect(messages[key], `${language}:${key}`).toBeTruthy();
    expect((messages.remote_port_busy as (port: number) => string)(8767), language).toContain("8767");
  }
});

it("builds the same connect link as the web app", () => {
  expect(phoneAccessLink(off)).toBeNull();
  expect(phoneAccessLink({ ...on, addresses: [] })).toBeNull();
  expect(phoneAccessLink(on)).toBe("musicgenerator://connect?server=http%3A%2F%2Fstudio.local%3A8767&token=abc-DEF_123&alt=http%3A%2F%2F192.168.1.20%3A8767");
  expect(phoneAccessLink({ ...on, addresses: [on.addresses[0]] })).not.toContain("alt=");
});

it("renders the QR code as scalable SVG", () => {
  expect(phoneAccessQrSvg(phoneAccessLink(on)!)).toMatch(/^<svg[^>]*viewBox/);
});

it("offers a separate web link with the key only in the fragment", () => {
  expect(phoneWebAccessLink(off)).toBeNull();
  expect(phoneWebAccessLink({ ...on, token: "" })).toBeNull();
  expect(phoneWebAccessLink({ ...on, addresses: [] })).toBeNull();
  const url = new URL(phoneWebAccessLink(on)!);
  expect(url.origin).toBe("http://studio.local:8767");
  expect(url.pathname).toBe("/mobile/");
  expect(url.search).toBe("");
  expect(new URLSearchParams(url.hash.slice(1)).get("token")).toBe(on.token);
  expect(phoneWebAccessLink(on)).not.toBe(phoneAccessLink(on));
});

it("can decode the web pairing QR with the PWA camera decoder", () => {
  const link = phoneWebAccessLink(on)!;
  const qr = qrcode(0, "M");
  qr.addData(link); qr.make();
  const quiet = 4, scale = 4, modules = qr.getModuleCount();
  const size = (modules + quiet * 2) * scale;
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const row = Math.floor(y / scale) - quiet, column = Math.floor(x / scale) - quiet;
    const dark = row >= 0 && row < modules && column >= 0 && column < modules && qr.isDark(row, column);
    const offset = (y * size + x) * 4;
    pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = dark ? 0 : 255;
    pixels[offset + 3] = 255;
  }
  expect(jsQR(pixels, size, size)?.data).toBe(link);
});
