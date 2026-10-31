// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { ImportDialog } from "./ImportDialog";
const mocks = vi.hoisted(() => ({ previewMove: vi.fn(), previewImport: vi.fn(), saveSettings: vi.fn(), importLibrary: vi.fn(), cancelSetup: vi.fn(), pickFolder: vi.fn() }));
vi.mock("../../backend", () => ({ backend: mocks }));
vi.mock("../../path-dialogs", () => ({ pickFolder: mocks.pickFolder, pathErrorText: (error: unknown) => String(error) }));
const preview = { songs: 3, folders: 1, files: 3, bytes: 1024, free_bytes: 4096, songs_source: "/old", missing: [], issues: [], can_import: true };
beforeEach(() => {
  vi.clearAllMocks(); mocks.previewMove.mockResolvedValue(preview); mocks.saveSettings.mockResolvedValue({});
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
});
afterEach(cleanup);
it("rechecks the selected destination before moving and refreshes the library after completion", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["songs"], []);
  const imported = vi.fn();
  render(<QueryClientProvider client={client}><I18nProvider><ImportDialog open mode="move" songsDirectory="/first" platform="windows" onClose={vi.fn()} onImported={imported} /></I18nProvider></QueryClientProvider>);
  const choose = await screen.findByRole("button", { name: /Choose another destination|Anderen Zielordner/i });
  await waitFor(() => expect((choose as HTMLButtonElement).disabled).toBe(false));
  mocks.pickFolder.mockResolvedValue("/new");
  fireEvent.click(choose);
  await waitFor(() => expect(mocks.previewMove).toHaveBeenLastCalledWith("/new"));
  const move = screen.getByRole("button", { name: /^Move songs$|^Songs verschieben$/i });
  await waitFor(() => expect((move as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(move);
  await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledWith({ songs_dir: "/new" }));
  await waitFor(() => expect(imported).toHaveBeenCalledWith("/new"));
  expect(client.getQueryState(["songs"])?.isInvalidated).toBe(true);
});
