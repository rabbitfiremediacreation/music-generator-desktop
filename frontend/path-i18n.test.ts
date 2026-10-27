// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { LANGS } from "./locales";
import { I18N } from "./i18n.js";
import { pathKeys, pathTranslations } from "./path-i18n";

it("provides all folder, audio and sandbox messages in every interface language", () => {
  expect(Object.keys(pathTranslations).sort()).toEqual(Object.keys(LANGS).sort());
  for (const language of Object.keys(LANGS) as (keyof typeof LANGS)[]) {
    expect(pathTranslations[language]).toHaveLength(pathKeys.length);
    const messages = I18N[language] as unknown as Record<string, string>;
    for (const key of pathKeys) expect(messages[key]).toEqual(expect.stringMatching(/\S/));
    expect(messages.path_hint_plain).not.toContain("macOS");
    expect(messages.path_hint).toContain("macOS");
  }
  expect((I18N.de as unknown as Record<string, string>).path_absolute).toContain("absoluten");
  expect((I18N.de as unknown as Record<string, string>).path_access).toContain("Auswählen");
});
