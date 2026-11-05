//! Desktop-owned MCP preferences. Agents never receive this control surface or credentials.
use super::transport::{self, ConnectionFile, ConnectionInfo};
use crate::{
    error::{message, Result},
    state::AppState,
};
use serde::{Deserialize, Serialize};
use std::{
    ffi::OsString,
    future::IntoFuture,
    io::Write,
    net::{IpAddr, Ipv4Addr, TcpListener},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::Manager;
use tokio_util::sync::CancellationToken;

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum McpScope {
    #[default]
    Local,
    Network,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct McpSettings {
    pub enabled: bool,
    pub port: u16,
    #[serde(default)]
    pub scope: McpScope,
}

impl Default for McpSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            port: 32123,
            scope: McpScope::Local,
        }
    }
}

#[derive(Serialize)]
pub struct McpSettingsStatus {
    pub enabled: bool,
    pub port: u16,
    pub scope: McpScope,
    pub urls: Vec<String>,
    pub running: bool,
    pub url: Option<String>,
    pub config_path: String,
    pub client_config: String,
    pub managed_by_environment: bool,
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct McpHttpConnection {
    pub url: String,
    pub token: String,
    pub client_config: String,
}

#[derive(Default)]
struct Environment {
    port: Option<OsString>,
    token: Option<OsString>,
}
impl Environment {
    fn read() -> Self {
        Self {
            port: std::env::var_os("MUSIC_GENERATOR_MCP_PORT"),
            token: std::env::var_os("MUSIC_GENERATOR_MCP_TOKEN"),
        }
    }
    fn preferences(&self) -> Result<Option<McpSettings>> {
        self.port
            .as_ref()
            .map(|port| {
                let port = port
                    .to_str()
                    .and_then(|value| value.parse::<u16>().ok())
                    .ok_or_else(|| {
                        message("MUSIC_GENERATOR_MCP_PORT must be a number from 0 to 65535")
                    })?;
                Ok(McpSettings {
                    enabled: true,
                    port,
                    scope: McpScope::Local,
                })
            })
            .transpose()
    }
    fn token(&self, root: &Path) -> Result<String> {
        let token = match &self.token {
            Some(value) => value
                .to_str()
                .ok_or_else(|| message("MUSIC_GENERATOR_MCP_TOKEN is not valid text"))?
                .to_owned(),
            None => {
                let path = root.join("mcp-token");
                match std::fs::read_to_string(&path) {
                    Ok(token) => token,
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                        let token = format!(
                            "{}{}",
                            uuid::Uuid::new_v4().simple(),
                            uuid::Uuid::new_v4().simple()
                        );
                        write_private(&path, token.as_bytes())?;
                        token
                    }
                    Err(error) => return Err(error.into()),
                }
            }
        };
        transport::validate_token(&token)?;
        Ok(token)
    }
}

struct Server {
    descriptor: Mutex<Option<ConnectionFile>>,
    url: String,
    urls: Vec<String>,
    port: u16,
    cancellation: CancellationToken,
    closed: tokio::sync::watch::Receiver<bool>,
    error: Mutex<Option<String>>,
}
impl Server {
    fn stop(&self) {
        self.cancellation.cancel();
        self.descriptor.lock().unwrap().take();
    }
    async fn wait_closed(&self) {
        let mut closed = self.closed.clone();
        let _ =
            tokio::time::timeout(Duration::from_secs(2), closed.wait_for(|closed| *closed)).await;
    }
}

#[derive(Default)]
struct Current {
    shutdown: bool,
    settings: McpSettings,
    server: Option<Arc<Server>>,
    error: Option<String>,
}
struct Control {
    root: PathBuf,
    environment: Environment,
    current: Mutex<Current>,
    change: Arc<tokio::sync::Mutex<()>>,
}

pub(super) fn write_private(path: &Path, bytes: &[u8]) -> Result<()> {
    // NamedTempFile is private on Unix and atomically replaces existing files on Windows too.
    let mut temporary = tempfile::NamedTempFile::new_in(
        path.parent()
            .ok_or_else(|| message("Missing MCP settings directory"))?,
    )?;
    temporary.write_all(bytes)?;
    temporary.as_file().sync_all()?;
    temporary.persist(path).map_err(|error| error.error)?;
    Ok(())
}

