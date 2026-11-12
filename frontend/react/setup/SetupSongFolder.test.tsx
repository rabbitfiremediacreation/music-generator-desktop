// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "../i18n";
import { setLang, t } from "../../i18n.js";
import { LANGS } from "../../locales";
import { SetupScreen } from "./SetupScreen";
import { measuredBackend, setupFixture } from "./fixtures";
import type { Bootstrap } from "../../types";

const ipc = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: ipc.invoke }));

beforeEach(() => {
  setLang("de");
  ipc.invoke.mockReset().mockImplementation(async (name: string) => {
    if (name === "setup_estimate") return { missing_bytes: 0, free_bytes: 1024 ** 4 };
    if (name === "generation_policy") return { backend: "gpu" };
    if (name === "cuda_status") return { state: "not_applicable", details: null, download_bytes: 0 };
    if (name === "phone_access_status") return { enabled: false, port: 8767, token: "", addresses: [] };
    if (name === "setup_models") return { ok: true, mode: "single", backend_status: measuredBackend };
    throw new Error(`Unexpected command ${name}`);
  });
});
afterEach(cleanup);

function mount(bootstrap: Bootstrap = setupFixture) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><I18nProvider><SetupScreen bootstrap={bootstrap} onComplete={() => {}} /></I18nProvider></QueryClientProvider>);
}

async function next() {
  const button = screen.getByRole("button", { name: "Weiter" }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
}

it.each(["windows", "macos", "linux"])("explains a folder move before editing and before starting reopened setup on %s", async platform => {
  mount({ ...setupFixture, needs_setup: false, settings: { ...setupFixture.settings, setup_complete: true }, hardware: { ...setupFixture.hardware, platform } });
  const songs = screen.getByRole("textbox", { name: /Song-Ordner/ });
  const hint = screen.getByText("Songs liegen außerhalb der App. Beim Wechsel werden vorhandene Songs verschoben.");
  expect(hint.closest(".field")).toBe(songs.closest(".field"));
  expect(songs.getAttribute("aria-describedby")?.split(" ")).toContain(hint.id);
  expect(screen.getByRole("textbox", { name: /Modellordner/ }).getAttribute("aria-describedby")?.split(" ")).not.toContain(hint.id);

  fireEvent.change(songs, { target: { value: "/isolated/new-songs" } });
  await next();
  await next();
  const destination = screen.getByText("/isolated/new-songs").closest("dd")!;
  expect(within(destination).getByText(t("desktop_songs_tip"))).toBeTruthy();
  expect(ipc.invoke.mock.calls.some(([name]) => name === "setup_models")).toBe(false);
  expect(setupFixture.settings.songs_dir).toBe("/songs");

  fireEvent.click(screen.getByRole("button", { name: "Modelle laden und testen" }));
  await screen.findByRole("button", { name: "Zum Studio" });
  expect(ipc.invoke).toHaveBeenCalledWith("setup_models", { request: expect.objectContaining({ songs_dir: "/isolated/new-songs" }) });
  expect(screen.queryByText(t("desktop_songs_tip"))).toBeNull();
});

it("keeps the folder explanation translated in every UI language during first setup", () => {
  mount();
  const songs = screen.getByRole("textbox", { name: /Song-Ordner/ });
  for (const language of Object.keys(LANGS)) {
    fireEvent.change(screen.getByRole("combobox", { name: t("language") }), { target: { value: language } });
    const hint = screen.getByText(t("desktop_songs_tip"));
    expect(hint.textContent).not.toBe("desktop_songs_tip");
    expect(hint.textContent).not.toBe("");
    expect(songs.getAttribute("aria-describedby")?.split(" ")).toContain(hint.id);
    expect((songs as HTMLInputElement).value).toBe("/songs");
  }
});
