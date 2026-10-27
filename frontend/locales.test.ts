// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LANGS, preferredLanguage, resolveLanguage } from "./locales";
import { startupKeys, startupTranslations } from "./startup-text";

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => { vi.restoreAllMocks(); });

it("has complete startup messages for every registered interface language", () => {
  expect(Object.keys(startupTranslations).sort()).toEqual(Object.keys(LANGS).sort());
  for (const values of Object.values(startupTranslations)) {
    expect(values).toHaveLength(startupKeys.length);
    expect(values.every(value => value.trim().length > 0)).toBe(true);
  }
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
