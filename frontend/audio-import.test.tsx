// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { I18nProvider } from "./react/i18n";
import { AudioControls } from "./react/audio/AudioControls";
import { setLang, t } from "./i18n.js";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke, convertFileSrc: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); setLang("en");
  invoke.mockImplementation(async command => {
    if (command === "dialog_directory") return "/home/test";
    if (command === "pick_audio_file") return { name: "雨.wav", directory: "/music", data: [82, 73, 70, 70] };
    if (command === "analyze") return { caption: "Piano", bpm: 100 };
  });
});
afterEach(cleanup);
function mount() {
  const analyzed = vi.fn();
  render(<QueryClientProvider client={new QueryClient()}><I18nProvider><AudioControls selection={null} onAnalysis={analyzed} /></I18nProvider></QueryClientProvider>);
  return analyzed;
}
it.each(["click", "Enter", " "])("native audio selection via %s supplies the original bytes to analysis", async activation => {
  const analyzed = mount(); const user = userEvent.setup();
  const upload = screen.getByRole("button", { name: t("drop_aria") });
  if (activation === "click") await user.click(upload);
  else { upload.focus(); await user.keyboard(activation === "Enter" ? "{Enter}" : " "); }
  await waitFor(() => expect(analyzed).toHaveBeenCalledWith({ caption: "Piano", bpm: 100 }, false));
  expect(invoke).toHaveBeenCalledWith("analyze", { data: [82, 73, 70, 70], filename: "雨.wav", selection: undefined });
  expect(invoke).toHaveBeenCalledWith("pick_audio_file", { directory: "/home/test", title: t("dialog_audio_import"), filterName: t("dialog_audio_filter") });
  expect(JSON.parse(localStorage.getItem("dialog-folders:v1")!).audio_import).toBe("/music");
});
it("leaves analysis and folder history untouched on cancellation and reports native read errors", async () => {
  const analyzed = mount(); const user = userEvent.setup();
  const upload = screen.getByRole("button", { name: t("drop_aria") });
  let finish!: (value: null) => void;
  invoke.mockImplementation(async command => command === "dialog_directory" ? "/home/test" : new Promise(resolve => { finish = resolve; }));
  await user.click(upload); await user.click(upload);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("pick_audio_file", expect.any(Object)));
  expect(invoke.mock.calls.filter(([name]) => name === "pick_audio_file")).toHaveLength(1);
  await act(async () => finish(null));
  expect(analyzed).not.toHaveBeenCalled(); expect(localStorage.getItem("dialog-folders:v1")).toBeNull();
  invoke.mockImplementation(async command => { if (command === "dialog_directory") return "/home/test"; throw new Error("audio_size"); });
  await user.click(upload);
  await screen.findByText(`${t("error")}: ${t("audio_size")}`);
  expect(analyzed).not.toHaveBeenCalled();
});
