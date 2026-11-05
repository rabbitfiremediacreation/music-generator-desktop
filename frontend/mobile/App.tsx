import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Folder, Queue, Song } from "../types";
import { AuthenticationError, readConnection, rememberConnection, releaseMedia, RemoteApi } from "./client";
import { messages, type Language, type Message } from "./messages";
import "./mobile.css";

interface FolderList { folders: Folder[]; all: number; none: number }
interface InstallPrompt extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
interface ConnectionInfo { secure_addresses: string[]; certificate_url: string; certificate_fingerprint: string }
type Translate = (key: Message) => string;
const noFolders: FolderList = { folders: [], all: 0, none: 0 };
const duration = (song: Song) => {
  const seconds = Number(song.result_meta?.duration || song.params?.duration || 0);
  return seconds ? `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}` : "";
};
const isAborted = (error: unknown) => error instanceof Error && error.name === "AbortError";

export function secureConnectionUrl(addresses: string[], location: Pick<Location, "hostname">, token: string): string | null {
  for (const address of addresses) {
    try {
      const url = new URL(address);
      if (url.protocol !== "https:" || url.hostname !== location.hostname || url.port !== "8768" || url.pathname !== "/mobile/" || url.username || url.password) continue;
      url.search = "";
      url.hash = new URLSearchParams({ token }).toString();
      return url.toString();
    } catch { /* Ignore malformed server addresses. */ }
  }
  return null;
}

function Icon({ name, ...props }: { name: "music" | "library" | "create" | "play" | "download" | "key" | "close" | "refresh"; className?: string }) {
  const paths = {
    music: <><path d="M9 18V5l11-2v13M9 8l11-2" /><ellipse cx="6" cy="18" rx="3" ry="3" /><ellipse cx="17" cy="16" rx="3" ry="3" /></>,
    library: <><path d="M4 4h5v16H4zM12 4h4v16h-4zM19 5l3 14" /></>,
    create: <><path d="M12 4v16M4 12h16" /></>,
    play: <path d="m8 4 13 8-13 8z" />,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4" /></>,
    key: <><circle cx="8" cy="8" r="5" /><path d="m12 12 9 9m-5-5 3-3m0 6 3-3" /></>,
    close: <path d="m5 5 14 14M5 19 19 5" />,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5 8a8 8 0 0 1 14-2l1 6M4 12l1 6a8 8 0 0 0 14-2" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>{paths[name]}</svg>;
}
function Field({ title, children }: { title: string; children: ReactNode }) { return <label className="field"><span>{title}</span>{children}</label>; }
function Failure({ children, retry, t }: { children: ReactNode; retry?: () => void; t: Translate }) { return <div className="notice danger" role="alert"><p>{children}</p>{retry && <button type="button" className="secondary" onClick={retry}>{t("retry")}</button>}</div>; }

function SecureSetup({ t, token, remember, setRemember, language }: { t: Translate; token: string; remember: boolean; setRemember: (value: boolean) => void; language: Language }) {
  const [info, setInfo] = useState<ConnectionInfo | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/mobile/connection.json", { signal: controller.signal, cache: "no-store", credentials: "omit", redirect: "error", mode: "same-origin" })
      .then(async response => { if (!response.ok) throw new Error(); const next = await response.json() as ConnectionInfo; if (!Array.isArray(next.secure_addresses)) throw new Error(); setInfo(next); setError(false); })
      .catch(reason => { if (!isAborted(reason)) setError(true); });
    return () => controller.abort();
  }, [revision]);
  const link = info && secureConnectionUrl(info.secure_addresses, window.location, token);
  const de = language === "de";
  return <section className="panel connect-panel">
    <div className="panel-icon"><Icon name="key" /></div>
    <h1>{de ? "Sicher mit deinem Rechner verbinden" : "Connect securely to your computer"}</h1>
    <p className="muted">{de ? "Für die installierbare Web-App vertraust du einmalig dem Zertifikat deines Rechners. Danach öffnest du die sichere Verbindung." : "To install the web app, trust your computer’s certificate once. Then open the secure connection."}</p>
    {error && <Failure t={t} retry={() => setRevision(value => value + 1)}>{t("unavailable")}</Failure>}
    {!info && !error && <p role="status">{t("loading")}</p>}
    {info && <>
      <ol className="setup-steps">
        <li><strong>{de ? "Zertifikat laden" : "Download certificate"}</strong><p>{de ? "Prüfe den Fingerabdruck mit dem am Desktop angezeigten Wert." : "Compare the fingerprint with the value shown on your desktop."}</p><a className="secondary" href="/mobile-ca.crt" download="Music-Generator-CA.crt">{de ? "Zertifikat herunterladen" : "Download certificate"}</a><code className="fingerprint">{info.certificate_fingerprint}</code></li>
        <li><strong>{de ? "Am Handy vertrauen" : "Trust it on your phone"}</strong><p>{de ? "iPhone: Einstellungen → Allgemein → VPN und Geräteverwaltung → geladenes Profil installieren. Dann unter Allgemein → Info → Zertifikatsvertrauenseinstellungen das volle Vertrauen aktivieren." : "iPhone: Settings → General → VPN & Device Management → install the downloaded profile. Then enable full trust in General → About → Certificate Trust Settings."}</p><p>{de ? "Android: In den Einstellungen nach „Zertifikat installieren“ suchen und das Zertifikat als CA-Zertifikat installieren. Menünamen unterscheiden sich je nach Gerät." : "Android: search Settings for “Install a certificate” and install it as a CA certificate. Menu names vary by device."}</p></li>
        <li><strong>{de ? "Sichere Web-App öffnen" : "Open the secure web app"}</strong><p>{de ? "Wechsle zurück zu diesem Browser. Der Zugangsschlüssel wird beim Öffnen übernommen." : "Return to this browser. Your access key will be carried over when you open the app."}</p>{link ? <a className="primary" href={link} rel="noreferrer">{de ? "HTTPS-Web-App öffnen" : "Open HTTPS web app"}</a> : <p className="muted">{de ? "Scanne den Web-App-QR-Code am Rechner erneut, um die passende Adresse zu öffnen." : "Scan the web-app QR code on your computer again to open the matching address."}</p>}</li>
      </ol>
      <label className="check"><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} />{t("remember")}</label>
      <p className="fine">{t("keyTip")}</p>
    </>}
  </section>;
}

