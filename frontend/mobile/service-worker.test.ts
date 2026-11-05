import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

function worker() {
  const handlers: Record<string, (event: unknown) => void> = {};
  const cache = { addAll: vi.fn().mockResolvedValue(undefined), match: vi.fn().mockResolvedValue(new Response("offline shell")) };
  const caches = { open: vi.fn().mockResolvedValue(cache), keys: vi.fn().mockResolvedValue([]), delete: vi.fn() };
  const fetch = vi.fn().mockResolvedValue(new Response("network shell"));
  const source = readFileSync(new URL("./public/sw.js", import.meta.url), "utf8").replace("__MOBILE_PRECACHE__", JSON.stringify(["/mobile/", "/mobile/index.html", "/mobile/assets/app.js"]));
  runInNewContext(source, { URL, Response, caches, fetch, self: { location: { origin: "https://studio.local:8768" }, addEventListener: (name: string, callback: (event: unknown) => void) => { handlers[name] = callback; }, skipWaiting: vi.fn(), clients: { claim: vi.fn() } } });
  return { handlers, cache, caches, fetch };
}

it("pre-caches the shell while authenticated API, certificate and connection requests always bypass the worker", async () => {
  const { handlers, cache } = worker();
  let installed!: Promise<void>;
  handlers.install({ waitUntil: (promise: Promise<void>) => { installed = promise; } });
  await installed;
  expect(cache.addAll).toHaveBeenCalledWith(["/mobile/", "/mobile/index.html", "/mobile/assets/app.js"]);
  for (const url of ["https://studio.local:8768/api/songs", "https://studio.local:8768/api/songs/one/audio", "https://studio.local:8768/mobile/connection.json", "https://studio.local:8768/mobile-ca.crt", "https://other.test/mobile/assets/app.js", "https://studio.local:8768/mobile/?token=secret"]) {
    const respondWith = vi.fn();
    handlers.fetch({ request: { url, method: "GET" }, respondWith });
    expect(respondWith, url).not.toHaveBeenCalled();
  }
});

it("uses cached shell only when the computer cannot be reached and never writes responses into cache", async () => {
  const { handlers, cache, fetch } = worker();
  fetch.mockRejectedValueOnce(new TypeError("offline"));
  let response!: Promise<Response>;
  handlers.fetch({ request: { url: "https://studio.local:8768/mobile/", method: "GET" }, respondWith: (value: Promise<Response>) => { response = value; } });
  expect(await (await response).text()).toBe("offline shell");
  expect(cache.match).toHaveBeenCalledWith("/mobile/");
  expect(Object.keys(cache)).not.toContain("put");
});
