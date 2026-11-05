export const connectionKey = "music-generator-mobile-token";

export interface Connection { token: string; remembered: boolean }

/** The pairing key belongs in the fragment, which never goes to the HTTP server. */
export function readConnection(location: Pick<Location, "hash" | "pathname" | "search">, history: Pick<History, "replaceState">, storage?: Pick<Storage, "getItem">): Connection {
  let saved = "";
  try { saved = storage?.getItem(connectionKey) || ""; } catch { /* Private browsing can deny storage. */ }
  const fragment = new URLSearchParams(location.hash.slice(1));
  const paired = fragment.get("token");
  if (fragment.has("token")) history.replaceState(null, "", location.pathname + location.search);
  return { token: paired ?? saved, remembered: Boolean(saved) };
}

export function rememberConnection(token: string, remember: boolean, storage?: Pick<Storage, "setItem" | "removeItem">): boolean {
  try {
    if (remember && token) storage?.setItem(connectionKey, token);
    else storage?.removeItem(connectionKey);
    return Boolean(storage);
  } catch { return false; }
}

export class AuthenticationError extends Error {}

export class RemoteApi {
  private lifetime = new AbortController();
  constructor(private token: string, private language: string, private unauthorized: () => void) {}
  close() { this.lifetime.abort(); }
  private ensureOpen() { if (this.lifetime.signal.aborted) throw new DOMException("Connection closed", "AbortError"); }
  private async request(path: string, options: RequestInit = {}): Promise<Response> {
    this.ensureOpen();
    if (!path.startsWith("/api/")) throw new Error("Invalid API path");
    const headers = new Headers(options.headers);
    headers.set("Authorization", `Bearer ${this.token}`);
    headers.set("X-Lang", this.language);
    const response = await fetch(path, { ...options, headers, signal: this.lifetime.signal, cache: "no-store", credentials: "omit", redirect: "error", mode: "same-origin" });
    this.ensureOpen();
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try { const body = await response.json() as { detail?: unknown }; if (typeof body.detail === "string") detail = body.detail; } catch { /* Keep the HTTP status. */ }
      this.ensureOpen();
      if (response.status === 401) {
        this.unauthorized();
        throw new AuthenticationError(detail);
      }
      throw new Error(detail);
    }
    return response;
  }
  async json<T>(path: string, options?: RequestInit): Promise<T> { const value = await (await this.request(path, options)).json() as T; this.ensureOpen(); return value; }
  async write<T>(path: string, method: "POST" | "PATCH", value: unknown): Promise<T> {
    return this.json<T>(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
  }
  async blob(path: string): Promise<{ blob: Blob; filename: string | null }> {
    const response = await this.request(path);
    const disposition = response.headers.get("Content-Disposition") || "";
    const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    const plain = disposition.match(/filename="([^"]+)"/i)?.[1];
    let filename = plain || null;
    if (encoded) { try { filename = decodeURIComponent(encoded); } catch { /* Use the ASCII fallback. */ } }
    const blob = await response.blob();
    this.ensureOpen();
    return { blob, filename };
  }
}

export function releaseMedia(audio: HTMLAudioElement | null, objectUrl: string | null) {
  if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); }
  if (objectUrl) URL.revokeObjectURL(objectUrl);
}
