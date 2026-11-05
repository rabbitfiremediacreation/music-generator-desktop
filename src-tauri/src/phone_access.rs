//! Optional phone access: a token-protected HTTP API on the local network for the iPhone app.
//! It speaks the same JSON contract as the Python web app's phone access and is off by default.
use crate::{
    error::{message, Error, Result},
    state::AppState,
    types::{GenerateRequest, Song, SongFilter},
};
use axum::{
    body::{Body, Bytes},
    extract::{DefaultBodyLimit, Multipart, Path as UrlPath, Query, Request, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, path::Path, sync::Arc};
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio_util::sync::CancellationToken;

/// The Python web app already uses 8766 for its phone access; both apps may run on one computer.
pub const PORT: u16 = 8767;
const ENABLED_KEY: &str = "phone_access";
const TOKEN_KEY: &str = "phone_access_token";
/// Paths that concern the computer itself and stay local, as in the web app.
const BLOCKED: [&str; 3] = ["/api/shutdown", "/api/update/", "/api/remote"];
const MAX_UPLOAD: usize = 60 * 1024 * 1024;

pub type Changed = Arc<dyn Fn() + Send + Sync>;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Status {
    pub enabled: bool,
    pub port: u16,
    pub token: String,
    pub addresses: Vec<String>,
}

struct Server {
    port: u16,
    stop: CancellationToken,
    task: tokio::task::JoinHandle<()>,
}

/// Starts and stops the listener at runtime; the persisted switch is handled by `set`.
#[derive(Default)]
pub struct PhoneAccess {
    server: tokio::sync::Mutex<Option<Server>>,
}

impl PhoneAccess {
    /// Bind before spawning so a busy port is reported instead of failing in the background.
    pub async fn start(
        &self,
        state: Arc<AppState>,
        changed: Changed,
        port: u16,
    ) -> std::io::Result<u16> {
        let mut server = self.server.lock().await;
        if let Some(running) = server.as_ref().filter(|s| !s.task.is_finished()) {
            return Ok(running.port);
        }
        let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await?;
        let port = listener.local_addr()?.port();
        let stop = CancellationToken::new();
        let app = router(Remote {
            state,
            changed,
            stop: stop.clone(),
        });
        let shutdown = stop.clone();
        let task = tokio::spawn(async move {
            let result = axum::serve(listener, app)
                .with_graceful_shutdown(async move { shutdown.cancelled().await })
                .await;
            if let Err(error) = result {
                tracing::warn!("Phone access stopped: {error}");
            }
        });
        tracing::info!(port, "Phone access on");
        *server = Some(Server { port, stop, task });
        Ok(port)
    }

    pub async fn stop(&self) {
        let Some(server) = self.server.lock().await.take() else {
            return;
        };
        // The guard cancels in-flight requests and response streams as well as new requests.
        server.stop.cancel();
        let abort = server.task.abort_handle();
        if tokio::time::timeout(std::time::Duration::from_secs(5), server.task)
            .await
            .is_err()
        {
            abort.abort();
        }
        tracing::info!("Phone access off");
    }

    pub async fn port(&self) -> Option<u16> {
        self.server
            .lock()
            .await
            .as_ref()
            .filter(|s| !s.task.is_finished())
            .map(|s| s.port)
    }
}

fn stored(state: &AppState, key: &str) -> Result<Option<Value>> {
    use rusqlite::OptionalExtension;
    let text: Option<String> = state
        .db
        .lock()
        .query_row("SELECT value FROM settings WHERE key=?1", [key], |r| {
            r.get(0)
        })
        .optional()?;
    Ok(text.and_then(|t| serde_json::from_str(&t).ok()))
}

fn store(state: &AppState, key: &str, value: Value) -> Result<()> {
    state.db.lock().execute(
        "INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        rusqlite::params![key, value.to_string()],
    )?;
    Ok(())
}

pub fn token(state: &AppState) -> Result<String> {
    Ok(stored(state, TOKEN_KEY)?
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default())
}

pub fn enabled(state: &AppState) -> Result<bool> {
    Ok(stored(state, ENABLED_KEY)?
        .and_then(|v| v.as_bool())
        .unwrap_or(false))
}

/// 18 random bytes, URL-safe Base64 without padding (24 characters), like the web app.
fn new_token() -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut hasher = Sha256::new();
    hasher.update(uuid::Uuid::new_v4().as_bytes());
    hasher.update(uuid::Uuid::new_v4().as_bytes());
    let bytes = hasher.finalize();
    bytes[..18]
        .chunks(3)
        .flat_map(|c| {
            let n = (u32::from(c[0]) << 16) | (u32::from(c[1]) << 8) | u32::from(c[2]);
            [18, 12, 6, 0].map(|shift| ALPHABET[((n >> shift) & 63) as usize] as char)
        })
        .collect()
}

