import { expect, it, vi } from "vitest";
vi.mock("./i18n.js", () => {
  const langs = ["de", "en", "es", "fr", "it", "pt", "tr", "pl", "ru", "uk", "ja", "zh"];
  return { I18N: Object.fromEntries(langs.map(lang => [lang, {}])) };
});
import { I18N } from "./i18n.js";
import { expertKeys, expertTranslations } from "./expert-i18n";

it("provides all Expert Mode labels, explanations and recovery actions in twelve languages", () => {
  expect(Object.keys(expertTranslations)).toHaveLength(12);
  for (const [lang, values] of Object.entries(expertTranslations)) {
    expect(values).toHaveLength(expertKeys.length);
    for (const key of expertKeys) {
      expect((I18N as Record<string, Record<string, unknown>>)[lang][key], `${lang}:${key}`).toBeTruthy();
    }
    const messages = (I18N as Record<string, Record<string, unknown>>)[lang];
    expect(messages.model_setup_required).toContain(messages.creator_manage_models);
  }
});
