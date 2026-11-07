// @vitest-environment happy-dom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLang, t } from "../../i18n.js";
import type { ModelCatalog, ModelSelection } from "../../types";
import { catalogFixture } from "./model-fixtures";
import { standard } from "../setup/fixtures";
import { ModelBrowser } from "./ModelBrowser";

beforeEach(() => setLang("en"));
afterEach(cleanup);
const changed = vi.fn();
function mount(catalog: ModelCatalog = structuredClone(catalogFixture), busy = false) {
  catalog.hardware.ram_bytes = 64 * 1024 ** 3;
  changed.mockClear();
  function Harness() {
    const [draft, setDraft] = useState<ModelSelection>(standard), [compatible, setCompatible] = useState(true);
    return <form><ModelBrowser catalog={catalog} draft={draft} compatibleOnly={compatible} onCompatibleChange={setCompatible} busy={busy} onChange={value => { changed(value); setDraft(value); }}><output aria-label="draft">{draft.synthesis}</output></ModelBrowser></form>;
  }
  render(<Harness />);
}

it("selects a searched family in the details without applying or downloading it", () => {
  mount();
  fireEvent.change(screen.getByRole("searchbox", { name: t("browser_search") }), { target: { value: "XL SFT Q5" } });
  fireEvent.click(screen.getByRole("button", { name: "XL SFT" }));
  expect(screen.getByRole("heading", { name: "XL SFT" })).toBeTruthy();
  expect(screen.getByLabelText("draft").textContent).toBe("acestep-v15-xl-sft-Q5_K_M.gguf");
  expect(changed).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "XL SFT" }).getAttribute("aria-pressed")).toBe("true");
});

it("shows only installed families and leaves the selection intact when a search has no results", () => {
  const catalog = structuredClone(catalogFixture);
  catalog.models = catalog.models.map(model => ({ ...model, verified: model.file === standard.synthesis }));
  mount(catalog);
  fireEvent.click(screen.getByRole("button", { name: t("browser_installed") }));
  expect(within(screen.getByRole("list", { name: t("browser_catalog") })).getAllByRole("button")).toHaveLength(1);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "no-match" } });
  expect(screen.getByText(t("browser_empty"))).toBeTruthy();
  expect(screen.getByRole("heading", { name: "SFT" })).toBeTruthy();
  expect(changed).not.toHaveBeenCalled();
});

it("prevents Enter in the search field from submitting settings", () => {
  mount();
  const key = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  fireEvent(screen.getByRole("searchbox"), key);
  expect(key.defaultPrevented).toBe(true);
  expect(changed).not.toHaveBeenCalled();
});

it("blocks changing a family while a download is running", () => {
  mount(undefined, true);
  const button = screen.getByRole("button", { name: "XL SFT" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(changed).not.toHaveBeenCalled();
});
