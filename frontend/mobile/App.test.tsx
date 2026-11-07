// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { App, secureConnectionUrl } from "./App";
import { connectionKey } from "./client";

const request = vi.fn();
const song = { id: "one", title: "Rain song", caption: "piano", status: "done", favorite: false, folder_id: null, result_meta: { duration: 90, bpm: 80 }, params: {}, url: "/api/songs/one/audio" };
beforeEach(() => {
  window.localStorage.clear(); window.history.replaceState(null, "", "/mobile/#token=paired-key");
  vi.stubGlobal("isSecureContext", true);
  vi.spyOn(navigator, "language", "get").mockReturnValue("en");
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.stubGlobal("fetch", request);
  request.mockReset();
  request.mockImplementation(async (path: string) => {
    const value = path.startsWith("/api/songs?") ? [song] : path === "/api/folders" ? { folders: [], all: 1, none: 1 } : path === "/api/queue" ? { running: [], queued: 0, active: false, progress: null } : path === "/api/generate" ? { ids: ["new"], group_id: "g" } : {};
    return new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("pairs from the QR fragment, shows the library and submits a generation to the same computer", async () => {
  render(<App />);
  await screen.findByRole("heading", { name: "Rain song" });
  expect(window.location.hash).toBe("");
  expect(window.localStorage.getItem(connectionKey)).toBe("paired-key");
  fireEvent.click(screen.getByRole("button", { name: "Favorite: Rain song" }));
  await waitFor(() => expect(request).toHaveBeenCalledWith("/api/songs/one", expect.objectContaining({ method: "PATCH", body: '{"favorite":true}' })));
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Your idea" }), { target: { value: "warm piano" } });
  fireEvent.click(screen.getByRole("button", { name: "Generate on computer" }));
  await screen.findByText("Your song is in the queue.");
  const call = request.mock.calls.find(([path]) => path === "/api/generate")!;
  expect(call[1].headers.get("Authorization")).toBe("Bearer paired-key");
  expect(JSON.parse(call[1].body)).toMatchObject({ prompt: "warm piano", instrumental: true, duration: 90, variants: 1, folder_id: null });
});

it("clears a revoked saved key and asks for a fresh pairing", async () => {
  window.localStorage.setItem(connectionKey, "old");
  request.mockResolvedValue(new Response('{"detail":"expired"}', { status: 401 }));
  render(<App />);
  expect(await screen.findByText("The key is no longer valid. Scan the new QR code on your computer.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
  expect(window.localStorage.getItem(connectionKey)).toBeNull();
});

it("shows certificate onboarding over HTTP without sending the pairing key to the API", async () => {
  vi.stubGlobal("isSecureContext", false);
  request.mockResolvedValue(new Response(JSON.stringify({ secure_addresses: ["https://localhost:8768/mobile/"], certificate_url: "/mobile-ca.crt", certificate_fingerprint: "AB:CD" })));
  render(<App />);
  const link = await screen.findByRole("link", { name: "Open HTTPS web app" });
  expect(link.getAttribute("href")).toBe("https://localhost:8768/mobile/#token=paired-key");
  expect(screen.getByText("AB:CD")).toBeTruthy();
  const profile = screen.getByRole("link", { name: "iPhone: install profile" });
  expect(profile.getAttribute("href")).toBe("/mobile-ca.mobileconfig");
  expect(profile.hasAttribute("download")).toBe(false);
  expect(screen.getByRole("link", { name: "Android: download certificate" }).getAttribute("href")).toBe("/mobile-ca.crt");
  expect(request.mock.calls.every(([path]) => path === "/mobile/connection.json")).toBe(true);
  expect(request.mock.calls[0][1].headers).toBeUndefined();
});

it("carries the key only to an HTTPS address for this host and the designated secure port", () => {
  const host = { hostname: "studio.local" };
  expect(secureConnectionUrl(["https://evil.test:8768/mobile/", "https://studio.local:9999/mobile/", "http://studio.local:8768/mobile/"], host, "key")).toBeNull();
  expect(secureConnectionUrl(["https://studio.local:8768/mobile/"], host, "key")).toBe("https://studio.local:8768/mobile/#token=key");
});

it("stops audio and releases the blob when the connection is disconnected", async () => {
  const create = vi.fn(() => "blob:playing"), revoke = vi.fn();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  const original = request.getMockImplementation()!;
  request.mockImplementation((path, options) => path === "/api/songs/one/audio" ? Promise.resolve(new Response(new Blob(["audio"]))) : original(path, options));
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "Play: Rain song" }));
  await screen.findByLabelText("Now playing");
  await act(async () => { fireEvent.click(screen.getByText("Connection", { selector: "summary" })); });
  fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
  await screen.findByRole("heading", { name: "Connect to your computer" });
  expect(revoke).toHaveBeenCalledWith("blob:playing");
  expect(screen.queryByLabelText("Now playing")).toBeNull();
});

it("keeps a generation submission pending when navigating between tabs", async () => {
  const original = request.getMockImplementation()!;
  let finish!: (value: Response) => void;
  request.mockImplementation((path, options) => path === "/api/generate" ? new Promise<Response>(resolve => { finish = resolve; }) : original(path, options));
  render(<App />);
  await screen.findByRole("heading", { name: "Rain song" });
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Your idea" }), { target: { value: "only one song" } });
  const form = screen.getByRole("button", { name: "Generate on computer" }).closest("form")!;
  fireEvent.submit(form);
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  fireEvent.click(screen.getByRole("button", { name: "Library" }));
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  expect((screen.getByRole("textbox", { name: "Your idea" }) as HTMLTextAreaElement).value).toBe("only one song");
  expect((screen.getByRole("button", { name: "Loading…" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.submit(form);
  expect(request.mock.calls.filter(([path]) => path === "/api/generate")).toHaveLength(1);
  await act(async () => { finish(new Response('{"ids":["new"],"group_id":"g"}')); });
  await screen.findByText("Your song is in the queue.");
});

it("waits for a successful queue response before claiming the computer is ready", async () => {
  const original = request.getMockImplementation()!;
  let finish!: (value: Response) => void;
  request.mockImplementation((path, options) => path === "/api/queue" ? new Promise<Response>(resolve => { finish = resolve; }) : original(path, options));
  render(<App />);
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  expect(screen.queryByText("Ready for a new idea")).toBeNull();
  expect(screen.queryByText("Connected to your computer")).toBeNull();
  await act(async () => { finish(new Response('{"running":[],"queued":0,"active":false,"progress":null}')); });
  await screen.findByText("Ready for a new idea");
});

it("remembers a QR connection across launches and lets the user opt out", async () => {
  render(<App />); await screen.findByRole("heading", { name: "Rain song" });
  expect(window.localStorage.getItem(connectionKey)).toBe("paired-key");
  cleanup(); window.history.replaceState(null, "", "/mobile/");
  render(<App />); await screen.findByRole("heading", { name: "Rain song" });
  fireEvent.click(screen.getByText("Connection", { selector: "summary" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Remember the key on this device" }));
  await waitFor(() => expect(window.localStorage.getItem(connectionKey)).toBeNull());
  expect(screen.getByRole("heading", { name: "Rain song" })).toBeTruthy();
  cleanup(); render(<App />);
  expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
});

it("shows scanning without requesting camera access and accepts a pasted connection link", async () => {
  const camera = vi.fn();
  vi.stubGlobal("navigator", { language: "en", mediaDevices: { getUserMedia: camera } });
  window.history.replaceState(null, "", "/mobile/");
  const originalAddress = window.location.href;
  render(<App />);
  expect(screen.getByRole("button", { name: "Scan QR code" })).toBeTruthy();
  expect(camera).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Access key"), { target: { value: "https://another-host.test/mobile/#token=pasted-key" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  await screen.findByRole("heading", { name: "Rain song" });
  expect(window.location.href).toBe(originalAddress);
  expect(window.localStorage.getItem(connectionKey)).toBe("pasted-key");
  expect(request.mock.calls.some(([path]) => String(path).startsWith("https://another-host.test"))).toBe(false);
});
