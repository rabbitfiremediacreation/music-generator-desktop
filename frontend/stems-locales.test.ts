import { expect, it } from "vitest";
import { I18N } from "./i18n.js";
import "./stems-i18n";
import "./stems-locales";
import { LANGS } from "./locales";

it("registers core stem actions and channel roles for every desktop language", () => {
  const dictionaries = I18N as unknown as Record<string, Record<string, unknown>>;
  for (const lang of Object.keys(LANGS)) {
    for (const key of ["stem_title", "stem_start", "stem_role_vocals", "stem_export_tracks", "stem_export_mix", "stem_export_package", "stem_export_save"]) {
      expect(dictionaries[lang][key], `${lang} ${key}`).toEqual(expect.any(String));
    }
  }
});