/// Compare digests so neither content nor length of the stored key leaks through timing.
fn same_secret(sent: &[u8], expected: &[u8]) -> bool {
    let (a, b) = (Sha256::digest(sent), Sha256::digest(expected));
    a.iter()
        .zip(b.iter())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}

/// Addresses under which the phone finds this computer on the home network.
pub fn addresses(port: u16) -> Vec<String> {
    let mut names = Vec::new();
    #[cfg(target_os = "macos")]
    if let Ok(output) = std::process::Command::new("/usr/sbin/scutil")
        .args(["--get", "LocalHostName"])
        .output()
    {
        let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if output.status.success() && !name.is_empty() {
            names.push(format!("{name}.local"));
        }
    }
    if names.is_empty() {
        if let Some(name) = sysinfo::System::host_name().filter(|n| !n.trim().is_empty()) {
            names.push(name.trim().to_string());
        }
    }
    // Look up the route to a private address; nothing is sent.
    if let Ok(socket) = std::net::UdpSocket::bind(("0.0.0.0", 0)) {
        if socket.connect(("10.255.255.255", 1)).is_ok() {
            if let Ok(local) = socket.local_addr() {
                names.push(local.ip().to_string());
            }
        }
    }
    let mut seen = std::collections::HashSet::new();
    names
        .into_iter()
        .filter(|n| !n.is_empty() && !n.starts_with("127.") && n != "0.0.0.0")
        .filter(|n| seen.insert(n.clone()))
        .map(|n| format!("http://{n}:{port}"))
        .collect()
}

pub async fn status(state: &AppState) -> Result<Status> {
    let running = state.phone_access.port().await;
    let port = running.unwrap_or(PORT);
    let addresses = tauri::async_runtime::spawn_blocking(move || addresses(port))
        .await
        .map_err(|e| message(e.to_string()))?;
    Ok(Status {
        enabled: running.is_some(),
        port,
        token: token(state)?,
        addresses,
    })
}

/// Apply the switch and/or rotate the key; the flag is persisted only after a successful change.
pub async fn set(
    state: &Arc<AppState>,
    changed: Changed,
    enabled: Option<bool>,
    new_key: bool,
    port: u16,
) -> Result<Status> {
    if new_key || (enabled == Some(true) && token(state)?.is_empty()) {
        store(state, TOKEN_KEY, json!(new_token()))?;
    }
    if let Some(enabled) = enabled {
        if enabled {
            if let Err(error) = state.phone_access.start(state.clone(), changed, port).await {
                tracing::warn!(port, "Phone access could not start: {error}");
                return Err(message("phone_access_port_busy"));
            }
        } else {
            state.phone_access.stop().await;
        }
        store(state, ENABLED_KEY, json!(enabled))?;
    }
    status(state).await
}

/// Restore the persisted switch at startup; a busy port only leaves phone access off.
pub async fn restore(state: Arc<AppState>, changed: Changed) {
    if !enabled(&state).unwrap_or(false) {
        return;
    }
    if token(&state).map(|t| t.is_empty()).unwrap_or(true) {
        let _ = store(&state, TOKEN_KEY, json!(new_token()));
    }
    if let Err(error) = state.phone_access.start(state.clone(), changed, PORT).await {
        tracing::warn!(port = PORT, "Phone access could not start: {error}");
    }
}

#[tauri::command]
pub async fn phone_access_status(state: tauri::State<'_, Arc<AppState>>) -> Result<Status> {
    status(&state).await
}

#[tauri::command]
pub async fn set_phone_access(
    state: tauri::State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    enabled: Option<bool>,
    new_token: Option<bool>,
) -> Result<Status> {
    set(
        state.inner(),
        library_events(app),
        enabled,
        new_token.unwrap_or(false),
        PORT,
    )
    .await
}

