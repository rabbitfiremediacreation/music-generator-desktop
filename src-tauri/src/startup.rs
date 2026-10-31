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
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Instant,
};
use tauri::{AppHandle, Emitter, Manager, Runtime, State, WebviewWindow};
use tokio::sync::{watch, Mutex as AsyncMutex, OnceCell};

mod commands;
mod logging;
mod preparation;
pub use commands::*;

#[cfg(all(test, unix))]
mod tests;

#[derive(Clone, Default, Serialize)]
pub struct Status {
    attempt: u64,
    sequence: u64,
    phase: &'static str,
    error: Option<String>,
}

pub struct Startup {
    root: PathBuf,
    resources: PathBuf,
    started: Instant,
    painted: watch::Sender<u64>,
    painted_ms: AtomicU64,
    initialization: AsyncMutex<()>,
    transition: AsyncMutex<()>,
    automatic_retry: AtomicBool,
    main_shown: AtomicU64,
    main_deadline: Mutex<Option<tokio::time::Instant>>,
    status: Mutex<Status>,
    launch_allowed: OnceCell<bool>,
    log: Mutex<Option<std::fs::File>>,
}

impl Startup {
    pub fn new(root: PathBuf, resources: PathBuf, started: Instant) -> Self {
        Self {
            root,
            resources,
            started,
            painted_ms: AtomicU64::new(0),
            painted: watch::channel(0).0,
            initialization: AsyncMutex::new(()),
            transition: AsyncMutex::new(()),
            automatic_retry: AtomicBool::new(false),
            main_shown: AtomicU64::new(0),
            main_deadline: Mutex::new(None),
            launch_allowed: OnceCell::new(),
            log: Mutex::new(None),
            status: Mutex::new(Status {
                attempt: 1,
                phase: "starting",
                ..Status::default()
            }),
        }
    }

    pub fn snapshot(&self) -> Status {
        self.status.lock().expect("startup status poisoned").clone()
    }

    pub fn ensure_active(&self, attempt: u64) -> Result<()> {
        let status = self.snapshot();
        if status.attempt != attempt || status.error.is_some() || status.phase == "ready" {
            return Err(message("startup_attempt_expired"));
        }
        Ok(())
    }

    pub fn should_exit_on_splash_close(&self) -> bool {
        self.snapshot().phase != "ready"
    }

    fn record(&self, attempt: u64, phase: &'static str, error: Option<String>) -> Option<Status> {
        let mut status = self.status.lock().expect("startup status poisoned");
        if status.attempt != attempt
            || status.phase == "installation_required"
            || status.phase == "ready"
            || status.error.is_some()
        {
            return None;
        }
        status.sequence += 1;
        status.phase = phase;
        status.error = error;
        Some(status.clone())
    }

    pub fn report<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        attempt: u64,
        phase: &'static str,
        error: Option<String>,
    ) {
        let Some(status) = self.record(attempt, phase, error) else {
            return;
        };
        if let Some(error) = &status.error {
            if let Err(logging_error) = self.log_error(attempt, phase, error) {
                eprintln!("Unable to log startup failure: {logging_error}; {error}");
            }
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.hide();
            }
            if let Some(splash) = app.get_webview_window("splash") {
                let _ = splash.show();
                let _ = splash.set_focus();
            }
        }
        tracing::info!(
            elapsed_ms = self.started.elapsed().as_millis(),
            attempt,
            phase,
            "Startup phase"
        );
        let _ = app.emit_to("splash", "startup-status", status);
    }
}
