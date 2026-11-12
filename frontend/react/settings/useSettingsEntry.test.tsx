// @vitest-environment happy-dom
import { act, cleanup, fireEvent, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLang } from "../../i18n.js";
import { useSettingsEntry } from "./useSettingsEntry";

const mocks = vi.hoisted(() => ({ listen: vi.fn(), configure: vi.fn(), unlisten: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("../../backend", () => ({ backend: { configureSettingsMenu: mocks.configure } }));

beforeEach(() => {
  vi.resetAllMocks(); setLang("en");
  mocks.listen.mockResolvedValue(mocks.unlisten);
  mocks.configure.mockResolvedValue(undefined);
});
afterEach(cleanup);

it("accepts only Command-comma without extra modifiers or key repetition", () => {
  const open = vi.fn();
  renderHook(() => useSettingsEntry(true, true, open));
  for (const modifiers of [{}, { ctrlKey: true }, { metaKey: true, shiftKey: true }, { metaKey: true, altKey: true }, { metaKey: true, ctrlKey: true }, { metaKey: true, repeat: true }]) {
    fireEvent.keyDown(document, { key: ",", ...modifiers });
  }
  expect(open).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: ",", metaKey: true });
  expect(open).toHaveBeenCalledOnce();
});

it("uses the current availability for keyboard and native requests", async () => {
  const open = vi.fn();
  const view = renderHook(({ enabled }) => useSettingsEntry(true, enabled, open), { initialProps: { enabled: false } });
  const nativeRequest = mocks.listen.mock.calls[0][1];
  fireEvent.keyDown(document, { key: ",", metaKey: true }); nativeRequest();
  expect(open).not.toHaveBeenCalled();
  view.rerender({ enabled: true });
  nativeRequest();
  expect(open).toHaveBeenCalledOnce();
  view.rerender({ enabled: false });
  nativeRequest();
  expect(open).toHaveBeenCalledOnce();
  await waitFor(() => expect(mocks.configure).toHaveBeenLastCalledWith("Settings…", false));
});

it("does not open settings over another native dialog", () => {
  const open = vi.fn();
  renderHook(() => useSettingsEntry(true, true, open));
  const dialog = document.createElement("dialog");
  dialog.open = true; document.body.append(dialog);
  try {
    fireEvent.keyDown(document, { key: ",", metaKey: true });
    mocks.listen.mock.calls[0][1]();
    expect(open).not.toHaveBeenCalled();
  } finally { dialog.remove(); }
});

it("updates the native menu label when the interface language changes", async () => {
  renderHook(() => useSettingsEntry(true, true, vi.fn()));
  expect(mocks.configure).toHaveBeenLastCalledWith("Settings…", true);
  await act(async () => setLang("de"));
  expect(mocks.configure).toHaveBeenLastCalledWith("Einstellungen…", true);
});

it("cleans up late native registrations and keyboard listeners after unmount", async () => {
  let registered!: (off: () => void) => void;
  mocks.listen.mockReturnValue(new Promise(resolve => { registered = resolve; }));
  const open = vi.fn();
  const view = renderHook(() => useSettingsEntry(true, true, open));
  const nativeRequest = mocks.listen.mock.calls[0][1];
  view.unmount();
  await act(async () => registered(mocks.unlisten));
  expect(mocks.unlisten).toHaveBeenCalledOnce();
  nativeRequest(); fireEvent.keyDown(document, { key: ",", metaKey: true });
  expect(open).not.toHaveBeenCalled();
});

it("leaves non-macOS keyboard and menus unchanged", () => {
  const open = vi.fn();
  renderHook(() => useSettingsEntry(false, true, open));
  fireEvent.keyDown(document, { key: ",", metaKey: true });
  expect(open).not.toHaveBeenCalled();
  expect(mocks.listen).not.toHaveBeenCalled();
  expect(mocks.configure).not.toHaveBeenCalled();
});
