// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { importKeys, importMessages } from "./import-i18n";
import { I18N } from "./i18n.js";

it("provides every import and sandbox message in all supported languages", () => {
  expect(Object.keys(importMessages).sort()).toEqual(Object.keys(I18N).sort());
  for (const values of Object.values(importMessages)) {
    expect(values).toHaveLength(importKeys.length);
    expect(values.every(value => typeof value === "string" && value.length > 0)).toBe(true);
  }
});
