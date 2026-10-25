use crate::{
    db,
    error::{message, Result},
    jobs, sandbox,
    state::AppState,
};
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Instant,
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tokio::sync::{watch, Mutex as AsyncMutex};

#[derive(Clone, Default, Serialize)]
pub struct Status {
    sequence: u64,
    phase: &'static str,
    error: Option<String>,
}

pub struct Startup {
    root: PathBuf,
    resources: PathBuf,
    started: Instant,
    painted: watch::Sender<bool>,
    painted_ms: AtomicU64,
    initialization: AsyncMutex<()>,
    status: Mutex<Status>,
}

impl Startup {
    pub fn new(root: PathBuf, resources: PathBuf, started: Instant) -> Self {
        Self {
            root,
            resources,
            started,
            painted_ms: AtomicU64::new(0),
            painted: watch::channel(false).0,
            initialization: AsyncMutex::new(()),
            status: Mutex::new(Status {
                phase: "starting",
                ..Status::default()
            }),
        }
    }

    pub fn report(&self, app: &AppHandle, phase: &'static str, error: Option<String>) {
        let status = {
            let mut status = self.status.lock().expect("startup status poisoned");
            status.sequence += 1;
            status.phase = phase;
            status.error = error;
            status.clone()
        };
        tracing::info!(
            elapsed_ms = self.started.elapsed().as_millis(),
            phase,
            "Startup phase"
        );
        let _ = app.emit_to("splash", "startup-status", status);
    }

    /// Defer disk access until the splash has painted; serialize retries and reuse successful state.
    pub async fn prepare(&self, app: &AppHandle) -> Result<Arc<AppState>> {
        let mut painted = self.painted.subscribe();
        tokio::time::timeout(
            std::time::Duration::from_secs(15),
            painted.wait_for(|ready| *ready),
        )
        .await
        .map_err(|_| message("The startup window did not become ready. Please restart the app."))?
        .map_err(|e| message(e.to_string()))?;
        let _guard = self.initialization.lock().await;
        if let Some(state) = app.try_state::<Arc<AppState>>() {
            return Ok(state.inner().clone());
        }
        self.report(app, "data", None);
        let root = self.root.clone();
        let resources = self.resources.clone();
        let state = tauri::async_runtime::spawn_blocking(move || -> Result<Arc<AppState>> {
            std::fs::create_dir_all(root.join("logs"))?;
            let log = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(root.join("logs/desktop.log"))?;
            let _ = tracing_subscriber::fmt()
                .with_ansi(false)
                .with_writer(Mutex::new(log))
                .try_init();
            let db = db::Database::open(&root)?;
            sandbox::initialize(&root)?;
            Ok(Arc::new(AppState::new(db, resources)))
        })
        .await
        .map_err(|e| message(e.to_string()))??;
        tracing::info!(
            elapsed_ms = self.started.elapsed().as_millis(),
            splash_ms = self.painted_ms.load(Ordering::Relaxed),
            "Startup data initialization finished"
        );
        app.manage(state.clone());
        tauri::async_runtime::spawn(jobs::worker(state.clone(), app.clone()));
        Ok(state)
    }
}

#[tauri::command]
pub fn startup_status(startup: State<'_, Startup>) -> Status {
    startup
        .status
        .lock()
        .expect("startup status poisoned")
        .clone()
}

#[tauri::command]
pub fn splash_ready(window: WebviewWindow, startup: State<'_, Startup>) -> Result<()> {
    require_window(&window, "splash")?;
    startup.painted_ms.store(
        startup.started.elapsed().as_millis() as u64,
        Ordering::Relaxed,
    );
    startup.painted.send_replace(true);
    Ok(())
}

#[tauri::command]
pub fn startup_error(
    window: WebviewWindow,
    startup: State<'_, Startup>,
    app: AppHandle,
    error: String,
) -> Result<()> {
    require_window(&window, "main")?;
    startup.report(&app, "error", Some(error));
    Ok(())
}

#[tauri::command]
pub fn retry_startup(
    window: WebviewWindow,
    startup: State<'_, Startup>,
    app: AppHandle,
) -> Result<()> {
    require_window(&window, "splash")?;
    if startup
        .status
        .lock()
        .expect("startup status poisoned")
        .error
        .is_none()
    {
        return Err(message("Startup is still running"));
    }
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| message("Main window is unavailable"))?;
    startup.report(&app, "starting", None);
    if let Err(error) = main.reload() {
        startup.report(&app, "error", Some(error.to_string()));
        return Err(message(error.to_string()));
    }
    Ok(())
}

#[tauri::command]
pub fn startup_complete(
    window: WebviewWindow,
    startup: State<'_, Startup>,
    app: AppHandle,
) -> Result<()> {
    require_window(&window, "main")?;
    window.show().map_err(|e| message(e.to_string()))?;
    let _ = window.set_focus();
    startup.report(&app, "ready", None);
    if let Some(splash) = app.get_webview_window("splash") {
        splash.destroy().map_err(|e| message(e.to_string()))?;
    }
    Ok(())
}

fn require_window(window: &WebviewWindow, label: &str) -> Result<()> {
    if window.label() == label {
        Ok(())
    } else {
        Err(message("Unavailable in this window"))
    }
}
