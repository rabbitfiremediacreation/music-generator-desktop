// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLang } from "../i18n.js";
import { useAppMenu } from "./useAppMenu";

const mocks = vi.hoisted(() => ({ listen: vi.fn(), configure: vi.fn(), unlisten: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("../backend", () => ({ backend: { configureAppMenu: mocks.configure } }));

beforeEach(() => {
  vi.resetAllMocks(); setLang("en");
  mocks.listen.mockResolvedValue(mocks.unlisten);
  mocks.configure.mockResolvedValue(undefined);
});
afterEach(cleanup);

function menu(onSettings = vi.fn(), macos = true) {
  const client = new QueryClient();
  return renderHook(({ studio }) => useAppMenu({ macos, ready: true, studio, settingsOpen: false, onSettings }), {
    initialProps: { studio: true },
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}

it("accepts only Command-comma without extra modifiers or key repetition", () => {
  const open = vi.fn();
  menu(open);
  for (const modifiers of [{}, { ctrlKey: true }, { metaKey: true, shiftKey: true }, { metaKey: true, altKey: true }, { metaKey: true, ctrlKey: true }, { metaKey: true, repeat: true }]) {
    fireEvent.keyDown(document, { key: ",", ...modifiers });
  }
  expect(open).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: ",", metaKey: true });
  expect(open).toHaveBeenCalledOnce();
});

it("uses the current studio availability for keyboard and native requests", async () => {
  const open = vi.fn();
  const view = menu(open);
  const nativeRequest = () => mocks.listen.mock.calls[0][1]({ payload: "settings" });
  view.rerender({ studio: false });
  fireEvent.keyDown(document, { key: ",", metaKey: true }); nativeRequest();
  expect(open).not.toHaveBeenCalled();
  await waitFor(() => expect(mocks.configure).toHaveBeenLastCalledWith(expect.any(Object), ["documentation", "updates"]));
  view.rerender({ studio: true });
  nativeRequest();
  expect(open).toHaveBeenCalledOnce();
});

it("does not open settings over another dialog", () => {
  const open = vi.fn();
  menu(open);
  const dialog = document.createElement("dialog");
  dialog.open = true; document.body.append(dialog);
  try {
    fireEvent.keyDown(document, { key: ",", metaKey: true });
    mocks.listen.mock.calls[0][1]({ payload: "settings" });
    expect(open).not.toHaveBeenCalled();
  } finally { dialog.remove(); }
});

it("translates the native menu headings and actions when the interface language changes", async () => {
  menu();
  expect(mocks.configure).toHaveBeenLastCalledWith(expect.objectContaining({ settings: "Settings…", updates: "Check for updates…", file: "File" }), expect.arrayContaining(["settings", "updates", "models"]));
  await act(async () => setLang("de"));
  expect(mocks.configure).toHaveBeenLastCalledWith(expect.objectContaining({ settings: "Einstellungen…", updates: "Nach Updates suchen…", file: "Ablage" }), expect.arrayContaining(["settings", "updates", "models"]));
});

it("cleans up late native registrations and keyboard listeners after unmount", async () => {
  let registered!: (off: () => void) => void;
  mocks.listen.mockReturnValue(new Promise(resolve => { registered = resolve; }));
  const open = vi.fn();
  const view = menu(open);
  const nativeRequest = mocks.listen.mock.calls[0][1];
  view.unmount();
  await act(async () => registered(mocks.unlisten));
  expect(mocks.unlisten).toHaveBeenCalledOnce();
  nativeRequest({ payload: "settings" }); fireEvent.keyDown(document, { key: ",", metaKey: true });
  expect(open).not.toHaveBeenCalled();
});

it("only registers the menu on macOS", () => {
  const open = vi.fn();
  menu(open, false);
  fireEvent.keyDown(document, { key: ",", metaKey: true });
  expect(open).not.toHaveBeenCalled();
  expect(mocks.listen).not.toHaveBeenCalled();
  expect(mocks.configure).not.toHaveBeenCalled();
});
