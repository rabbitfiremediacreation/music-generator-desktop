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
    path::{Path, PathBuf},
    sync::Arc,
};

pub(super) const MAX_REQUEST_BYTES: usize = 1024 * 1024;

#[derive(Clone, Deserialize, Serialize)]
pub(super) struct ConnectionInfo {
    pub url: String,
    pub token: String,
    pub pid: u32,
}

pub(super) struct ConnectionFile {
    pub(super) path: PathBuf,
    pub(super) info: ConnectionInfo,
}

impl ConnectionFile {
    pub(super) fn create(root: &Path, info: ConnectionInfo) -> Result<Self> {
        let path = root.join("mcp.json");
        super::settings::write_private(&path, &serde_json::to_vec_pretty(&info)?)?;
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
    cancellation: tokio_util::sync::CancellationToken,
}

impl Access {
    fn check(&self, headers: &HeaderMap) -> std::result::Result<(), StatusCode> {
        if self.cancellation.is_cancelled() {
            return Err(StatusCode::SERVICE_UNAVAILABLE);
        }
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
        Ok(()) => tokio::select! {
            biased;
            _ = access.cancellation.cancelled() => StatusCode::SERVICE_UNAVAILABLE.into_response(),
            response = next.run(request) => response,
        },
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

/// Register settings after desktop state initialization, then apply the startup configuration.
pub fn start<R: tauri::Runtime>(state: Arc<AppState>, app: tauri::AppHandle<R>) -> Result<()> {
    super::settings::start(state, app)
}

/// Remove credentials synchronously before Tauri terminates its asynchronous runtime.
pub fn stop<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    super::settings::stop(app);
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
                cancellation,
            },
            authorize,
        ))
}

#[cfg(test)]
#[path = "transport_tests.rs"]
mod tests;