/// Phone changes refresh the desktop library like local changes do.
pub fn library_events<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Changed {
    use tauri::Emitter;
    Arc::new(move || {
        let _ = app.emit("library-changed", ());
    })
}

// ---------------------------------------------------------------- HTTP API

#[derive(Clone)]
struct Remote {
    state: Arc<AppState>,
    changed: Changed,
    stop: CancellationToken,
}

fn router(remote: Remote) -> Router {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/songs", get(songs))
        .route("/api/songs/{id}", get(song).patch(patch_song))
        .route("/api/songs/{id}/audio", get(audio))
        .route("/api/folders", get(folders).post(create_folder))
        .route("/api/queue", get(queue))
        .route("/api/generate", post(generate))
        .route(
            "/api/analyze",
            post(analyze).layer(DefaultBodyLimit::max(MAX_UPLOAD + 1024 * 1024)),
        )
        .fallback(|| async { detail(StatusCode::NOT_FOUND, "Not Found") })
        .layer(middleware::from_fn_with_state(remote.clone(), guard))
        .with_state(remote)
}

fn language(headers: &HeaderMap) -> String {
    headers
        .get("x-lang")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.trim().to_lowercase().chars().take(2).collect())
        .unwrap_or_else(|| "en".into())
}

fn text(key: &str, lang: &str) -> &'static str {
    let index = [
        "de", "en", "es", "fr", "it", "pt", "tr", "pl", "ru", "uk", "ja", "zh",
    ]
    .iter()
    .position(|l| *l == lang)
    .unwrap_or(1);
    let texts: [&str; 12] = match key {
        "remote_denied" => [
            "Zugangsschlüssel fehlt oder ist falsch.",
            "Access key missing or wrong.",
            "Falta la clave de acceso o es incorrecta.",
            "Clé d'accès manquante ou incorrecte.",
            "Chiave di accesso mancante o errata.",
            "Chave de acesso ausente ou incorreta.",
            "Erişim anahtarı eksik veya yanlış.",
            "Brak klucza dostępu lub jest nieprawidłowy.",
            "Ключ доступа отсутствует или неверен.",
            "Ключ доступу відсутній або неправильний.",
            "アクセスキーがないか、間違っています。",
            "访问密钥缺失或错误。",
        ],
        "remote_blocked" => [
            "Das geht nur am Rechner selbst, nicht über den Handy-Zugriff.",
            "This only works on the computer itself, not via phone access.",
            "Esto solo funciona en el propio ordenador, no mediante el acceso desde el móvil.",
            "Ceci ne fonctionne que sur l'ordinateur lui-même, pas via l'accès mobile.",
            "Funziona solo sul computer stesso, non tramite l'accesso dal telefono.",
            "Isto só funciona no próprio computador, não pelo acesso do celular.",
            "Bu yalnızca bilgisayarın kendisinde çalışır, telefon erişimiyle değil.",
            "To działa tylko na samym komputerze, nie przez dostęp z telefonu.",
            "Это работает только на самом компьютере, не через доступ с телефона.",
            "Це працює лише на самому комп'ютері, не через доступ із телефона.",
            "これはコンピューター本体でのみ使えます。スマホからのアクセスでは使えません。",
            "此操作只能在电脑上进行, 不能通过手机访问。",
        ],
        _ => return "",
    };
    texts[index]
}

fn detail(status: StatusCode, text: impl Into<String>) -> Response {
    (status, Json(json!({"detail": text.into()}))).into_response()
}

