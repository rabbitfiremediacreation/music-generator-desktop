use crate::{
    engine::progress::Progress,
    error::{message, Error, Result},
};
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::{Notify, OwnedMutexGuard};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OperationKind {
    Startup,
    Setup,
    Models,
    ModelActivation,
    Settings,
    Import,
    Analysis,
    Export,
    Generation,
    StemGeneration,
    CoverArt,
}

impl OperationKind {
    fn blocks_enqueue(self) -> bool {
        matches!(
            self,
            Self::Startup
                | Self::Setup
                | Self::Models
                | Self::ModelActivation
                | Self::Settings
                | Self::Import
        )
    }

    fn reserves_assets(self) -> bool {
        matches!(self, Self::Startup | Self::Setup | Self::Models)
    }
}

#[derive(Clone, serde::Serialize)]
pub struct JobProgress {
    pub job_id: String,
    pub sequence: u64,
    pub overall_percent: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_remaining_seconds: Option<u64>,
    #[serde(flatten)]
    pub progress: Progress,
}

struct Active {
    kind: OperationKind,
    cancel: CancellationToken,
    song: Option<RunningSong>,
    progress: Option<JobProgress>,
}

struct RunningSong {
    id: String,
    title: Option<String>,
    started_at: Instant,
    remaining_time_sample: Option<RemainingTimeSample>,
}

struct RemainingTimeSample {
    elapsed: Duration,
    finish_at_seconds: f64,
}

/// Extrapolate from whole-song progress once startup no longer dominates the estimate.
fn estimate_remaining_seconds(elapsed_seconds: u64, overall_percent: u8) -> Option<u64> {
    if overall_percent >= 100 {
        return Some(0);
    }
    if elapsed_seconds < 5 || overall_percent < 10 {
        return None;
    }
    let unfinished = u64::from(100 - overall_percent);
    Some(
        elapsed_seconds
            .saturating_mul(unfinished)
            .div_ceil(u64::from(overall_percent)),
    )
}

/// Smooth the predicted finish time with a four-second half-life so report frequency
/// does not change how fast the estimate reacts. The remaining time still counts down.
fn smooth_remaining_seconds(
    sample: &mut Option<RemainingTimeSample>,
    elapsed: Duration,
    overall_percent: u8,
) -> Option<u64> {
    let raw = estimate_remaining_seconds(elapsed.as_secs(), overall_percent)?;
    if raw == 0 {
        return Some(0);
    }
    let seconds = elapsed.as_secs_f64();
    let raw_finish = seconds + raw as f64;
    let finish_at_seconds = sample.as_ref().map_or(raw_finish, |previous| {
        let delta = elapsed.saturating_sub(previous.elapsed).as_secs_f64();
        let weight = 1.0 - (-delta / 4.0).exp2();
        previous.finish_at_seconds + weight * (raw_finish - previous.finish_at_seconds)
    });
    *sample = Some(RemainingTimeSample {
        elapsed,
        finish_at_seconds,
    });
    Some((finish_at_seconds - seconds).ceil().max(1.0) as u64)
}

#[derive(Default)]
struct Status {
    configured: bool,
    active: Option<Active>,
    sequence: u64,
    transfers: Vec<(String, String, CancellationToken)>,
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
        if kind.reserves_assets() && !status.transfers.is_empty() {
            return Err(message("download_assets_busy"));
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

    /// Serialize queue admission with configuration admission while generation can continue.
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
        self.ensure_update_allowed(&status)?;
        update()
    }

    /// Keep the audio project available until the current generated layer is published.
    pub(crate) fn remove_stem_project<T>(&self, remove: impl FnOnce() -> Result<T>) -> Result<T> {
        let status = self.status.lock().unwrap();
        self.ensure_update_allowed(&status)?;
        if status
            .active
            .as_ref()
            .is_some_and(|active| active.kind == OperationKind::StemGeneration)
        {
            return Err(message("stem_project_generation_busy"));
        }
        remove()
    }

    fn ensure_update_allowed(&self, status: &Status) -> Result<()> {
        if self.is_shutdown()
            || status
                .active
                .as_ref()
                .is_some_and(|a| a.kind.blocks_enqueue())
        {
            return Err(message("Please wait for the current operation to finish"));
        }
        Ok(())
    }

    pub fn is_busy(&self) -> bool {
        self.status.lock().unwrap().active.is_some()
    }

    /// Include background transfers when deciding whether it is safe to close the app.
    pub(crate) fn has_active_work(&self) -> bool {
        let status = self.status.lock().unwrap();
        status.active.is_some() || !status.transfers.is_empty()
    }
    pub fn progress(&self) -> Option<JobProgress> {
        self.status
            .lock()
            .unwrap()
            .active
            .as_ref()
            .filter(|active| active.kind == OperationKind::Generation)
            .and_then(|a| a.progress.clone())
    }

