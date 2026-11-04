// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { LANGS, type Language } from "./locales";
import { I18N, setLang, t } from "./i18n.js";
import { cudaKeys, cudaTranslations } from "./cuda-setup-i18n";

afterEach(() => setLang("en"));

it("provides every CUDA message in all registered interface languages without fallback", () => {
  expect(Object.keys(cudaTranslations).sort()).toEqual(Object.keys(LANGS).sort());
  for (const language of Object.keys(LANGS) as Language[]) {
    const translations = cudaTranslations[language];
    expect(Object.keys(translations).sort()).toEqual([...cudaKeys].sort());
    setLang(language);
    const messages = I18N[language] as unknown as Record<string, string>;
    for (const key of cudaKeys) {
      expect(translations[key]).toMatch(/\S/);
      expect(messages[key]).toBe(translations[key]);
      expect(t(key)).toBe(translations[key]);
      if (language !== "en") expect(translations[key]).not.toBe(cudaTranslations.en[key]);
    }
  }
});