impl Control {
    fn http_connection(&self, url: &str) -> Result<McpHttpConnection> {
        let current = self.current.lock().unwrap();
        let server = current
            .server
            .as_ref()
            .filter(|server| {
                !current.shutdown
                    && !server.cancellation.is_cancelled()
                    && server.urls.iter().any(|candidate| candidate == url)
            })
            .ok_or_else(|| message("Select an address of the running MCP service"))?;
        let descriptor = server.descriptor.lock().unwrap();
        let descriptor = descriptor
            .as_ref()
            .ok_or_else(|| message("MCP service is stopped"))?;
        let token = descriptor.info.token.clone();
        let client_config =
            serde_json::to_string_pretty(&serde_json::json!({"mcpServers":{"music-generator":{
                "url":url,"headers":{"Authorization":format!("Bearer {token}")}
            }}}))?;
        Ok(McpHttpConnection {
            url: url.into(),
            token,
            client_config,
        })
    }

    async fn configure<R: tauri::Runtime>(
        self: &Arc<Self>,
        state: Arc<AppState>,
        app: tauri::AppHandle<R>,
        settings: McpSettings,
    ) -> Result<McpSettingsStatus> {
        let _gate = self.change.clone().lock_owned().await;
        if self.environment.port.is_some() {
            return Err(message("MCP is managed by MUSIC_GENERATOR_MCP_PORT; remove the environment override and restart to edit these settings"));
        }
        // An IPv4 wildcard and a loopback listener cannot share the same fixed port.
        // Save the exact previous endpoint so a failed scope change can restore it.
        let rebind = {
            let current = self.current.lock().unwrap();
            current
                .server
                .as_ref()
                .filter(|server| {
                    settings.enabled
                        && !server.cancellation.is_cancelled()
                        && settings.scope != current.settings.scope
                        && settings.port == server.port
                })
                .map(|server| (current.settings, server.clone()))
        };
        if let Some((_, server)) = &rebind {
            server.stop();
            server.wait_closed().await;
        }
        let saved = self.clone();
        let target_state = state.clone();
        let target_app = app.clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            saved.apply(target_state, target_app, settings, true)
        })
        .await
        .map_err(|error| message(error.to_string()))?;
        match result {
            Ok(previous) => {
                if let Some(server) = previous {
                    server.wait_closed().await;
                }
                self.status()
            }
            Err(error) => {
                if let Some((previous, server)) = rebind {
                    let control = self.clone();
                    let restore = tauri::async_runtime::spawn_blocking(move || {
                        control.apply(
                            state,
                            app,
                            McpSettings {
                                port: server.port,
                                ..previous
                            },
                            false,
                        )?;
                        control.current.lock().unwrap().settings = previous;
                        Ok::<_, crate::error::Error>(())
                    })
                    .await
                    .map_err(|error| message(error.to_string()))?;
                    if let Err(restore) = restore {
                        let detail = format!(
                            "{error}; previous MCP service could not be restored: {restore}"
                        );
                        self.current.lock().unwrap().error = Some(detail.clone());
                        return Err(message(detail));
                    }
                }
                Err(error)
            }
        }
    }

    fn new(root: PathBuf, environment: Environment) -> Self {
        let mut current = Current::default();
        let loaded = (|| -> Result<McpSettings> {
            if let Some(settings) = environment.preferences()? {
                return Ok(settings);
            }
            match std::fs::read(root.join("mcp-settings.json")) {
                Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    Ok(McpSettings::default())
                }
                Err(error) => Err(error.into()),
            }
        })();
        match loaded {
            Ok(settings) => current.settings = settings,
            Err(error) => current.error = Some(error.to_string()),
        }
        Self {
            root,
            environment,
            current: Mutex::new(current),
            change: Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    fn status(&self) -> Result<McpSettingsStatus> {
        let current = self.current.lock().unwrap();
        self.status_locked(&current)
    }
    fn status_locked(&self, current: &Current) -> Result<McpSettingsStatus> {
        let running = current
            .server
            .as_ref()
            .is_some_and(|server| !server.cancellation.is_cancelled());
        let executable = std::env::current_exe()?;
        #[cfg(target_os = "linux")]
        let executable = std::env::var_os("APPIMAGE")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .unwrap_or(executable);
        #[cfg(windows)]
        let executable = executable.with_file_name("music-generator-mcp.exe");
        let descriptor = self.root.join("mcp.json");
        let config = serde_json::json!({"mcpServers":{"music-generator":{
            "command":executable,"args":["--mcp-stdio",descriptor]
        }}});
        Ok(McpSettingsStatus {
            enabled: current.settings.enabled,
            port: current.settings.port,
            scope: current.settings.scope,
            urls: current
                .server
                .as_ref()
                .filter(|_| running)
                .map(|server| server.urls.clone())
                .unwrap_or_default(),
            running,
            url: current
                .server
                .as_ref()
                .filter(|_| running)
                .map(|server| server.url.clone()),
            config_path: descriptor.to_string_lossy().into_owned(),
            client_config: serde_json::to_string_pretty(&config)?,
            managed_by_environment: self.environment.port.is_some(),
            error: current.error.clone().or_else(|| {
                current
                    .server
                    .as_ref()
                    .and_then(|server| server.error.lock().unwrap().clone())
            }),
        })
    }

    fn apply<R: tauri::Runtime>(
        &self,
        state: Arc<AppState>,
        app: tauri::AppHandle<R>,
        settings: McpSettings,
        persist: bool,
    ) -> Result<Option<Arc<Server>>> {
        if persist && self.environment.port.is_some() {
            return Err(message("MCP is managed by MUSIC_GENERATOR_MCP_PORT; remove the environment override and restart to edit these settings"));
        }
        if state.runtime.is_shutdown() {
            return Err(message("The desktop application is shutting down"));
        }
        let mut current = self.current.lock().unwrap();
        if current.shutdown {
            return Err(message("The desktop application is shutting down"));
        }
        let healthy = current
            .server
            .as_ref()
            .is_some_and(|server| !server.cancellation.is_cancelled());
        if settings == current.settings && healthy {
            if persist {
                write_private(
                    &self.root.join("mcp-settings.json"),
                    &serde_json::to_vec_pretty(&settings)?,
                )?;
            }
            current.error = None;
            return Ok(None);
        }
        // Bind first: a port conflict cannot interrupt the working server or change saved settings.
        let prepared = if settings.enabled {
            let token = self.environment.token(&self.root)?;
            let bind = match settings.scope {
                McpScope::Local => Ipv4Addr::LOCALHOST,
                McpScope::Network => Ipv4Addr::UNSPECIFIED,
            };
            if settings.scope == McpScope::Network && settings.port != 0 {
                // BSD may allow a reusable wildcard socket beside another service's
                // specific-address listener. Detect that conflict before advertising it.
                let mut probes = Vec::new();
                for authority in authorities(settings.scope, settings.port) {
                    let address: std::net::SocketAddrV4 =
                        authority.parse().expect("IPv4 authority");
                    probes.push(bind_listener(*address.ip(), address.port())?);
                }
            }
            let listener = bind_listener(bind, settings.port)?;
            let address = listener.local_addr()?;
            Some((
                listener,
                ConnectionInfo {
                    url: format!("http://127.0.0.1:{}/mcp", address.port()),
                    token,
                    pid: std::process::id(),
                },
            ))
        } else {
            None
        };
        let path = self.root.join("mcp-settings.json");
        let previous = if persist {
            let previous = match std::fs::read(&path) {
                Ok(bytes) => Some(bytes),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                Err(error) => return Err(error.into()),
            };
            write_private(&path, &serde_json::to_vec_pretty(&settings)?)?;
            previous
        } else {
            None
        };
        // Serialize old descriptor cleanup with replacement publication. Otherwise its
        // read-then-remove Drop could erase a newly published connection file.
        let old_server = current.server.clone();
        let mut old_descriptor = old_server
            .as_ref()
            .map(|server| server.descriptor.lock().unwrap());
        let next = if let Some((listener, info)) = prepared {
            let descriptor = match ConnectionFile::create(&self.root, info.clone()) {
                Ok(descriptor) => descriptor,
                Err(error) => {
                    if persist {
                        let rollback = match previous {
                            Some(bytes) => write_private(&path, &bytes),
                            None => std::fs::remove_file(&path).map_err(Into::into),
                        };
                        if let Err(rollback) = rollback {
                            return Err(message(format!(
                                "{error}; could not restore MCP preferences: {rollback}"
                            )));
                        }
                    }
                    return Err(error);
                }
            };
            Some(serve(
                state,
                app,
                listener,
                descriptor,
                info,
                settings.scope,
            ))
        } else {
            None
        };
        if let Some(descriptor) = &mut old_descriptor {
            descriptor.take();
        }
        drop(old_descriptor);
        let previous = std::mem::replace(&mut current.server, next);
        if let Some(server) = &previous {
            server.stop();
        }
        current.settings = settings;
        current.error = None;
        Ok(previous)
    }
}