export function App() {
  const [language, setLanguage] = useState<Language>(() => navigator.language.startsWith("de") ? "de" : "en");
  const [initial] = useState(() => {
    let storage: Storage | undefined;
    try { storage = window.localStorage; } catch { /* Memory-only pairing remains available. */ }
    return readConnection(window.location, window.history, storage);
  });
  const [token, setToken] = useState(initial.token);
  const [remember, setRemember] = useState(initial.remembered);
  const [keyDraft, setKeyDraft] = useState("");
  const [authMessage, setAuthMessage] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [page, setPage] = useState<"library" | "create">("library");
  const [search, setSearch] = useState(""), [folder, setFolder] = useState(""), [favorites, setFavorites] = useState(false);
  const [songs, setSongs] = useState<Song[]>([]), [folders, setFolders] = useState<FolderList>(noFolders), [queue, setQueue] = useState<Queue | null>(null);
  const [loading, setLoading] = useState(true), [failure, setFailure] = useState<string | null>(null), [revision, setRevision] = useState(0), [action, setAction] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [toast, setToast] = useState<Message | null>(null);
  const audio = useRef<HTMLAudioElement>(null), mediaUrl = useRef<string | null>(null);
  const [playing, setPlaying] = useState<Song | null>(null);
  const downloadUrls = useRef(new Set<string>());
  const t = useCallback((key: Message) => messages[language][key], [language]);
  const secure = window.isSecureContext;
  const clearMedia = useCallback(() => {
    releaseMedia(audio.current, mediaUrl.current); mediaUrl.current = null; setPlaying(null);
    for (const url of downloadUrls.current) URL.revokeObjectURL(url);
    downloadUrls.current.clear();
  }, []);
  const disconnect = useCallback((expired = false) => {
    setToken(""); setKeyDraft(""); setAuthMessage(expired); setSongs([]); setFolders(noFolders); setQueue(null); clearMedia();
    try { rememberConnection("", false, window.localStorage); } catch { /* Storage is optional. */ }
    setRemember(false);
  }, [clearMedia]);
  const api = useMemo(() => new RemoteApi(token, language, () => disconnect(true)), [token, language, disconnect]);
  useEffect(() => () => api.close(), [api]);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  useEffect(() => {
    try { setStorageError(!rememberConnection(token, remember, window.localStorage) && remember); } catch { setStorageError(remember); }
  }, [token, remember]);
  useEffect(() => () => clearMedia(), [clearMedia]);
  useEffect(() => {
    if (!secure || !token) return;
    let active = true, pending = false;
    const refresh = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const query = new URLSearchParams({ q: search, folder, favorites: String(favorites) });
        const [nextSongs, nextFolders, nextQueue] = await Promise.all([
          api.json<Song[]>(`/api/songs?${query}`), api.json<FolderList>("/api/folders"), api.json<Queue>("/api/queue"),
        ]);
        if (active) { setSongs(nextSongs); setFolders(nextFolders); setQueue(nextQueue); setFailure(null); setLoading(false); }
      } catch (error) { if (active && !isAborted(error) && !(error instanceof AuthenticationError)) { setFailure(error instanceof TypeError ? t("unavailable") : String(error instanceof Error ? error.message : error)); setLoading(false); } }
      finally { pending = false; }
    };
    setLoading(true);
    const debounce = setTimeout(() => void refresh(), search ? 250 : 0);
    const interval = setInterval(() => void refresh(), 5000);
    const visible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", visible);
    return () => { active = false; clearTimeout(debounce); clearInterval(interval); document.removeEventListener("visibilitychange", visible); window.removeEventListener("online", visible); };
  }, [api, token, secure, search, folder, favorites, revision, t]);
  useEffect(() => {
    const offer = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPrompt); };
    window.addEventListener("beforeinstallprompt", offer);
    if (secure && "serviceWorker" in navigator) void navigator.serviceWorker.register("/mobile/sw.js", { scope: "/mobile/" }).catch(() => {});
    return () => window.removeEventListener("beforeinstallprompt", offer);
  }, [secure]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 5000); return () => clearTimeout(timer); }, [toast]);

  async function run(id: string, work: () => Promise<void>) {
    if (action) return;
    setAction(id); setFailure(null);
    try { await work(); } catch (error) { if (!isAborted(error) && !(error instanceof AuthenticationError)) setFailure(error instanceof Error ? error.message : String(error)); }
    finally { setAction(null); }
  }
  async function play(song: Song) {
    await run(`play-${song.id}`, async () => {
      const { blob } = await api.blob(`/api/songs/${encodeURIComponent(song.id)}/audio`);
      clearMedia(); mediaUrl.current = URL.createObjectURL(blob); setPlaying(song);
    });
  }
  useEffect(() => {
    if (!playing || !audio.current || !mediaUrl.current) return;
    audio.current.src = mediaUrl.current;
    void audio.current.play().catch(() => { /* Native controls remain available when autoplay is denied. */ });
  }, [playing]);
  async function download(song: Song) {
    await run(`download-${song.id}`, async () => {
      const { blob, filename } = await api.blob(`/api/songs/${encodeURIComponent(song.id)}/audio?download=true`);
      const url = URL.createObjectURL(blob); downloadUrls.current.add(url);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename || `${song.title || "song"}.wav`; document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.current.delete(url); }, 30000);
      setToast("downloadReady");
    });
  }
  async function favorite(song: Song) {
    await run(`favorite-${song.id}`, async () => { await api.write(`/api/songs/${encodeURIComponent(song.id)}`, "PATCH", { favorite: !song.favorite }); setRevision(value => value + 1); });
  }
  const main = !token ? <section className="panel connect-panel">
    <div className="panel-icon"><Icon name="key" /></div><p className="eyebrow">MUSIC GENERATOR</p><h1>{t("noConnection")}</h1><p className="muted">{t("pair")}</p>
    {authMessage && <Failure t={t}>{t("expired")}</Failure>}
    <form onSubmit={event => { event.preventDefault(); if (!keyDraft.trim()) return; setToken(keyDraft.trim()); setAuthMessage(false); setKeyDraft(""); }}>
      <Field title={t("key")}><input type="password" autoComplete="off" required value={keyDraft} onChange={event => setKeyDraft(event.target.value)} /></Field>
      <label className="check"><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} />{t("remember")}</label>
      <button className="primary wide" type="submit">{t("connect")} <span aria-hidden="true">→</span></button>
    </form><p className="fine">{t("keyTip")}</p>
  </section> : !secure ? <SecureSetup t={t} token={token} remember={remember} setRemember={setRemember} language={language} /> : <>
    <section className="queue-strip" aria-label={t("queue")}>
      <span className={`status-dot ${!queue ? "pending" : queue.active ? "active" : ""}`} />
      <div aria-live="polite"><strong>{!queue ? t("loading") : queue.active ? t("working") : t("idle")}</strong>{queue && <small>{queue.running[0]?.message || (queue.queued ? `${queue.queued} ${t("queued")}` : t("connected"))}</small>}</div>
      <button className="icon-button" type="button" aria-label={t("update")} onClick={() => setRevision(value => value + 1)}><Icon name="refresh" /></button>
    </section>
    {failure && <Failure t={t} retry={() => setRevision(value => value + 1)}>{failure}</Failure>}
    <section hidden={page !== "library"} aria-labelledby="library-heading">
      <div className="section-heading"><div><p className="eyebrow">MUSIC GENERATOR</p><h1 id="library-heading">{t("library")}</h1></div><span className="count">{folders.all}</span></div>
      <div className="filters"><input className="search" type="search" aria-label={t("search")} placeholder={t("search")} value={search} onChange={event => setSearch(event.target.value)} /><button className={`favorite-filter ${favorites ? "selected" : ""}`} type="button" aria-label={t("favorites")} aria-pressed={favorites} onClick={() => setFavorites(value => !value)}>★</button></div>
      <div className="folder-bar"><select aria-label={t("folder")} value={folder} onChange={event => setFolder(event.target.value)}><option value="">{t("all")}</option><option value="none">{t("unsorted")}</option>{folders.folders.map(item => <option key={item.id} value={item.id}>{item.name} · {item.count}</option>)}</select><NewFolder api={api} t={t} disabled={Boolean(action)} onCreated={() => setRevision(value => value + 1)} onError={setFailure} /></div>
      {loading && <p className="muted" role="status">{t("loading")}</p>}
      {!loading && !songs.length && <div className="empty"><div className="empty-icon"><Icon name="music" /></div><h2>{t("noSongs")}</h2><p>{t("noSongsHint")}</p><button className="secondary" type="button" onClick={() => setPage("create")}>{t("create")} <span aria-hidden="true">→</span></button></div>}
      <div className="song-list">{songs.map((song, index) => <article className="song-card" key={song.id}>
        <div className={`song-art art-${index % 4}`}><Icon name="music" /></div><div className="song-body"><h2>{song.title || song.caption || "Song"}</h2><p className="song-meta">{song.status === "done" ? duration(song) : t(song.status === "queued" ? "queue" : song.status === "running" ? "running" : song.status === "cancelled" ? "cancelled" : "error")}{song.result_meta?.bpm ? ` · ${song.result_meta.bpm} BPM` : ""}</p>{song.status === "error" && song.message && <p className="song-error">{song.message}</p>}</div>
        <button className={`icon-button star ${song.favorite ? "selected" : ""}`} type="button" aria-label={`${t("favorite")}: ${song.title || "Song"}`} aria-pressed={song.favorite} disabled={Boolean(action)} onClick={() => void favorite(song)}>★</button>
        <div className="song-actions"><select aria-label={`${t("move")}: ${song.title || "Song"}`} value={song.folder_id || ""} disabled={Boolean(action)} onChange={event => { const value = event.target.value; void run(`move-${song.id}`, async () => { await api.write(`/api/songs/${encodeURIComponent(song.id)}`, "PATCH", { folder_id: value || null }); setRevision(current => current + 1); }); }}><option value="">{t("unsorted")}</option>{folders.folders.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{song.status === "done" && song.url && <><button className="secondary small-button" type="button" disabled={Boolean(action)} onClick={() => void download(song)} aria-label={`${t("download")}: ${song.title || "Song"}`}><Icon name="download" /></button><button className="primary small-button" type="button" disabled={Boolean(action)} onClick={() => void play(song)} aria-label={`${t("play")}: ${song.title || "Song"}`}><Icon name="play" /></button></>}</div>
      </article>)}</div>
    </section><div hidden={page !== "create"}><CreateForm api={api} folders={folders.folders} t={t} onQueued={() => { setToast("sent"); setRevision(value => value + 1); }} /></div>
    <details className="connection-details"><summary>{t("connection")}</summary><p className="fine">{window.location.host}</p><label className="check"><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} />{t("remember")}</label><p className="fine">{t("keyTip")}</p>{storageError && <p className="fine" role="status">{t("storageDenied")}</p>}<button className="secondary" type="button" onClick={() => disconnect()}>{t("disconnect")}</button></details>
    <details className="install-details"><summary>{t("installTitle")}</summary><p className="fine">{t("installIos")}</p>{installPrompt && <button className="secondary" type="button" onClick={() => { void installPrompt.prompt().then(() => installPrompt.userChoice).finally(() => setInstallPrompt(null)); }}>{t("install")}</button>}</details>
    <nav className="bottom-nav" aria-label="Music Generator"><button className={page === "library" ? "selected" : ""} type="button" aria-current={page === "library" ? "page" : undefined} onClick={() => setPage("library")}><Icon name="library" />{t("library")}</button><button className={page === "create" ? "selected" : ""} type="button" aria-current={page === "create" ? "page" : undefined} onClick={() => setPage("create")}><Icon name="create" />{t("create")}</button></nav>
  </>;
  return <><header className="app-header"><a className="brand" href="/mobile/" onClick={event => { event.preventDefault(); setPage("library"); }} aria-label="Music Generator"><span className="brand-icon"><Icon name="music" /></span><span>MUSIC<span className="brand-bottom">GENERATOR <small>{t("remote")}</small></span></span></a><select className="language" aria-label={t("language")} value={language} onChange={event => setLanguage(event.target.value as Language)}><option value="de">DE</option><option value="en">EN</option></select></header><main className={`main ${playing ? "has-player" : ""}`}>{main}</main>{toast && <p className="toast" role="status">{t(toast)}</p>}{playing && <aside className="player" aria-label={t("playing")}><div className="player-title"><span><small>{t("playing")}</small><strong>{playing.title || playing.caption || "Song"}</strong></span><button className="icon-button" type="button" aria-label={t("closePlayer")} onClick={clearMedia}><Icon name="close" /></button></div><audio ref={audio} controls preload="metadata" /></aside>}</>;
}

