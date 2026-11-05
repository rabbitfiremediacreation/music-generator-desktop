import { expect, it } from "vitest";
import { LANGS } from "./locales";
import { I18N } from "./i18n.js";
import { phoneAccessKeys, phoneAccessTranslations } from "./phone-access-i18n";
import { phoneAccessLink, phoneAccessQrSvg } from "./phone-access";
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