fn failure(error: Error) -> Response {
    let status = match &error {
        Error::Message(text) if text == "Song not found" => StatusCode::NOT_FOUND,
        Error::Message(_) => StatusCode::BAD_REQUEST,
        Error::Cancelled => StatusCode::CONFLICT,
        Error::EngineTimeout { .. } => StatusCode::GATEWAY_TIMEOUT,
        Error::Http(_) => StatusCode::BAD_GATEWAY,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    let text = match error.to_string().as_str() {
        "audio_size" => "The audio file is larger than 60 MB.".to_string(),
        "audio_type" => "Only audio files (WAV, MP3, FLAC, M4A, OGG) can be analyzed.".to_string(),
        "mp3_failed" => "MP3 conversion failed.".to_string(),
        other => other.to_string(),
    };
    detail(status, text)
}

async fn guard(State(remote): State<Remote>, request: Request, next: Next) -> Response {
    let lang = language(request.headers());
    if remote.stop.is_cancelled() {
        return detail(
            StatusCode::SERVICE_UNAVAILABLE,
            text("remote_blocked", &lang),
        );
    }
    let token = token(&remote.state).unwrap_or_default();
    let sent = request
        .headers()
        .get(header::AUTHORIZATION)
        .map(|v| v.as_bytes())
        .unwrap_or_default();
    if token.is_empty() || !same_secret(sent, format!("Bearer {token}").as_bytes()) {
        return detail(StatusCode::UNAUTHORIZED, text("remote_denied", &lang));
    }
    let path = request.uri().path();
    if !path.starts_with("/api/")
        || BLOCKED.iter().any(|b| path.starts_with(b))
        || (path == "/api/settings" && request.method() != Method::GET)
    {
        return detail(StatusCode::FORBIDDEN, text("remote_blocked", &lang));
    }
    let response = tokio::select! {
        biased;
        _ = remote.stop.cancelled() => {
            return detail(StatusCode::SERVICE_UNAVAILABLE, text("remote_blocked", &lang));
        }
        response = next.run(request) => response,
    };
    // Graceful server shutdown alone lets uploads and downloads continue indefinitely.
    // Cancel the handler above and the response body here, while keeping its status and
    // headers (including audio Content-Length/Content-Range) intact. Accepted generation
    // jobs belong to the desktop queue and are unaffected by the HTTP connection closing.
    let (parts, body) = response.into_parts();
    let body = body
        .into_data_stream()
        .take_until(remote.stop.cancelled_owned());
    Response::from_parts(parts, Body::from_stream(body))
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| message(e.to_string()))?
}

fn flag(value: Option<&String>) -> bool {
    value.is_some_and(|v| matches!(v.to_lowercase().as_str(), "1" | "true" | "yes" | "on"))
}

/// The phone needs a stream URL and plain metadata types, never local file paths.
pub fn phone_song(song: &Song) -> Value {
    let url = (song.status == "done" && song.path.is_some())
        .then(|| format!("/api/songs/{}/audio", song.id));
    let mut value = serde_json::to_value(song).unwrap_or_else(|_| json!({}));
    if let Some(object) = value.as_object_mut() {
        object.remove("path");
        object.insert("url".into(), json!(url));
    }
    if let Some(meta) = value.get_mut("result_meta").and_then(Value::as_object_mut) {
        for key in ["duration", "bpm"] {
            let number = meta.get(key).and_then(|v| match v {
                Value::Number(_) => v.as_f64(),
                Value::String(s) => s.trim().parse::<f64>().ok(),
                _ => None,
            });
            match number.filter(|n| n.is_finite()) {
                Some(n) => meta.insert(key.into(), json!(n)),
                None => meta.remove(key),
            };
        }
        for key in ["keyscale", "vocal_language"] {
            let text = meta.get(key).and_then(|v| match v {
                Value::String(s) => Some(s.clone()),
                Value::Number(n) => Some(n.to_string()),
                _ => None,
            });
            match text {
                Some(t) => meta.insert(key.into(), json!(t)),
                None => meta.remove(key),
            };
        }
    }
    value
}

async fn health(State(remote): State<Remote>) -> Response {
    Json(remote.state.health().await).into_response()
}

async fn songs(
    State(remote): State<Remote>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let filter = SongFilter {
        q: query.get("q").cloned().unwrap_or_default(),
        favorites: flag(query.get("favorites")),
        group: query.get("group").cloned().unwrap_or_default(),
        folder: query.get("folder").cloned().unwrap_or_default(),
        ..Default::default()
    };
    let db = remote.state.db.clone();
    match blocking(move || db.songs(&filter)).await {
        Ok(songs) => Json(songs.iter().map(phone_song).collect::<Vec<_>>()).into_response(),
        Err(error) => failure(error),
    }
}

async fn song(State(remote): State<Remote>, UrlPath(id): UrlPath<String>) -> Response {
    let db = remote.state.db.clone();
    match blocking(move || db.song(&id)).await {
        Ok(song) => Json(phone_song(&song)).into_response(),
        Err(error) => failure(error),
    }
}

fn json_body(body: &Bytes) -> Option<Value> {
    serde_json::from_slice::<Value>(body)
        .ok()
        .filter(Value::is_object)
}