function NewFolder({ api, t, disabled, onCreated, onError }: { api: RemoteApi; t: Translate; disabled: boolean; onCreated: () => void; onError: (value: string) => void }) {
  const [open, setOpen] = useState(false), [name, setName] = useState(""), [pending, setPending] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (pending || !name.trim()) return;
    setPending(true);
    try { await api.write("/api/folders", "POST", { name: name.trim() }); setOpen(false); setName(""); onCreated(); }
    catch (error) { if (!isAborted(error) && !(error instanceof AuthenticationError)) onError(error instanceof Error ? error.message : String(error)); }
    finally { setPending(false); }
  }
  return <><button className="icon-button" type="button" disabled={disabled} aria-label={t("newFolder")} onClick={() => setOpen(value => !value)}>+</button>{open && <form className="new-folder" onSubmit={event => void submit(event)}><input aria-label={t("folderName")} autoFocus value={name} onChange={event => setName(event.target.value)} maxLength={100} required /><button className="secondary" disabled={pending} type="submit">{t("save")}</button><button className="icon-button" type="button" aria-label={t("cancel")} onClick={() => setOpen(false)}>×</button></form>}</>;
}

function CreateForm({ api, folders, t, onQueued }: { api: RemoteApi; folders: Folder[]; t: Translate; onQueued: () => void }) {
  const [pending, setPending] = useState(false), [analyzing, setAnalyzing] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState(false);
  const [draft, setDraft] = useState({ title: "", prompt: "", style: "", lyrics: "", instrumental: true, duration: 90, bpm: 0, variants: 1, folder_id: "" });
  const file = useRef<HTMLInputElement>(null);
  async function generate(event: FormEvent) {
    event.preventDefault(); if (pending || analyzing) return;
    setPending(true); setError(null); setNotice(false);
    try { await api.write("/api/generate", "POST", { ...draft, folder_id: draft.folder_id || null, keep_caption: true }); onQueued(); }
    catch (reason) { if (!isAborted(reason) && !(reason instanceof AuthenticationError)) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setPending(false); }
  }
  async function analyze(value?: File) {
    if (!value || analyzing || pending) return;
    setError(null); setNotice(false);
    if (value.size > 60 * 1024 * 1024) { setError(t("fileTooLarge")); return; }
    if (!/\.(wav|mp3|flac|m4a|ogg)$/i.test(value.name)) { setError(t("fileType")); return; }
    setAnalyzing(true);
    try {
      const body = new FormData(); body.append("audio", value);
      const result = await api.json<{ caption?: string; lyrics?: string; bpm?: number }>("/api/analyze", { method: "POST", body });
      setDraft(current => ({ ...current, prompt: result.caption || current.prompt, lyrics: result.lyrics || current.lyrics, instrumental: result.lyrics ? false : current.instrumental, bpm: Number(result.bpm) || current.bpm })); setNotice(true);
    } catch (reason) { if (!isAborted(reason) && !(reason instanceof AuthenticationError)) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setAnalyzing(false); if (file.current) file.current.value = ""; }
  }
  return <section aria-labelledby="create-heading"><div className="section-heading"><div><p className="eyebrow">MAKE SOMETHING YOURS</p><h1 id="create-heading">{t("create")}</h1></div><span className="count"><Icon name="create" /></span></div><form className="panel create-form" onSubmit={event => void generate(event)}>
    <fieldset disabled={pending || analyzing}><Field title={t("title")}><input value={draft.title} placeholder={t("titleHint")} onChange={event => setDraft(value => ({ ...value, title: event.target.value }))} /></Field><Field title={t("prompt")}><textarea rows={3} value={draft.prompt} placeholder={t("promptHint")} onChange={event => setDraft(value => ({ ...value, prompt: event.target.value }))} /></Field><Field title={t("style")}><input value={draft.style} placeholder={t("styleHint")} onChange={event => setDraft(value => ({ ...value, style: event.target.value }))} /></Field><label className="check"><input type="checkbox" checked={draft.instrumental} onChange={event => setDraft(value => ({ ...value, instrumental: event.target.checked }))} />{t("instrumental")}</label>{!draft.instrumental && <Field title={t("lyrics")}><textarea rows={4} value={draft.lyrics} onChange={event => setDraft(value => ({ ...value, lyrics: event.target.value }))} /></Field>}<div className="field-grid"><Field title={t("duration")}><input type="number" min={10} max={600} required value={draft.duration} onChange={event => setDraft(value => ({ ...value, duration: Number(event.target.value) }))} /></Field><Field title={t("bpm")}><input type="number" min={0} max={300} required value={draft.bpm} onChange={event => setDraft(value => ({ ...value, bpm: Number(event.target.value) }))} /></Field><Field title={t("variants")}><input type="number" min={1} max={8} required value={draft.variants} onChange={event => setDraft(value => ({ ...value, variants: Number(event.target.value) }))} /></Field><Field title={t("folder")}><select value={draft.folder_id} onChange={event => setDraft(value => ({ ...value, folder_id: event.target.value }))}><option value="">{t("unsorted")}</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></Field></div><details className="analyze-details"><summary>{t("analyze")}</summary><p className="fine">{t("analyzeHint")}</p><input ref={file} type="file" accept=".wav,.mp3,.flac,.m4a,.ogg,audio/*" aria-label={t("analyze")} onChange={event => void analyze(event.target.files?.[0])} /></details><button className="primary wide generate" type="submit" disabled={pending || analyzing}>{pending ? t("loading") : analyzing ? t("analyzeBusy") : t("generate")}<Icon name="create" /></button></fieldset><p className="fine">{t("generateHint")}</p>{notice && <p className="notice" role="status">{t("analyzed")}</p>}{error && <Failure t={t}>{error}</Failure>}
  </form></section>;
}
