import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ settings: vi.fn(), export: vi.fn(), save: vi.fn(), exportDefaultPath: vi.fn() }));
vi.mock("./backend", () => ({ backend: mocks }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: mocks.save }));
vi.mock("./i18n.js", () => ({ t: (key: string) => `translated:${key}` }));
import { exportFolder, exportSong } from "./exports";
import type { Song } from "./types";
const song = { id: "one", title: "Rain", caption: "piano", file: "one.wav" } as Song;
beforeEach(() => { vi.resetAllMocks(); mocks.settings.mockResolvedValue({ export_format: "mp3" }); mocks.save.mockResolvedValue("/exports/Rain.mp3"); mocks.exportDefaultPath.mockImplementation(async name => `/Downloads/${name}`); });
it("uses the selected MP3 format in the native save dialog", async () => {
  await exportSong(song);
  expect(mocks.save).toHaveBeenCalledWith({ defaultPath: "/Downloads/Rain.mp3", title: "translated:dialog_export_audio", filters: [{ name: "MP3", extensions: ["mp3"] }] });
  expect(mocks.export).toHaveBeenCalledWith("audio", "/exports/Rain.mp3", "one", null);
});
it("keeps lyrics as text regardless of the audio setting", async () => {
  await exportSong(song, true);
  expect(mocks.settings).not.toHaveBeenCalled();
  expect(mocks.save.mock.calls[0][0].defaultPath).toBe("/Downloads/Rain.txt");
});

it("shows the publication disclosure during native export of generated audio", async () => {
  const generated = { ...song, result_meta: { generated_by: "MiniMax-Music3", machine_generated: true } };
  await exportSong(generated);
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ title: "translated:dialog_export_generated_audio" }));
  expect(mocks.export).toHaveBeenCalledWith("audio", "/exports/Rain.mp3", "one", null);
  await exportSong(generated, true);
  expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ title: "translated:dialog_export_lyrics" }));
});

it("keeps the export destination unchanged when the save dialog is cancelled", async () => {
  mocks.save.mockResolvedValue(null);
  await exportSong(song); await exportSong(song, true); await exportFolder("favorites");
  expect(mocks.export).not.toHaveBeenCalled();
  expect(mocks.save.mock.calls.map(call => call[0].defaultPath)).toEqual(["/Downloads/Rain.mp3", "/Downloads/Rain.txt", "/Downloads/Music Generator.zip"]);
});
it("preserves folder selection and translates conversion errors", async () => {
  mocks.export.mockRejectedValue(new Error("mp3_failed"));
  await expect(exportFolder("favorites")).rejects.toThrow("translated:mp3_failed");
  expect(mocks.export).toHaveBeenCalledWith("zip", "/exports/Rain.mp3", null, "favorites");
});

it("translates native save dialog failures without exporting", async () => {
  mocks.save.mockRejectedValue(new Error("Native dialog failed"));
  await expect(exportSong(song)).rejects.toThrow("translated:dialog_failed");
  expect(mocks.export).not.toHaveBeenCalled();
});
