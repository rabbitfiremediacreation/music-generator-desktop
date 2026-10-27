// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider, useI18n } from "./i18n";
import { LANGS } from "../locales";
import { setLang } from "../i18n.js";

afterEach(cleanup);

function Example() {
  const { language, setLanguage, t } = useI18n();
  return <><input aria-label="draft" defaultValue="my song" /><span>{t("save")}</span><button onClick={() => setLanguage(language === "de" ? "en" : "de")}>switch</button></>;
}

it("reactively translates without replacing the user's draft", () => {
  setLang("de");
  render(<I18nProvider><Example /></I18nProvider>);
  fireEvent.change(screen.getByLabelText("draft"), { target: { value: "retain me" } });
  fireEvent.click(screen.getByText("switch"));
  expect((screen.getByLabelText("draft") as HTMLInputElement).value).toBe("retain me");
  expect(document.documentElement.lang).toBe("en");
  expect(screen.getByText("SAVE")).toBeTruthy();
  expect(Object.keys(LANGS)).toHaveLength(12);
});