fn invalid_json() -> Response {
    detail(StatusCode::UNPROCESSABLE_ENTITY, "Invalid JSON body")
}

async fn patch_song(
    State(remote): State<Remote>,
    UrlPath(id): UrlPath<String>,
    body: Bytes,
) -> Response {
    let patch = match json_body(&body) {
        Some(patch) => patch,
        None => return invalid_json(),
    };
    let db = remote.state.db.clone();
    let result = blocking(move || {
        db.song(&id)?;
        db.patch(&id, &patch)?;
        db.song(&id)
    })
    .await;
    match result {
        Ok(song) => {
            (remote.changed)();
            Json(phone_song(&song)).into_response()
        }
        Err(error) => failure(error),
    }
}

async fn folders(State(remote): State<Remote>) -> Response {
    let db = remote.state.db.clone();
    match blocking(move || db.folders()).await {
        Ok(folders) => Json(folders).into_response(),
        Err(error) => failure(error),
    }
}

async fn create_folder(State(remote): State<Remote>, body: Bytes) -> Response {
    let name = match json_body(&body) {
        Some(body) => body["name"].as_str().unwrap_or_default().to_string(),
        None => return invalid_json(),
    };
    let db = remote.state.db.clone();
    match blocking(move || db.folder_save(None, &name)).await {
        Ok(folder) => {
            (remote.changed)();
            Json(folder).into_response()
        }
        Err(Error::Message(text)) => detail(StatusCode::UNPROCESSABLE_ENTITY, text),
        Err(error) => failure(error),
    }
}

async fn queue(State(remote): State<Remote>) -> Response {
    let db = remote.state.db.clone();
    match blocking(move || db.queue()).await {
        Ok(mut queue) => {
            queue["active"] = json!(remote.state.runtime.is_busy());
            queue["progress"] = json!(remote.state.runtime.progress());
            Json(queue).into_response()
        }
        Err(error) => failure(error),
    }
}

/// The web app's request shape, with the number types its iPhone client sends.
#[derive(Debug, Deserialize)]
#[serde(default)]
pub struct PhoneGeneration {
    pub prompt: String,
    pub style: String,
    pub caption: String,
    pub lyrics: String,
    pub instrumental: bool,
    pub keep_caption: bool,
    pub title: String,
    pub duration: f64,
    pub bpm: f64,
    pub keyscale: String,
    pub timesignature: String,
    pub vocal_language: String,
    pub seed: i64,
    pub variants: u32,
    pub inference_steps: f64,
    pub lm_temperature: Option<f64>,
    pub folder_id: Option<String>,
}

impl Default for PhoneGeneration {
    fn default() -> Self {
        Self {
            prompt: String::new(),
            style: String::new(),
            caption: String::new(),
            lyrics: String::new(),
            instrumental: true,
            keep_caption: true,
            title: String::new(),
            duration: 0.0,
            bpm: 0.0,
            keyscale: String::new(),
            timesignature: String::new(),
            vocal_language: String::new(),
            seed: -1,
            variants: 1,
            inference_steps: 0.0,
            lm_temperature: None,
            folder_id: None,
        }
    }
}

impl PhoneGeneration {
    /// Map onto the desktop request; the desktop admission validates all limits afterwards.
    pub fn request(self, group_id: String) -> Result<GenerateRequest> {
        let whole = |n: f64| {
            (n.is_finite() && n >= 0.0 && n <= f64::from(u32::MAX))
                .then(|| n.round() as u32)
                .ok_or_else(|| message("Invalid generation parameters"))
        };
        Ok(GenerateRequest {
            model_selection: None,
            prompt: self.prompt,
            style: self.style,
            caption: self.caption,
            lyrics: self.lyrics,
            instrumental: self.instrumental,
            keep_caption: self.keep_caption,
            title: self.title,
            duration: self.duration,
            bpm: whole(self.bpm)?,
            keyscale: self.keyscale,
            timesignature: self.timesignature,
            vocal_language: self.vocal_language,
            seed: self.seed,
            variants: self.variants,
            inference_steps: whole(self.inference_steps)?,
            lm_temperature: self.lm_temperature,
            group_id: Some(group_id),
            folder_id: self.folder_id.filter(|f| !f.is_empty()),
        })
    }
}

