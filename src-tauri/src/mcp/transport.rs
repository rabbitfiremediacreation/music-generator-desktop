//! Opt-in loopback transport sharing the desktop application's state and lifetime.
use crate::{
    error::{message, Result},
    state::AppState,
};
use axum::{
    extract::{Request, State},
    http::{header, HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    Router,
};
use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
};
use serde::{Deserialize, Serialize};
use std::{
    io::Write,
    net::{Ipv4Addr, TcpListener},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::Manager;

pub(super) const MAX_REQUEST_BYTES: usize = 1024 * 1024;

#[derive(Clone, Deserialize, Serialize)]
pub(super) struct ConnectionInfo {
    pub url: String,
    pub token: String,
    pub pid: u32,
}

struct ConnectionFile {
    path: PathBuf,
    info: ConnectionInfo,
}

struct Control {
    descriptor: Mutex<Option<ConnectionFile>>,
    cancellation: tokio_util::sync::CancellationToken,
}

impl Control {
    fn stop(&self) {
        self.cancellation.cancel();
        self.descriptor.lock().unwrap().take();
    }
}

impl ConnectionFile {
    fn create(root: &Path, info: ConnectionInfo) -> Result<Self> {
        let path = root.join("mcp.json");
        let temporary = root.join(format!(".mcp-{}.tmp", uuid::Uuid::new_v4()));
        let mut options = std::fs::OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let result = (|| -> Result<()> {
            let mut file = options.open(&temporary)?;
            file.write_all(&serde_json::to_vec_pretty(&info)?)?;
            file.sync_all()?;
            // Windows rename cannot replace an existing file. This process is the
            // desktop's single instance, so an existing descriptor is from a prior run.
            #[cfg(windows)]
            if path.exists() {
                std::fs::remove_file(&path)?;
            }
            std::fs::rename(&temporary, &path)?;
            Ok(())
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(temporary);
        }
        result?;
        Ok(Self { path, info })
    }
}

impl Drop for ConnectionFile {
    fn drop(&mut self) {
        let current = std::fs::read(&self.path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<ConnectionInfo>(&bytes).ok());
        if current.is_some_and(|info| {
            info.token == self.info.token && info.url == self.info.url && info.pid == self.info.pid
        }) {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

#[derive(Clone)]
struct Access {
    authorization: String,
    authority: String,
}

impl Access {
    fn check(&self, headers: &HeaderMap) -> std::result::Result<(), StatusCode> {
        if headers.contains_key(header::ORIGIN)
            || headers.get_all(header::HOST).iter().count() != 1
            || headers
                .get(header::HOST)
                .and_then(|value| value.to_str().ok())
                != Some(&self.authority)
        {
            return Err(StatusCode::FORBIDDEN);
        }
        if headers.get_all(header::AUTHORIZATION).iter().count() != 1
            || !headers.get(header::AUTHORIZATION).is_some_and(|value| {
                constant_time_equal(value.as_bytes(), self.authorization.as_bytes())
            })
        {
            return Err(StatusCode::UNAUTHORIZED);
        }
        Ok(())
    }
}

fn constant_time_equal(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (a, b)| difference | (a ^ b))
        == 0
}

async fn authorize(State(access): State<Access>, request: Request, next: Next) -> Response {
    match access.check(request.headers()) {
        Ok(()) => next.run(request).await,
        Err(StatusCode::UNAUTHORIZED) => (
            StatusCode::UNAUTHORIZED,
            [(header::WWW_AUTHENTICATE, "Bearer realm=\"Music Generator\"")],
            "MCP bearer token required",
        )
            .into_response(),
        Err(status) => (status, "Only direct loopback MCP clients are allowed").into_response(),
    }
}

pub(super) fn validate_token(token: &str) -> Result<()> {
    if !(32..=512).contains(&token.len())
        || !token
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-._~+/=".contains(&byte))
    {
        return Err(message(
            "MUSIC_GENERATOR_MCP_TOKEN must contain 32–512 bearer-token characters",
        ));
    }
    Ok(())
}

/// Start once after desktop state registration; absence of the port variable disables MCP.
pub fn start<R: tauri::Runtime>(state: Arc<AppState>, app: tauri::AppHandle<R>) -> Result<()> {
    let port = match std::env::var("MUSIC_GENERATOR_MCP_PORT") {
        Err(std::env::VarError::NotPresent) => return Ok(()),
        Err(_) => {
            return Err(message(
                "MUSIC_GENERATOR_MCP_PORT must be a number from 0 to 65535",
            ))
        }
        Ok(value) => value
            .parse::<u16>()
            .map_err(|_| message("MUSIC_GENERATOR_MCP_PORT must be a number from 0 to 65535"))?,
    };
    let token = match std::env::var("MUSIC_GENERATOR_MCP_TOKEN") {
        Ok(token) => token,
        Err(std::env::VarError::NotPresent) => format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        ),
        Err(_) => return Err(message("MUSIC_GENERATOR_MCP_TOKEN is not valid text")),
    };
    validate_token(&token)?;
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, port))?;
    listener.set_nonblocking(true)?;
    let address = listener.local_addr()?;
    let info = ConnectionInfo {
        url: format!("http://{address}/mcp"),
        token: token.clone(),
        pid: std::process::id(),
    };
    let descriptor = ConnectionFile::create(&state.db.root, info)?;
    let cancellation = state.runtime.cancellation();
    let control = Arc::new(Control {
        descriptor: Mutex::new(Some(descriptor)),
        cancellation: cancellation.clone(),
    });
    app.manage(control.clone());
    let router = router(state, app, address.to_string(), token, cancellation.clone());
    tauri::async_runtime::spawn(async move {
        let result = async {
            let listener = tokio::net::TcpListener::from_std(listener)?;
            axum::serve(listener, router)
                .with_graceful_shutdown(cancellation.cancelled_owned())
                .await
        }
        .await;
        control.stop();
        if let Err(error) = result {
            tracing::error!(%error, "MCP server stopped");
        }
    });
    tracing::info!(%address, "MCP loopback server started; credentials are in the data directory's mcp.json");
    Ok(())
}

/// Remove credentials synchronously before Tauri terminates its asynchronous runtime.
pub fn stop<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(control) = app.try_state::<Arc<Control>>() {
        control.stop();
    }
}

pub(super) fn router<R: tauri::Runtime>(
    state: Arc<AppState>,
    app: tauri::AppHandle<R>,
    authority: String,
    token: String,
    cancellation: tokio_util::sync::CancellationToken,
) -> Router {
    let config = StreamableHttpServerConfig::default()
        .with_legacy_session_mode(false)
        .with_json_response(true)
        .with_allowed_hosts([authority.clone()])
        .enforce_origin_validation()
        .with_max_request_body_bytes(MAX_REQUEST_BYTES)
        .with_cancellation_token(cancellation.clone());
    let service: StreamableHttpService<super::server::MusicServer<R>, LocalSessionManager> =
        StreamableHttpService::new(
            move || Ok(super::server::MusicServer::new(state.clone(), app.clone())),
            Default::default(),
            config,
        );
    Router::new()
        .nest_service("/mcp", service)
        .layer(middleware::from_fn_with_state(
            Access {
                authorization: format!("Bearer {token}"),
                authority,
            },
            authorize,
        ))
}

#[cfg(test)]
#[path = "transport_tests.rs"]
mod tests;
