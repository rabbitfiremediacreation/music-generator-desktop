// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LANGS } from "./locales";
import { I18N, setLang } from "./i18n.js";
import { settingsKeys, settingsTranslations } from "./desktop-i18n";
import { xlMemoryHints } from "./model-i18n";
import { SettingsDialog } from "./react/settings/SettingsDialog";
import { I18nProvider } from "./react/i18n";
const mocks = vi.hoisted(() => ({ settings: vi.fn(), saveSettings: vi.fn() }));
vi.mock("./backend", () => ({ backend: mocks }));

beforeEach(() => { vi.resetAllMocks(); setLang("de"); HTMLDialogElement.prototype.showModal = function () { this.open = true; }; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("provides every new message in all registered languages", () => {
  expect(Object.keys(settingsTranslations).sort()).toEqual(Object.keys(LANGS).sort());
  expect(Object.keys(xlMemoryHints).sort()).toEqual(Object.keys(LANGS).sort());
  for (const language of Object.keys(LANGS)) {
    const messages = (I18N as Record<string, Record<string, unknown>>)[language];
    for (const key of [...settingsKeys, "settings_saving", "creator_xl_ram_hint"]) expect(messages[key], `${language}:${key}`).toBeTruthy();
  }
});

it("switches the settings heading and live loading message without restarting the read", async () => {
  mocks.settings.mockReturnValue(new Promise(() => {}));
  render(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(I18nProvider, null, createElement(SettingsDialog, {
    open: true, layout: "auto", onClose: vi.fn(), onBusyChange: vi.fn(), onManageModels: vi.fn(), onMoveLibrary: vi.fn(), onLayoutChange: vi.fn(),
  }))));
  expect(screen.getByText("Einstellungen werden geladen…")).toBeTruthy();
  await act(async () => setLang("en"));
  expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
  expect(screen.getByText("Loading settings…")).toBeTruthy();
  expect(mocks.settings).toHaveBeenCalledTimes(1);
});
