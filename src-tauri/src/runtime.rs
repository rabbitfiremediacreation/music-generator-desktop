use crate::{
    engine::progress::Progress,
    error::{message, Error, Result},
};
use std::sync::{Arc, Mutex};
use tokio::sync::{Notify, OwnedMutexGuard};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OperationKind {
    Startup,
    Setup,
    Models,
    Settings,
    Import,
    Analysis,
    Generation,
}

impl OperationKind {
    fn blocks_enqueue(self) -> bool {
        matches!(
            self,
            Self::Startup | Self::Setup | Self::Models | Self::Settings | Self::Import
        )
    }
}

#[derive(Clone, serde::Serialize)]
pub struct JobProgress {
    pub job_id: String,
    pub sequence: u64,
    #[serde(flatten)]
    pub progress: Progress,
}

struct Active {
    kind: OperationKind,
    cancel: CancellationToken,
    song: Option<String>,
    progress: Option<JobProgress>,
}

#[derive(Default)]
struct Status {
    configured: bool,
    active: Option<Active>,
    sequence: u64,
}

/// Owns operation admission, cancellation and observable job state, independently of engines.
#[derive(Default)]
pub struct Runtime {
    gate: Arc<tokio::sync::Mutex<()>>,
    status: Mutex<Status>,
    shutdown: CancellationToken,
    wake: Notify,
}

impl Runtime {
    pub async fn begin(self: &Arc<Self>, kind: OperationKind) -> Result<Operation> {
        let lock = tokio::select! {
            _ = self.shutdown.cancelled() => return Err(Error::Cancelled),
            lock = self.gate.clone().lock_owned() => lock,
        };
        self.enter(kind, lock)
    }

    pub fn try_begin(self: &Arc<Self>, kind: OperationKind) -> Result<Operation> {
        let lock = self
            .gate
            .clone()
            .try_lock_owned()
            .map_err(|_| message("Please wait for the current operation to finish"))?;
        self.enter(kind, lock)
    }

    fn enter(
        self: &Arc<Self>,
        kind: OperationKind,
        lock: OwnedMutexGuard<()>,
    ) -> Result<Operation> {
        let mut status = self.status.lock().unwrap();
        if self.is_shutdown() {
            return Err(Error::Cancelled);
        }
        let cancel = self.shutdown.child_token();
        status.active = Some(Active {
            kind,
            cancel: cancel.clone(),
            song: None,
            progress: None,
        });
        Ok(Operation {
            runtime: self.clone(),
            _lock: lock,
            kind,
            cancel,
        })
    }

    pub fn set_configured(&self, configured: bool) {
        self.status.lock().unwrap().configured = configured;
        self.wake();
    }

    pub fn is_ready(&self) -> bool {
        self.status.lock().unwrap().configured && !self.is_shutdown()
    }

    /// Serialize queue admission with configuration admission without blocking an active song.
    pub fn enqueue<T>(&self, enqueue: impl FnOnce() -> Result<T>) -> Result<T> {
        let status = self.status.lock().unwrap();
        if !status.configured
            || self.is_shutdown()
            || status
                .active
                .as_ref()
                .is_some_and(|a| a.kind.blocks_enqueue())
        {
            return Err(message(
                "Complete model setup and wait for configuration changes before generating music",
            ));
        }
        let result = enqueue();
        drop(status);
        if result.is_ok() {
            self.wake();
        }
        result
    }

    /// Serialize preference writes with queue admission, without stopping an active engine job.
    pub fn update_preferences<T>(&self, update: impl FnOnce() -> Result<T>) -> Result<T> {
        let status = self.status.lock().unwrap();
        if self.is_shutdown()
            || status
                .active
                .as_ref()
                .is_some_and(|a| a.kind.blocks_enqueue())
        {
            return Err(message("Please wait for the current operation to finish"));
        }
        update()
    }

    pub fn is_busy(&self) -> bool {
        self.status.lock().unwrap().active.is_some()
    }
    pub fn progress(&self) -> Option<JobProgress> {
        self.status
            .lock()
            .unwrap()
            .active
            .as_ref()
            .and_then(|a| a.progress.clone())
    }
    pub fn cancel_song(&self, id: &str) {
        if let Some(active) = &self.status.lock().unwrap().active {
            if active.song.as_deref() == Some(id) {
                active.cancel.cancel();
            }
        }
    }
    pub fn cancel_configuration(&self) {
        if let Some(active) = &self.status.lock().unwrap().active {
            if matches!(
                active.kind,
                OperationKind::Setup
                    | OperationKind::Models
                    | OperationKind::Import
                    | OperationKind::Settings
            ) {
                active.cancel.cancel();
            }
        }
    }
    pub fn shutdown(&self) {
        self.shutdown.cancel();
        self.wake();
    }
    pub fn is_shutdown(&self) -> bool {
        self.shutdown.is_cancelled()
    }
    pub fn cancellation(&self) -> CancellationToken {
        self.shutdown.child_token()
    }
    pub fn wake(&self) {
        self.wake.notify_one();
    }
    pub async fn wait(&self) {
        tokio::select! { _ = self.shutdown.cancelled() => {}, _ = self.wake.notified() => {} }
    }
}

/// The exclusive permit survives moves into blocking work and cleans up on error or task abort.
pub struct Operation {
    runtime: Arc<Runtime>,
    _lock: OwnedMutexGuard<()>,
    kind: OperationKind,
    cancel: CancellationToken,
}

impl Operation {
    pub fn cancellation(&self) -> CancellationToken {
        self.cancel.clone()
    }
    pub fn kind(&self) -> OperationKind {
        self.kind
    }
    pub(crate) fn belongs_to(&self, runtime: &Arc<Runtime>) -> bool {
        Arc::ptr_eq(&self.runtime, runtime)
    }
    pub(crate) fn start_song(&self, id: &str) {
        assert_eq!(self.kind, OperationKind::Generation);
        self.runtime
            .status
            .lock()
            .unwrap()
            .active
            .as_mut()
            .unwrap()
            .song = Some(id.into());
    }
    pub(crate) fn report(&self, progress: Progress) -> Option<JobProgress> {
        let mut status = self.runtime.status.lock().unwrap();
        let id = status.active.as_ref()?.song.clone()?;
        let update = JobProgress {
            job_id: id,
            sequence: status.sequence,
            progress,
        };
        status.sequence += 1;
        status.active.as_mut()?.progress = Some(update.clone());
        Some(update)
    }
}

impl Drop for Operation {
    fn drop(&mut self) {
        self.cancel.cancel();
        self.runtime.status.lock().unwrap().active = None;
        if self.kind != OperationKind::Generation {
            self.runtime.wake();
        }
    }
}

#[cfg(test)]
mod tests;