/// The phone cannot answer the desktop's CPU dialog; "ask" therefore takes its first choice, 30 steps.
pub fn cpu_steps(
    backend: crate::synthesis_policy::Backend,
    behavior: crate::types::CpuIterationBehavior,
    requested: u32,
    legacy: u32,
) -> u32 {
    let steps = if requested > 0 { requested } else { legacy };
    if backend != crate::synthesis_policy::Backend::Gpu
        && steps > 30
        && behavior != crate::types::CpuIterationBehavior::Continue
    {
        30
    } else {
        requested
    }
}

async fn generate(State(remote): State<Remote>, body: Bytes) -> Response {
    let body = match json_body(&body) {
        Some(body) => body,
        None => return invalid_json(),
    };
    let group = crate::types::id();
    let request = match serde_json::from_value::<PhoneGeneration>(body)
        .map_err(|e| message(e.to_string()))
        .and_then(|g| g.request(group.clone()))
    {
        Ok(request) => request,
        Err(error) => return detail(StatusCode::UNPROCESSABLE_ENTITY, error.to_string()),
    };
    let state = remote.state.clone();
    let result = blocking(move || {
        let mut request = request;
        let settings = state.db.settings()?;
        let selection = crate::catalog::Selection::from_settings(&settings);
        let policy =
            state
                .synthesis_probe
                .session_policy(&state.resources, &selection, false, || {
                    state.backend_status()
                });
        request.inference_steps = cpu_steps(
            policy.backend,
            settings.cpu_iteration_behavior,
            request.inference_steps,
            policy.legacy_inference_steps,
        );
        crate::admission::generate(&state, request)
    })
    .await;
    match result {
        Ok(ids) => {
            (remote.changed)();
            Json(json!({"group_id":group,"ids":ids})).into_response()
        }
        Err(Error::Message(text)) if text == "Please enter a prompt or style" => {
            detail(StatusCode::UNPROCESSABLE_ENTITY, text)
        }
        Err(error) => failure(error),
    }
}

/// Parse a single `bytes=` range; `Err` means unsatisfiable, `None` serves the whole file.
pub fn byte_range(header: Option<&str>, len: u64) -> Option<std::result::Result<(u64, u64), ()>> {
    let spec = header?.trim().strip_prefix("bytes=")?.trim();
    if spec.contains(',') {
        return None;
    }
    let (start, end) = spec.split_once('-')?;
    let (start, end) = (start.trim(), end.trim());
    let range = if start.is_empty() {
        let suffix: u64 = end.parse().ok()?;
        if suffix == 0 || len == 0 {
            return Some(Err(()));
        }
        (len.saturating_sub(suffix), len - 1)
    } else {
        let start: u64 = start.parse().ok()?;
        let end = if end.is_empty() {
            len.saturating_sub(1)
        } else {
            end.parse::<u64>().ok()?.min(len.saturating_sub(1))
        };
        if start >= len || end < start {
            return Some(Err(()));
        }
        (start, end)
    };
    Some(Ok(range))
}

fn content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_lowercase)
        .as_deref()
    {
        Some("wav") => "audio/wav",
        Some("mp3") => "audio/mpeg",
        Some("flac") => "audio/flac",
        Some("ogg") => "audio/ogg",
        Some("m4a") => "audio/mp4",
        _ => "application/octet-stream",
    }
}

/// `filename` keeps an ASCII fallback; `filename*` carries the readable title (RFC 6266).
pub fn attachment(name: &str) -> String {
    let ascii: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_graphic() && c != '"' && c != '\\' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let encoded: String = name
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-_.".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect();
    format!("attachment; filename=\"{ascii}\"; filename*=UTF-8''{encoded}")
}