    /// Snapshot the live progress and the in-memory stem job, whose result is added to its mix.
    pub(crate) fn work_progress(&self) -> (Option<JobProgress>, Option<(String, String)>) {
        let status = self.status.lock().unwrap();
        let Some(active) = &status.active else {
            return (None, None);
        };
        let stem = active
            .song
            .as_ref()
            .and_then(|song| Some((song.id.clone(), song.title.as_ref()?.clone())));
        (active.progress.clone(), stem)
    }
    /// Keep the durable cancellation and the worker signal together across retries.
    pub fn cancel_song(&self, id: &str, cancel: impl FnOnce() -> Result<bool>) -> Result<bool> {
        let status = self.status.lock().unwrap();
        self.ensure_update_allowed(&status)?;
        let cancelled = cancel()?;
        if let Some(active) = status
            .active
            .as_ref()
            .filter(|active| cancelled && active.song.as_ref().is_some_and(|song| song.id == id))
        {
            active.cancel.cancel();
        }
        Ok(cancelled)
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
    pub fn cancel_stem_generation(&self, id: Option<&str>) {
        let status = self.status.lock().unwrap();
        if let Some(active) = status.active.as_ref().filter(|active| {
            active.kind == OperationKind::StemGeneration
                && id.is_none_or(|id| active.song.as_ref().is_some_and(|song| song.id == id))
        }) {
            active.cancel.cancel();
        }
    }
    pub(crate) fn cancel_cover_art(&self, id: &str) {
        let status = self.status.lock().unwrap();
        if let Some(active) = status.active.as_ref().filter(|active| {
            active.kind == OperationKind::CoverArt
                && active.song.as_ref().is_some_and(|song| song.id == id)
        }) {
            active.cancel.cancel();
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

    pub(crate) fn transfer(self: &Arc<Self>, scope: &str, key: &str) -> Result<Transfer> {
        let mut status = self.status.lock().unwrap();
        if self.is_shutdown() {
            return Err(Error::Cancelled);
        }
        if status
            .active
            .as_ref()
            .is_some_and(|active| active.kind.reserves_assets())
            || status
                .transfers
                .iter()
                .any(|(active_scope, active_key, _)| active_scope == scope && active_key == key)
        {
            return Err(message("download_assets_busy"));
        }
        let cancel = self.cancellation();
        status
            .transfers
            .push((scope.to_owned(), key.to_owned(), cancel.clone()));
        Ok(Transfer {
            runtime: self.clone(),
            scope: scope.to_owned(),
            key: key.to_owned(),
            cancel,
        })
    }

    pub(crate) fn cancel_transfer(&self, scope: Option<&str>, key: Option<&str>) -> bool {
        let status = self.status.lock().unwrap();
        if let Some((_, _, token)) = status.transfers.iter().rev().find(|(value, target, _)| {
            scope.is_none_or(|scope| scope == value) && key.is_none_or(|key| key == target)
        }) {
            token.cancel();
            return true;
        }
        false
    }

    pub(crate) fn is_transferring(&self, scope: &str, key: &str) -> bool {
        self.status
            .lock()
            .unwrap()
            .transfers
            .iter()
            .any(|(active_scope, active_key, _)| scope == active_scope && key == active_key)
    }
    pub fn wake(&self) {
        self.wake.notify_one();
    }
    pub async fn wait(&self) {
        tokio::select! { _ = self.shutdown.cancelled() => {}, _ = self.wake.notified() => {} }
    }
}

pub(crate) struct Transfer {
    runtime: Arc<Runtime>,
    scope: String,
    key: String,
    cancel: CancellationToken,
}

impl Transfer {
    pub(crate) fn cancellation(&self) -> CancellationToken {
        self.cancel.clone()
    }
}

impl Drop for Transfer {
    fn drop(&mut self) {
        self.cancel.cancel();
        self.runtime
            .status
            .lock()
            .unwrap()
            .transfers
            .retain(|(scope, key, _)| scope != &self.scope || key != &self.key);
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
        self.start_work(id.to_owned(), None);
    }
    pub(crate) fn start_stem_generation(&self, title: &str) {
        assert_eq!(self.kind, OperationKind::StemGeneration);
        self.start_work(crate::types::id(), Some(title.to_owned()));
    }
    pub(crate) fn start_cover_art(&self, id: &str) {
        assert_eq!(self.kind, OperationKind::CoverArt);
        self.start_work(id.to_owned(), None);
    }
    fn start_work(&self, id: String, title: Option<String>) {
        let mut status = self.runtime.status.lock().unwrap();
        let active = status.active.as_mut().unwrap();
        active.song = Some(RunningSong {
            id,
            title,
            started_at: Instant::now(),
            remaining_time_sample: None,
        });
        active.progress = None;
    }
    pub(crate) fn report(&self, progress: Progress, estimate: u8) -> Option<JobProgress> {
        let mut status = self.runtime.status.lock().unwrap();
        let sequence = status.sequence;
        let active = status.active.as_mut()?;
        let song = active.song.as_mut()?;
        let previous = active
            .progress
            .as_ref()
            .map_or(0, |value| value.overall_percent);
        let overall_percent = estimate.max(previous);
        let update = JobProgress {
            job_id: song.id.clone(),
            sequence,
            overall_percent,
            estimated_remaining_seconds: smooth_remaining_seconds(
                &mut song.remaining_time_sample,
                song.started_at.elapsed(),
                overall_percent,
            ),
            progress,
        };
        active.progress = Some(update.clone());
        status.sequence += 1;
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