fn authorities(scope: McpScope, port: u16) -> Vec<String> {
    let mut addresses = Vec::new();
    if scope == McpScope::Network {
        for network in sysinfo::Networks::new_with_refreshed_list().values() {
            for subnet in network.ip_networks() {
                if let IpAddr::V4(address) = subnet.addr {
                    if !address.is_loopback()
                        && !address.is_unspecified()
                        && !address.is_multicast()
                        && !address.is_broadcast()
                    {
                        addresses.push(address);
                    }
                }
            }
        }
        addresses.sort_unstable();
        addresses.dedup();
    }
    addresses.push(Ipv4Addr::LOCALHOST);
    addresses
        .into_iter()
        .map(|address| format!("{address}:{port}"))
        .collect()
}

fn bind_listener(address: Ipv4Addr, port: u16) -> Result<TcpListener> {
    let socket = tokio::net::TcpSocket::new_v4()?;
    // Restart without waiting for old connections' TIME_WAIT on Unix. Windows has
    // different reuse semantics; never enable shared binding there.
    #[cfg(unix)]
    socket.set_reuseaddr(true)?;
    socket.bind((address, port).into())?;
    Ok(socket.listen(128)?.into_std()?)
}

fn serve<R: tauri::Runtime>(
    state: Arc<AppState>,
    app: tauri::AppHandle<R>,
    listener: TcpListener,
    descriptor: ConnectionFile,
    info: ConnectionInfo,
    scope: McpScope,
) -> Arc<Server> {
    let cancellation = state.runtime.cancellation();
    let (closed, receiver) = tokio::sync::watch::channel(false);
    let port = listener.local_addr().expect("bound MCP listener").port();
    let authorities = authorities(scope, port);
    let urls = authorities
        .iter()
        .map(|authority| format!("http://{authority}/mcp"))
        .collect();
    let server = Arc::new(Server {
        descriptor: Mutex::new(Some(descriptor)),
        url: info.url,
        urls,
        port,
        cancellation: cancellation.clone(),
        closed: receiver,
        error: Mutex::new(None),
    });
    let control = server.clone();
    let router = transport::router(state, app, authorities, info.token, cancellation.clone());
    tauri::async_runtime::spawn(async move {
        let result = async {
            let listener = tokio::net::TcpListener::from_std(listener)?;
            let shutdown = cancellation.clone();
            let serving = axum::serve(listener, router).with_graceful_shutdown(shutdown.cancelled_owned()).into_future();
            tokio::pin!(serving);
            tokio::select! {
                result = &mut serving => result,
                _ = cancellation.cancelled() => {
                    // Release the listener even if an old client leaves a request open.
                    tokio::time::timeout(Duration::from_secs(1), &mut serving).await.unwrap_or(Ok(()))
                }
            }
        }.await;
        if let Err(error) = result {
            *control.error.lock().unwrap() = Some(error.to_string());
            tracing::error!(%error, "MCP server stopped");
        }
        control.stop();
        let _ = closed.send(true);
    });
    server
}