async fn audio(
    State(remote): State<Remote>,
    UrlPath(id): UrlPath<String>,
    Query(query): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> Response {
    let db = remote.state.db.clone();
    let song = match blocking(move || db.song(&id)).await {
        Ok(song) => song,
        Err(error) => return failure(error),
    };
    let Some(source) = song.path.clone().filter(|_| song.status == "done") else {
        return detail(StatusCode::NOT_FOUND, "Not Found");
    };
    let download = flag(query.get("download"));
    let mut path = std::path::PathBuf::from(&source);
    if download {
        let mp3 = match remote.state.db.settings() {
            Ok(settings) => settings.export_format == "mp3",
            Err(error) => return failure(error),
        };
        if mp3 {
            match crate::audio_export::mp3(
                &remote.state.resources,
                &remote.state.db.root,
                &song.id,
                &path,
                &remote.state.runtime.cancellation(),
            )
            .await
            {
                Ok(converted) => path = converted,
                Err(error) => return failure(error),
            }
        }
    }
    let mut file = match tokio::fs::File::open(&path).await {
        Ok(file) => file,
        Err(_) => return detail(StatusCode::NOT_FOUND, "Not Found"),
    };
    let len = match file.metadata().await {
        Ok(metadata) => metadata.len(),
        Err(error) => return failure(error.into()),
    };
    let range = byte_range(
        headers.get(header::RANGE).and_then(|v| v.to_str().ok()),
        len,
    );
    let (status, start, end) = match range {
        Some(Err(())) => {
            return Response::builder()
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{len}"))
                .header(header::ACCEPT_RANGES, "bytes")
                .body(Body::empty())
                .unwrap_or_default();
        }
        Some(Ok((start, end))) => (StatusCode::PARTIAL_CONTENT, start, end),
        None => (StatusCode::OK, 0, len.saturating_sub(1)),
    };
    let length = if len == 0 { 0 } else { end - start + 1 };
    if start > 0 {
        if let Err(error) = file.seek(std::io::SeekFrom::Start(start)).await {
            return failure(error.into());
        }
    }
    let mut response = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type(&path))
        .header(header::CONTENT_LENGTH, length)
        .header(header::ACCEPT_RANGES, "bytes");
    if status == StatusCode::PARTIAL_CONTENT {
        response = response.header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"));
    }
    if download {
        let base = crate::exports::clean_name(
            song.title
                .as_deref()
                .filter(|t| !t.trim().is_empty())
                .unwrap_or(&song.caption.chars().take(40).collect::<String>()),
        )
        .replace(' ', "_");
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("wav");
        if let Ok(value) =
            HeaderValue::from_str(&attachment(&format!("{base}_{}.{ext}", song.seed)))
        {
            response = response.header(header::CONTENT_DISPOSITION, value);
        }
    }
    let body = Body::from_stream(tokio_util::io::ReaderStream::new(file.take(length)));
    response.body(body).unwrap_or_default()
}

async fn analyze(State(remote): State<Remote>, mut form: Multipart) -> Response {
    let mut upload = None;
    loop {
        match form.next_field().await {
            Ok(Some(field)) if field.name() == Some("audio") => {
                let name = field.file_name().unwrap_or("upload.wav").to_string();
                match field.bytes().await {
                    Ok(data) => upload = Some((name, data)),
                    Err(error) => return detail(StatusCode::BAD_REQUEST, error.body_text()),
                }
            }
            Ok(Some(_)) => {}
            Ok(None) => break,
            Err(error) => return detail(StatusCode::BAD_REQUEST, error.body_text()),
        }
    }
    let Some((filename, data)) = upload else {
        return detail(StatusCode::UNPROCESSABLE_ENTITY, "Missing field: audio");
    };
    // Recordings without an audio extension are WAV, as in the desktop drop zone.
    let extension = filename.rsplit('.').next().unwrap_or("").to_lowercase();
    let filename = if filename.contains('.')
        && crate::audio_import::AUDIO_EXTENSIONS.contains(&extension.as_str())
    {
        filename
    } else {
        format!("{filename}.wav")
    };
    match crate::commands::analyze_audio(&remote.state, data.to_vec(), filename, None).await {
        Ok(r) => {
            let text = |key: &str| r[key].as_str().unwrap_or_default().to_string();
            Json(json!({
                "caption": text("caption"),
                "lyrics": text("lyrics"),
                "bpm": r["bpm"].as_f64().filter(|n| n.is_finite()).unwrap_or(0.0),
                "keyscale": text("keyscale"),
                "timesignature": match &r["timesignature"] {
                    Value::Number(n) => n.to_string(),
                    other => other.as_str().unwrap_or_default().to_string(),
                },
                "vocal_language": text("vocal_language"),
                "duration": r["duration"].as_f64().filter(|n| n.is_finite()).unwrap_or(0.0),
            }))
            .into_response()
        }
        Err(error) => failure(error),
    }
}

#[cfg(test)]
mod tests;
