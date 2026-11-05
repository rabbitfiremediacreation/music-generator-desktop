// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { AuthenticationError, connectionKey, readConnection, releaseMedia, rememberConnection, RemoteApi } from "./client";

const http = vi.fn();
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("takes a pairing key from the fragment and removes it from the address before making requests", () => {
  const history = { replaceState: vi.fn() };
  const storage = { getItem: vi.fn(() => "old-key") };
  expect(readConnection({ hash: "#token=new-key", pathname: "/mobile/", search: "" }, history, storage)).toEqual({ token: "new-key", remembered: true });
  expect(history.replaceState).toHaveBeenCalledWith(null, "", "/mobile/");
  expect(storage.getItem).toHaveBeenCalledWith(connectionKey);
});

it("continues pairing in memory when storage is denied and saves a key only when opted in", () => {
  const denied = { getItem: () => { throw new Error("denied"); } };
  expect(readConnection({ hash: "#token=key", pathname: "/mobile/", search: "" }, { replaceState: vi.fn() }, denied).token).toBe("key");
  const storage = { setItem: vi.fn(), removeItem: vi.fn() };
  rememberConnection("key", false, storage);
  expect(storage.setItem).not.toHaveBeenCalled();
  expect(storage.removeItem).toHaveBeenCalledWith(connectionKey);
  rememberConnection("key", true, storage);
  expect(storage.setItem).toHaveBeenCalledWith(connectionKey, "key");
});

it("keeps the key in the authorization header, refuses external paths and avoids cached API data", async () => {
  vi.stubGlobal("fetch", http.mockResolvedValue(new Response('{"ok":true}', { headers: { "Content-Type": "application/json" } })));
  const api = new RemoteApi("secret", "de", vi.fn());
  await expect(api.json("/api/queue")).resolves.toEqual({ ok: true });
  const [path, options] = http.mock.lastCall!;
  expect(path).toBe("/api/queue");
  expect(options.headers.get("Authorization")).toBe("Bearer secret");
  expect(options.headers.get("X-Lang")).toBe("de");
  expect(options).toMatchObject({ cache: "no-store", credentials: "omit", redirect: "error", mode: "same-origin" });
  await expect(api.json("https://external.test/api/songs")).rejects.toThrow("Invalid API path");
  api.close();
  expect(options.signal.aborted).toBe(true);
});

it("revokes the session on a rejected key and preserves the server's error message", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"detail":"key changed"}', { status: 401 })));
  const invalid = vi.fn(), api = new RemoteApi("old", "en", invalid);
  await expect(api.json("/api/songs")).rejects.toBeInstanceOf(AuthenticationError);
  expect(invalid).toHaveBeenCalledOnce();
});

it("fetches downloads with authorization and reads UTF-8 download names", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Blob(["audio"]), { headers: { "Content-Disposition": "attachment; filename=\"song.wav\"; filename*=UTF-8''Regen%20am%20Meer.wav" } })));
  const value = await new RemoteApi("key", "en", vi.fn()).blob("/api/songs/one/audio?download=true");
  expect(value.filename).toBe("Regen am Meer.wav");
  expect(await value.blob.text()).toBe("audio");
});

it("releases the player and its blob when disconnecting or changing tracks", () => {
  const revoke = vi.fn(); vi.stubGlobal("URL", Object.assign(URL, { revokeObjectURL: revoke }));
  const audio = { pause: vi.fn(), removeAttribute: vi.fn(), load: vi.fn() };
  releaseMedia(audio as unknown as HTMLAudioElement, "blob:track");
  expect(audio.pause).toHaveBeenCalledOnce(); expect(audio.removeAttribute).toHaveBeenCalledWith("src"); expect(audio.load).toHaveBeenCalledOnce(); expect(revoke).toHaveBeenCalledWith("blob:track");
});

it("discards an old media response when its connection closes while reading the body", async () => {
  let finish!: (blob: Blob) => void;
  const response = { ok: true, headers: new Headers(), blob: () => new Promise<Blob>(resolve => { finish = resolve; }) };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  const api = new RemoteApi("key", "en", vi.fn());
  const pending = api.blob("/api/songs/one/audio");
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  api.close(); finish(new Blob(["audio"]));
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});