pub(super) fn start<R: tauri::Runtime>(
    state: Arc<AppState>,
    app: tauri::AppHandle<R>,
) -> Result<()> {
    start_with_environment(state, app, Environment::read())
}

fn start_with_environment<R: tauri::Runtime>(
    state: Arc<AppState>,
    app: tauri::AppHandle<R>,
    environment: Environment,
) -> Result<()> {
    let control = Arc::new(Control::new(state.db.root.clone(), environment));
    let settings = control.current.lock().unwrap().settings;
    if !app.manage(control.clone()) {
        return Ok(());
    }
    // A prior crashed process may have left credentials, including when MCP is now disabled.
    if let Err(error) = std::fs::remove_file(control.root.join("mcp.json")) {
        if error.kind() != std::io::ErrorKind::NotFound {
            control.current.lock().unwrap().error = Some(error.to_string());
            return Err(error.into());
        }
    }
    if control.current.lock().unwrap().error.is_some() {
        return Ok(());
    }
    if let Err(error) = control.apply(state, app, settings, false) {
        control.current.lock().unwrap().error = Some(error.to_string());
        return Err(error);
    }
    Ok(())
}

pub(super) fn stop<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(control) = app.try_state::<Arc<Control>>() {
        let mut current = control.current.lock().unwrap();
        current.shutdown = true;
        if let Some(server) = &current.server {
            server.stop();
        }
    }
}

#[tauri::command]
pub fn get_mcp_settings(app: tauri::AppHandle) -> Result<McpSettingsStatus> {
    app.try_state::<Arc<Control>>()
        .ok_or_else(|| message("MCP settings are not ready"))?
        .status()
}

#[tauri::command]
pub fn get_mcp_http_connection(app: tauri::AppHandle, url: String) -> Result<McpHttpConnection> {
    app.try_state::<Arc<Control>>()
        .ok_or_else(|| message("MCP settings are not ready"))?
        .http_connection(&url)
}

#[tauri::command]
pub async fn save_mcp_settings(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<AppState>>,
    settings: McpSettings,
) -> Result<McpSettingsStatus> {
    let control = app
        .try_state::<Arc<Control>>()
        .ok_or_else(|| message("MCP settings are not ready"))?
        .inner()
        .clone();
    let state = state.inner().clone();
    tauri::async_runtime::spawn(async move { control.configure(state, app, settings).await })
        .await
        .map_err(|error| message(error.to_string()))?
}

#[cfg(test)]
#[path = "settings_tests.rs"]
mod tests;
