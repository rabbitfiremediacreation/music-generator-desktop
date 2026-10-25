// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LANGS, preferredLanguage, resolveLanguage } from "./locales";
import { startupKeys, startupText, startupTranslations } from "./startup-text";
import { splashView } from "./splash-view";
import html from "./splash.html?raw";

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = html.match(/<body>([\s\S]*)<\/body>/)![1].replace(/<script\b[\s\S]*?<\/script>/g, "");
});
afterEach(() => { vi.restoreAllMocks(); });

it("has complete startup messages for every registered interface language", () => {
  expect(Object.keys(startupTranslations).sort()).toEqual(Object.keys(LANGS).sort());
  for (const values of Object.values(startupTranslations)) {
    expect(values).toHaveLength(startupKeys.length);
    expect(values.every(value => value.trim().length > 0)).toBe(true);
  }
});

it.each(Object.keys(LANGS) as (keyof typeof LANGS)[])("localizes the complete error state in %s", (language) => {
  localStorage.setItem("ui_lang", language);
  const text = startupText();
  splashView(text)({ sequence: 1, phase: "error", error: "database is locked" });
  expect(document.documentElement.lang).toBe(language);
  expect(document.querySelector("#splashStatus")!.textContent).toBe(text.error);
  expect(document.querySelector("#splashError")!.textContent).toBe(text.failure);
  expect(document.querySelector("#splashRetry")!.textContent).toBe(text.retry);
  expect(document.querySelector("#splashClose")!.getAttribute("aria-label")).toBe(text.quit);
  expect(document.querySelector("#splashDetailsLabel")!.textContent).toBe(text.details);
  expect(document.querySelector("#splashFooter")!.textContent).toBe(text.footer);
  expect(document.querySelector<HTMLDetailsElement>("#splashDetails")!.open).toBe(false);
  expect(document.querySelector("#splashError")!.textContent).not.toContain("database is locked");
});

it.each([
  ["DE-de", "en-US", "de"], ["zh_Hant_TW", "en", "zh"],
  ["unsupported", "fr-CA", "fr"], [null, "pt-BR", "pt"],
  ["constructor", "de-DE", "de"], [null, "unsupported", "en"],
])("resolves saved %s and system %s as %s", (saved, system, expected) => {
  expect(resolveLanguage(saved, system!)).toBe(expected);
});

it("uses the system language when local storage cannot be read", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("storage unavailable"); });
  vi.spyOn(navigator, "language", "get").mockReturnValue("fr-CA");
  expect(preferredLanguage()).toBe("fr");
});
