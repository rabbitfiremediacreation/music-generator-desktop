import { MobileStems } from "./Stems";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { audioFormats, orderedAudioFormats, type AudioFormat } from "../audio-formats";
import { DownloadFormatMenu } from "../DownloadFormatMenu";
import { DEFAULT_CLIP_BPM, MAX_CLIP_BPM, MAX_EXTENDED_DURATION, boundedDuration, clipSeconds, supportsExtendedDuration } from "../generation-limits";
import { GenerationProgress, WaveLogo } from "../GenerationActivity";
import { Switch } from "../Switch";
import { progressText } from "../progress";
import { analyzedYue2Style } from "../style-tags";
import type { ActiveGenerationProfile, Folder, Generation, Queue, Yue2Options } from "../types";
import { Yue2Fields, yue2OptionsError } from "../yue2/Yue2Fields";
import { yue2ErrorText, yue2Text } from "../yue2/messages";
import { AuthenticationError, pairingToken, readConnection, rememberConnection, releaseMedia, RemoteApi, type FolderList, type SongCard } from "./client";
import { QrScanner } from "./QrScanner";
import { generationPhases, messages, type Language, type Message } from "./messages";
import "./mobile.css";

interface InstallPrompt extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
interface ConnectionInfo { secure_addresses: string[]; certificate_url: string; certificate_profile_url?: string; certificate_fingerprint: string }
type Translate = (key: Message) => string;
const noFolders: FolderList = { folders: [], all: 0, none: 0 };
const duration = (seconds: number | null) => {
  if (!seconds) return "";
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
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
function Field({ title, children, hint }: { title: string; children: ReactNode; hint?: { id: string; text: string } }) {
  const label = <label className="field"><span>{title}</span>{children}</label>;
  return hint ? <div className="field-with-hint">{label}<small className="fine" id={hint.id}>{hint.text}</small></div> : label;
}
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
      {link && <div className="secure-shortcut"><a className="primary wide" href={link} rel="noreferrer">{de ? "HTTPS-Web-App öffnen" : "Open HTTPS web app"}<span aria-hidden="true">→</span></a><p className="fine">{de ? "Schon vertraut? Direkt öffnen. Beim ersten Mal die Schritte darunter abschließen." : "Already trusted? Open it directly. For a first connection, complete the steps below."}</p></div>}
      <ol className="setup-steps">
        <li><strong>{de ? "Zertifikat für dein Handy laden" : "Download the certificate for your phone"}</strong><p>{de ? "Vergleiche zuerst den SHA-256-Fingerabdruck mit dem Wert in den Desktop-Einstellungen." : "First compare the SHA-256 fingerprint with the value in your desktop settings."}</p><code className="fingerprint">{info.certificate_fingerprint}</code><div className="certificate-buttons"><a className="primary" href="/mobile-ca.mobileconfig">{de ? "iPhone: Profil installieren" : "iPhone: install profile"}</a><a className="secondary" href="/mobile-ca.crt" download="Music-Generator-CA.crt">{de ? "Android: Zertifikat laden" : "Android: download certificate"}</a></div></li>
        <li><strong>{de ? "Einmalig dem Rechner vertrauen" : "Trust this computer once"}</strong><p>{de ? "iPhone: Öffne den Link in Safari und erlaube das geladene Profil. Dann Einstellungen → Allgemein → VPN und Geräteverwaltung → Music Generator → Installieren." : "iPhone: open the link in Safari and allow the profile download. Then Settings → General → VPN & Device Management → Music Generator → Install."}</p><p>{de ? "Aktiviere anschließend unter Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen das volle Vertrauen für Music Generator." : "Then enable full trust for Music Generator in Settings → General → About → Certificate Trust Settings."}</p><details><summary>{de ? "Android-Anleitung" : "Android instructions"}</summary><p>{de ? "Suche in den Einstellungen nach „Zertifikat installieren“ und installiere die geladene Datei als CA-Zertifikat. Menünamen unterscheiden sich je nach Gerät." : "Search Settings for “Install a certificate” and install the downloaded file as a CA certificate. Menu names vary by device."}</p></details></li>
        <li><strong>{de ? "Zur sicheren Web-App wechseln" : "Continue to the secure web app"}</strong><p>{de ? "Kehre hierher zurück und öffne den folgenden Link. Dein Schlüssel ist enthalten und wird am Handy gemerkt. In der sicheren Web-App kannst du sie zum Home-Bildschirm hinzufügen." : "Return here and open the link below. It includes your key and remembers it on this phone. You can then add the secure web app to your home screen."}</p>{!link && <p className="muted">{de ? "Scanne den Web-App-QR-Code am Rechner erneut, um die passende Adresse zu öffnen." : "Scan the web-app QR code on your computer again to open the matching address."}</p>}</li>
      </ol>
      <Switch label={t("remember")} checked={remember} onChange={event => setRemember(event.target.checked)} />
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
  const [loginError, setLoginError] = useState(false);
  const [authMessage, setAuthMessage] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [page, setPage] = useState<"library" | "create" | "stems">("library");
  const [stemSong, setStemSong] = useState<SongCard>();
  const [search, setSearch] = useState(""), [folder, setFolder] = useState(""), [favorites, setFavorites] = useState(false);
  const [songs, setSongs] = useState<SongCard[]>([]), [folders, setFolders] = useState<FolderList>(noFolders), [queue, setQueue] = useState<Queue | null>(null);
  const libraryValidator = useRef<{ api: RemoteApi; query: string; etag?: string } | null>(null);
  const [loading, setLoading] = useState(true), [failure, setFailure] = useState<string | null>(null), [revision, setRevision] = useState(0), [action, setAction] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [toast, setToast] = useState<Message | null>(null);
  const audio = useRef<HTMLAudioElement>(null), mediaUrl = useRef<string | null>(null);
  const [playing, setPlaying] = useState<SongCard | null>(null);
  const downloadUrls = useRef(new Set<string>());
  const t = useCallback((key: Message) => messages[language][key], [language]);
  const secure = window.isSecureContext;
  const clearMedia = useCallback(() => {
    releaseMedia(audio.current, mediaUrl.current); mediaUrl.current = null; setPlaying(null);
    for (const url of downloadUrls.current) URL.revokeObjectURL(url);
    downloadUrls.current.clear();
  }, []);
  const disconnect = useCallback((expired = false) => {
    libraryValidator.current = null;
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
    const query = new URLSearchParams({ q: search, folder, favorites: String(favorites) }).toString();
    const refresh = async () => {
      if (pending || document.hidden) return;
      pending = true;
      const current = libraryValidator.current;
      const etag = current?.api === api && current.query === query ? current.etag : undefined;
      const [library, nextQueue] = await Promise.allSettled([api.library(query, etag), api.json<Queue>("/api/queue")]);
      pending = false;
      if (!active) return;
      if (library.status === "fulfilled" && library.value) {
        libraryValidator.current = { api, query, etag: library.value.etag };
        setSongs(library.value.data.songs);
        setFolders(library.value.data.folders);
      }
      if (nextQueue.status === "fulfilled") setQueue(nextQueue.value);
      const failed = [library, nextQueue].find(result => result.status === "rejected");
      if (!failed) setFailure(null);
      else {
        const error: unknown = failed.reason;
        if (!isAborted(error) && !(error instanceof AuthenticationError)) {
          setFailure(error instanceof TypeError ? t("unavailable") : String(error instanceof Error ? error.message : error));
        }
      }
      setLoading(false);
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
  function openStems(song?: SongCard) {
    clearMedia();
    setStemSong(song);
    setPage("stems");
  }
  const stemTitle = language === "de" ? "Spurprojekte" : "Stem projects";
  async function play(song: SongCard) {
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
  async function download(song: SongCard, format?: AudioFormat) {
    await run(`download-${song.id}`, async () => {
      const midi = song.output_kind === "midi";
      const endpoint = midi ? "midi" : format ? `audio?download=true&format=${format}` : "audio?download=true";
      const extension = midi ? "mid" : (format && audioFormats[format].extension) || "wav";
      const { blob, filename } = await api.blob(`/api/songs/${encodeURIComponent(song.id)}/${endpoint}`);
      const url = URL.createObjectURL(blob); downloadUrls.current.add(url);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename || `${song.title || "song"}.${extension}`; document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.current.delete(url); }, 30000);
      setToast("downloadReady");
    });
  }
  async function favorite(song: SongCard) {
    await run(`favorite-${song.id}`, async () => { await api.write(`/api/songs/${encodeURIComponent(song.id)}`, "PATCH", { favorite: !song.favorite }); setRevision(value => value + 1); });
  }
  async function cancelSong(song: SongCard) {
    await run(`cancel-${song.id}`, async () => { await api.write(`/api/songs/${encodeURIComponent(song.id)}/cancel`, "POST", {}); setRevision(value => value + 1); });
  }
  const running = token && secure ? queue?.running?.[0] : undefined;
  const downloadFormats = orderedAudioFormats(queue?.audio_export?.default_format, queue?.audio_export?.formats);
  const progress = running && queue?.progress?.job_id === running.id ? queue.progress : undefined;
  const runningDetails = progress ? progressText(progress, () => generationPhases[language][progress.phase]) : running?.message || t("running");
  const main = !token ? <section className="panel connect-panel">
    <div className="panel-icon"><Icon name="key" /></div><p className="eyebrow">MUSIC GENERATOR</p><h1>{t("noConnection")}</h1><p className="muted">{t("pair")}</p>
    {authMessage && <Failure t={t}>{t("expired")}</Failure>}
    <QrScanner t={t} onToken={value => { setToken(value); setRemember(true); setAuthMessage(false); setLoginError(false); setKeyDraft(""); }} />
    <p className="fine">{t("scanRemember")}</p>
    {loginError && <Failure t={t}>{t("scanInvalid")}</Failure>}
    <form onSubmit={event => { event.preventDefault(); const value = keyDraft.trim(); if (!value) return; const paired = pairingToken(value); if (value.includes("://") && !paired) { setLoginError(true); return; } setToken(paired || value); if (paired) setRemember(true); setAuthMessage(false); setLoginError(false); setKeyDraft(""); }}>
      <Field title={t("key")}><input type="password" autoComplete="off" required value={keyDraft} placeholder={t("scanLink")} onChange={event => setKeyDraft(event.target.value)} /></Field>
      <Switch label={t("remember")} checked={remember} onChange={event => setRemember(event.target.checked)} />
      <button className="primary wide" type="submit">{t("connect")} <span aria-hidden="true">→</span></button>
    </form><p className="fine">{t("keyTip")}</p>
  </section> : !secure ? <SecureSetup t={t} token={token} remember={remember} setRemember={setRemember} language={language} /> : <>
    <section className={`queue-strip${running ? " is-generating" : ""}`} aria-label={t("queue")}>
      {running ? <GenerationProgress className="mobile-queue-progress" label={t("progress")} progress={progress} details={runningDetails} remainingLabel={t("remainingTime")} /> : <>
        <span className={`status-dot ${!queue ? "pending" : queue.active ? "active" : ""}`} />
        <div aria-live="polite"><strong>{!queue ? t("loading") : queue.active ? t("working") : t("idle")}</strong>{queue && <small>{queue.queued ? `${queue.queued} ${t("queued")}` : t("connected")}</small>}</div>
      </>}
      <button className="icon-button" type="button" aria-label={t("update")} onClick={() => setRevision(value => value + 1)}><Icon name="refresh" /></button>
    </section>
    {failure && <Failure t={t} retry={() => setRevision(value => value + 1)}>{failure}</Failure>}
    <section hidden={page !== "library"} aria-labelledby="library-heading">
      <div className="section-heading"><div><p className="eyebrow">MUSIC GENERATOR</p><h1 id="library-heading">{t("library")}</h1></div><button type="button" className="secondary" onClick={() => openStems()}>{stemTitle}</button><span className="count">{folders.all}</span></div>
      <div className="filters"><input className="search" type="search" aria-label={t("search")} placeholder={t("search")} value={search} onChange={event => setSearch(event.target.value)} /><button className={`favorite-filter ${favorites ? "selected" : ""}`} type="button" aria-label={t("favorites")} aria-pressed={favorites} onClick={() => setFavorites(value => !value)}>★</button></div>
      <div className="folder-bar"><select aria-label={t("folder")} value={folder} onChange={event => setFolder(event.target.value)}><option value="">{t("all")}</option><option value="none">{t("unsorted")}</option>{folders.folders.map(item => <option key={item.id} value={item.id}>{item.name} · {item.count}</option>)}</select><NewFolder api={api} t={t} disabled={Boolean(action)} onCreated={() => setRevision(value => value + 1)} onError={setFailure} /></div>
      {loading && <p className="muted" role="status">{t("loading")}</p>}
      {!loading && !songs.length && <div className="empty"><div className="empty-icon"><Icon name="music" /></div><h2>{t("noSongs")}</h2><p>{t("noSongsHint")}</p><button className="secondary" type="button" onClick={() => setPage("create")}>{t("create")} <span aria-hidden="true">→</span></button></div>}
      <div className="song-list">{songs.map((song, index) => <article className="song-card" key={song.id}>
        <div className={`song-art art-${index % 4}`}>{song.status === "running" ? <WaveLogo active /> : <Icon name="music" />}</div><div className="song-body"><h2>{song.title}</h2>
          {song.status === "running" ? <GenerationProgress wave={false} className="mobile-song-progress" label={`${t("progress")} · ${song.title}`}
            progress={running?.id === song.id ? progress : undefined} details={running?.id === song.id ? runningDetails : song.message || t("running")}
            remainingLabel={t("remainingTime")} />
            : <p className="song-meta">{song.status === "done" ? song.output_kind === "midi" ? "MIDI (.mid)" : duration(song.duration) : t(song.status === "queued" ? "queue" : song.status === "cancelled" ? "cancelled" : "error")}{song.bpm ? ` · ${song.bpm} BPM` : ""}</p>}
          {song.status === "error" && song.message && <p className="song-error">{song.message}</p>}</div>
        <button className={`icon-button star ${song.favorite ? "selected" : ""}`} type="button" aria-label={`${t("favorite")}: ${song.title}`} aria-pressed={song.favorite} disabled={Boolean(action)} onClick={() => void favorite(song)}>★</button>
        <div className="song-actions"><select aria-label={`${t("move")}: ${song.title}`} value={song.folder_id || ""} disabled={Boolean(action)} onChange={event => { const value = event.target.value; void run(`move-${song.id}`, async () => { await api.write(`/api/songs/${encodeURIComponent(song.id)}`, "PATCH", { folder_id: value || null }); setRevision(current => current + 1); }); }}><option value="">{t("unsorted")}</option>{folders.folders.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          {song.output_kind === "midi"
            ? song.has_midi && <button className="secondary small-button" type="button" disabled={Boolean(action)}
                onClick={() => void download(song)} aria-label={`${t("midiDownload")}: ${song.title}`}><Icon name="download" /></button>
            : song.has_audio && <DownloadFormatMenu formats={downloadFormats} label={`${t("download")}: ${song.title}`} menuLabel={t("downloadFormat")}
                originalLabel={t("downloadOriginal")} language={language} className="secondary small-button" disabled={Boolean(action)}
                onChoose={format => void download(song, format)}><Icon name="download" /></DownloadFormatMenu>}
          {song.has_audio && song.output_kind !== "midi" && <button className="primary small-button" type="button" disabled={Boolean(action)} onClick={() => void play(song)} aria-label={`${t("play")}: ${song.title}`}><Icon name="play" /></button>}
          {song.has_audio && song.output_kind !== "midi" && <button type="button" className="secondary" onClick={() => openStems(song)}>{stemTitle}</button>}
          {(song.status === "queued" || song.status === "running") && <button className="secondary" type="button" disabled={Boolean(action)} onClick={() => void cancelSong(song)} aria-label={`${t("cancel")}: ${song.title}`}>{t("cancel")}</button>}
        </div>
      </article>)}</div>
    </section><div hidden={page !== "create"}><CreateForm active={page === "create"} api={api} folders={folders.folders} language={language} t={t} onQueued={() => { setToast("sent"); setRevision(value => value + 1); }} /></div>
    {page === "stems" && <MobileStems api={api} song={stemSong} language={language} exit={() => setPage("library")} />}
    <details className="connection-details"><summary>{t("connection")}</summary><p className="fine">{window.location.host}</p>
      <Switch label={t("remember")} checked={remember} onChange={event => setRemember(event.target.checked)} />
      <p className="fine">{t("keyTip")}</p>{storageError && <p className="fine" role="status">{t("storageDenied")}</p>}<button className="secondary" type="button" onClick={() => disconnect()}>{t("disconnect")}</button>
    </details>
    <details className="install-details"><summary>{t("installTitle")}</summary><p className="fine">{t("installIos")}</p>{installPrompt && <button className="secondary" type="button" onClick={() => { void installPrompt.prompt().then(() => installPrompt.userChoice).finally(() => setInstallPrompt(null)); }}>{t("install")}</button>}</details>
    <nav className="bottom-nav" aria-label="Music Generator"><button className={page === "library" ? "selected" : ""} type="button" aria-current={page === "library" ? "page" : undefined} onClick={() => setPage("library")}><Icon name="library" />{t("library")}</button><button className={page === "create" ? "selected" : ""} type="button" aria-current={page === "create" ? "page" : undefined} onClick={() => setPage("create")}><Icon name="create" />{t("create")}</button></nav>
  </>;
  return <><header className="app-header"><a className="brand" href="/mobile/" onClick={event => { event.preventDefault(); setPage("library"); }} aria-label="Music Generator"><WaveLogo className="brand-wave" active={Boolean(running)} /><span>MUSIC<span className="brand-bottom">GENERATOR <small>{t("remote")}</small></span></span></a><select className="language" aria-label={t("language")} value={language} onChange={event => setLanguage(event.target.value as Language)}><option value="de">DE</option><option value="en">EN</option></select></header><main className={`main ${playing ? "has-player" : ""}`}>{main}</main>{toast && <p className="toast" role="status">{t(toast)}</p>}{playing && <aside className="player" aria-label={t("playing")}><div className="player-title"><span><small>{t("playing")}</small><strong>{playing.title}</strong></span><button className="icon-button" type="button" aria-label={t("closePlayer")} onClick={clearMedia}><Icon name="close" /></button></div><audio ref={audio} controls preload="metadata" /></aside>}</>;
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

function CreateForm({ active, api, folders, language, t, onQueued }: { active: boolean; api: RemoteApi; folders: Folder[]; language: Language; t: Translate; onQueued: () => void }) {
  const [pending, setPending] = useState(false), [analyzing, setAnalyzing] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState(false);
  const [draft, setDraft] = useState({ title: "", prompt: "", style: "", lyrics: "", instrumental: true, duration: "90", bpm: 0, variants: 1, folder_id: "", seed: "" });
  const [yue2Options, setYue2Options] = useState<Yue2Options>({});
  const [yue2Variants, setYue2Variants] = useState(1);
  const [meter, setMeter] = useState({ bars: 1, tempo: DEFAULT_CLIP_BPM });
  const [extendedProfile, setExtendedProfile] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<{ api: RemoteApi; profile: ActiveGenerationProfile }>();
  const [profileError, setProfileError] = useState<string | null>(null), [refresh, setRefresh] = useState(0);
  const profile = snapshot?.api === api ? snapshot.profile : undefined;
  const abilities = profile?.capabilities;
  const canAnalyze = profile?.analysis_available ?? abilities?.analysis;
  const yue2 = abilities?.yue2_options === true;
  const profileKey = profile ? JSON.stringify(profile.selection) : "";
  const canExtend = abilities && supportsExtendedDuration(abilities);
  const extendedDuration = canExtend && extendedProfile === profileKey;
  const midi = abilities?.output_kind === "midi";
  const barOptions = abilities?.bars?.length ? abilities.bars : undefined;
  const promptHint = { id: "remote-prompt-hint", text: t(midi || barOptions ? "promptStyleSingleHint" : "promptStyleCombinedHint") };
  const styleHint = { id: "remote-style-hint", text: t(abilities?.style_description ? "styleDescriptionHint" : "styleTagsHint") };
  const bars = barOptions?.find(count => count === meter.bars) ?? barOptions?.[0];
  const clipDuration = bars === undefined ? undefined : clipSeconds(bars, meter.tempo);
  const clipTooLong = clipDuration !== undefined && abilities !== undefined && clipDuration > abilities.max_duration;
  const maxVariants = Math.min(8, abilities?.max_variants ?? 1);
  const variants = Math.min(maxVariants, yue2 ? yue2Variants : draft.variants);
  const instrumental = !abilities?.lyrics || (abilities.instrumental && draft.instrumental);
  const yue2Problem = yue2 ? yue2OptionsError(yue2Options, instrumental) : undefined;
  const incomplete = (midi && !draft.prompt.trim()) || (barOptions && (!draft.prompt.trim().replace(/^,+|,+$/g, "").trim() || clipDuration === undefined || clipTooLong)) ||
    (!abilities?.prompt && !draft.style.split(",").some(tag => tag.trim())) ||
    (abilities?.lyrics_required && !instrumental && (!draft.lyrics.trim() || /^\[instrumental\]$/i.test(draft.lyrics.trim())));
  const file = useRef<HTMLInputElement>(null);
  const durationBounds = useRef("");
  useEffect(() => {
    if (!active) return;
    let mounted = true, waiting = false;
    async function load() {
      if (waiting || document.hidden) return;
      waiting = true;
      try {
        const profile = await api.json<ActiveGenerationProfile>("/api/generation-profile");
        if (!mounted) return;
        const { min_duration, max_duration } = profile.capabilities;
        const bounds = `${JSON.stringify(profile.selection)}:${min_duration}:${max_duration}`;
        if (profile.capabilities.output_kind !== "midi" && !profile.capabilities.bars?.length && durationBounds.current !== bounds) {
          durationBounds.current = bounds;
          setDraft(draft => ({ ...draft, duration: String(boundedDuration(Number(draft.duration) || 90, profile.capabilities)) }));
        }
        setSnapshot({ api, profile });
        setProfileError(null);
      } catch (reason) {
        if (mounted && !isAborted(reason) && !(reason instanceof AuthenticationError)) setProfileError(reason instanceof Error ? reason.message : String(reason));
      } finally { waiting = false; }
    }
    void load();
    const interval = setInterval(() => void load(), 5000);
    const visible = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", visible);
    return () => { mounted = false; clearInterval(interval); document.removeEventListener("visibilitychange", visible); };
  }, [active, api, refresh]);
  async function generate(event: FormEvent) {
    event.preventDefault(); if (pending || analyzing || incomplete || yue2Problem || profileError || !profile?.available || !abilities || abilities.reference_audio) return;
    setPending(true); setError(null); setNotice(false);
    const request: Generation = {
      model_selection: profile.selection, title: draft.title,
      instrumental: abilities.instrumental && instrumental,
      variants,
      folder_id: draft.folder_id || null, keep_caption: true,
    };
    if (!midi) Object.assign(request, { lyrics: instrumental ? "" : draft.lyrics, duration: clipDuration ?? Number(draft.duration) });
    if (extendedDuration) request.ignore_recommended_duration = true;
    if (abilities.prompt) request.prompt = midi ? draft.prompt.trim() : draft.prompt;
    if (bars !== undefined) {
      request.bars = bars;
      request.bpm = Number(meter.tempo);
    } else if (!midi) {
      request.style = draft.style;
      if (abilities.bpm) request.bpm = draft.bpm;
    }
    if (!abilities.advanced) request.seed = draft.seed === "" ? -1 : Number(draft.seed);
    if (yue2 && Object.values(yue2Options).some(value => value !== undefined)) request.yue2 = yue2Options;
    try { await api.write("/api/generate", "POST", request); onQueued(); }
    catch (reason) { if (!isAborted(reason) && !(reason instanceof AuthenticationError)) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setPending(false); }
  }
  async function analyze(value?: File) {
    if (!value || !canAnalyze || analyzing || pending) return;
    setError(null); setNotice(false);
    if (value.size > 60 * 1024 * 1024) { setError(t("fileTooLarge")); return; }
    if (!/\.(wav|mp3|flac|m4a|ogg)$/i.test(value.name)) { setError(t("fileType")); return; }
    setAnalyzing(true);
    try {
      const body = new FormData(); body.append("audio", value);
      const result = await api.json<{ caption?: string; lyrics?: string; bpm?: number }>("/api/analyze", { method: "POST", body });
      setDraft(current => profile?.selection.provider === "yue2"
        ? { ...current, style: analyzedYue2Style(current.style, result) }
        : { ...current, prompt: result.caption || current.prompt, lyrics: result.lyrics || current.lyrics, instrumental: result.lyrics ? false : current.instrumental, bpm: Number(result.bpm) || current.bpm });
      setNotice(true);
    } catch (reason) { if (!isAborted(reason) && !(reason instanceof AuthenticationError)) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setAnalyzing(false); if (file.current) file.current.value = ""; }
  }
  return <section aria-labelledby="create-heading"><div className="section-heading"><div><p className="eyebrow">MAKE SOMETHING YOURS</p><h1 id="create-heading">{t("create")}</h1></div><span className="count"><Icon name="create" /></span></div><form className="panel create-form" onSubmit={event => void generate(event)}>
    {profileError ? <Failure t={t} retry={() => setRefresh(value => value + 1)}>{profileError}</Failure> : !profile && <p role="status">{t("loading")}</p>}
    {profile && <p className="muted">{profile.name}</p>}
    {profile?.available === false && <p className="notice" role="status">{t("profileUnavailable")}</p>}
    {profile?.available && abilities?.reference_audio && <p className="notice" role="status">{t("profileDesktopReference")}</p>}
    {abilities && !abilities.reference_audio && <fieldset disabled={pending || analyzing || Boolean(profileError) || !profile?.available}>
      <Field title={t("title")}><input value={draft.title} placeholder={t("titleHint")} onChange={event => setDraft(value => ({ ...value, title: event.target.value }))} /></Field>
      {abilities.prompt && <Field title={t(barOptions ? "clipDescription" : "prompt")} hint={promptHint}>
        <textarea rows={3} required={midi || Boolean(barOptions)} aria-describedby={promptHint.id} value={draft.prompt}
          placeholder={t(barOptions ? "clipDescriptionHint" : midi ? "midiPrompt" : "promptHint")}
          onChange={event => setDraft(value => ({ ...value, prompt: event.target.value }))} />
      </Field>}
      {!midi && !barOptions && <Field title={t(abilities.style_description ? "styleDescription" : abilities.prompt ? "style" : "styleTags")}
        hint={abilities.prompt ? undefined : styleHint}>
        <input value={draft.style} placeholder={t("styleHint")} required={!abilities.prompt} aria-describedby={abilities.prompt ? promptHint.id : styleHint.id}
          onChange={event => setDraft(value => ({ ...value, style: event.target.value }))} />
      </Field>}
      {abilities.lyrics && abilities.instrumental && !barOptions && <Switch label={t("instrumental")} checked={draft.instrumental}
        onChange={event => setDraft(value => ({ ...value, instrumental: event.target.checked }))} />}
      {!instrumental && <Field title={t("lyrics")}><textarea rows={4} required={abilities.lyrics_required} value={draft.lyrics} onChange={event => setDraft(value => ({ ...value, lyrics: event.target.value }))} /></Field>}
      <div className="field-grid">
        {barOptions ? <>
          <Field title={t("clipBars")}>
            <select value={bars} onChange={event => setMeter({ ...meter, bars: Number(event.target.value) })}>
              {barOptions.map(count => <option key={count}>{count}</option>)}
            </select>
          </Field>
          <Field title={t("clipBpm")}>
            <input type="number" min={1} max={MAX_CLIP_BPM} required value={meter.tempo} onChange={event => setMeter({ ...meter, tempo: event.target.value })} />
          </Field>
        </> : !midi && <>
          <Field title={t(profile?.selection.provider === "yue2" ? "durationLimit" : "duration")}><input type="number" min={abilities.min_duration} max={extendedDuration ? MAX_EXTENDED_DURATION : abilities.max_duration} readOnly={abilities.min_duration === abilities.max_duration} required value={draft.duration} onChange={event => setDraft(value => ({ ...value, duration: event.target.value }))} /></Field>
          {abilities.bpm && <Field title={t("bpm")}><input type="number" min={0} max={300} required value={draft.bpm} onChange={event => setDraft(value => ({ ...value, bpm: Number(event.target.value) }))} /></Field>}
        </>}
        {maxVariants > 1 && <Field title={t("variants")}><input type="number" min={1} max={maxVariants} required value={variants} onChange={event => {
          const count = Number(event.target.value);
          if (yue2) setYue2Variants(count);
          else setDraft(value => ({ ...value, variants: count }));
        }} /></Field>}
        {!abilities.advanced && <Field title={yue2 ? yue2Text(language).acousticSeed : t("seed")}><input type="number" min={-1} max={abilities.max_seed ?? Number.MAX_SAFE_INTEGER} value={draft.seed} onChange={event => setDraft(value => ({ ...value, seed: event.target.value }))} /></Field>}
        <Field title={t("folder")}><select value={draft.folder_id} onChange={event => setDraft(value => ({ ...value, folder_id: event.target.value }))}><option value="">{t("unsorted")}</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></Field>
      </div>
      {canExtend && <Switch label={t("ignoreRecommendedDuration")} checked={extendedDuration}
        aria-describedby={extendedDuration ? "remote-extended-duration-hint" : undefined}
        onChange={event => {
          setExtendedProfile(event.target.checked ? profileKey : null);
          if (!event.target.checked) setDraft(value => ({ ...value, duration: String(boundedDuration(Number(value.duration), abilities)) }));
        }} />}
      {extendedDuration && <p className="fine" id="remote-extended-duration-hint">{t("extendedDurationHint")}</p>}
      {barOptions && <output className="field muted" aria-live="polite">
        {clipDuration !== undefined && `${clipDuration.toLocaleString(language, { maximumFractionDigits: 3 })} ${t("seconds")}`}
        {clipTooLong && <span>{t("clipTooLong").replace("{limit}", String(abilities.max_duration))}</span>}
      </output>}
      {canAnalyze && <details className="analyze-details"><summary>{t("analyze")}</summary><p className="fine">{t(yue2 ? "analyzeYue2Hint" : "analyzeHint")}</p><input ref={file} type="file" accept=".wav,.mp3,.flac,.m4a,.ogg,audio/*" aria-label={t("analyze")} onChange={event => void analyze(event.target.files?.[0])} /></details>}
      {yue2 && <Yue2Fields language={language} options={yue2Options} onChange={setYue2Options} />}
      {yue2Problem && <Failure t={t}>{yue2ErrorText(yue2Problem, language)}</Failure>}
      <button className="primary wide generate" type="submit" disabled={pending || analyzing || incomplete || Boolean(yue2Problem)}>{pending ? t("loading") : analyzing ? t("analyzeBusy") : t(midi ? "midiGenerate" : "generate")}<Icon name="create" /></button>
    </fieldset>}
    {(pending || analyzing) && <progress className="song-activity-meter mobile-action-meter" aria-label={t(analyzing ? "analyzeBusy" : "loading")} />}
    <p className="fine">{t("generateHint")}</p>{notice && <p className="notice" role="status">{t("analyzed")}</p>}{error && <Failure t={t}>{yue2ErrorText(error, language)}</Failure>}
  </form></section>;
}
