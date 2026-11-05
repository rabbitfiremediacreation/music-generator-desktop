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
    net::{Ipv4Addr, TcpListener},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::Manager;
use tokio_util::sync::CancellationToken;

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct McpSettings {
    pub enabled: bool,
    pub port: u16,
}

#[derive(Serialize)]
pub struct McpSettingsStatus {
    pub enabled: bool,
    pub port: u16,
    pub running: bool,
    pub url: Option<String>,
    pub config_path: String,
    pub client_config: String,
    pub managed_by_environment: bool,
    pub error: Option<String>,
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
                })
            })
            .transpose()
    }
    fn token(&self) -> Result<String> {
        let token = match &self.token {
            Some(value) => value
                .to_str()
                .ok_or_else(|| message("MUSIC_GENERATOR_MCP_TOKEN is not valid text"))?
                .to_owned(),
            None => format!(
                "{}{}",
                uuid::Uuid::new_v4().simple(),
                uuid::Uuid::new_v4().simple()
            ),
        };
        transport::validate_token(&token)?;
        Ok(token)
    }
}

struct Server {
    descriptor: Mutex<Option<ConnectionFile>>,
    url: String,
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
            let token = self.environment.token()?;
            let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, settings.port))?;
            listener.set_nonblocking(true)?;
            let address = listener.local_addr()?;
            Some((
                listener,
                ConnectionInfo {
                    url: format!("http://{address}/mcp"),
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
            Some(serve(state, app, listener, descriptor, info))
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

fn serve<R: tauri::Runtime>(
    state: Arc<AppState>,
    app: tauri::AppHandle<R>,
    listener: TcpListener,
    descriptor: ConnectionFile,
    info: ConnectionInfo,
) -> Arc<Server> {
    let cancellation = state.runtime.cancellation();
    let (closed, receiver) = tokio::sync::watch::channel(false);
    let server = Arc::new(Server {
        descriptor: Mutex::new(Some(descriptor)),
        url: info.url,
        cancellation: cancellation.clone(),
        closed: receiver,
        error: Mutex::new(None),
    });
    let control = server.clone();
    let authority = listener
        .local_addr()
        .expect("bound MCP listener")
        .to_string();
    let router = transport::router(state, app, authority, info.token, cancellation.clone());
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
    tauri::async_runtime::spawn(async move {
        let _gate = control.change.clone().lock_owned().await;
        let saved = control.clone();
        // Accepted writes and serialization survive the invoking window closing.
        let previous =
            tauri::async_runtime::spawn_blocking(move || saved.apply(state, app, settings, true))
                .await
                .map_err(|error| message(error.to_string()))??;
        if let Some(server) = previous {
            server.wait_closed().await;
        }
        control.status()
    })
    .await
    .map_err(|error| message(error.to_string()))?
}

#[cfg(test)]
#[path = "settings_tests.rs"]
mod tests;
