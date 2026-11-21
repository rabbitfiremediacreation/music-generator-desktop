use super::DownloadProgress;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Runtime};

/// Clear the latest progress on completion, cancellation or failure.
pub(crate) struct ProgressEvents<'a, R: Runtime> {
    app: &'a AppHandle<R>,
    event: &'static str,
    reported: AtomicBool,
}

impl<'a, R: Runtime> ProgressEvents<'a, R> {
    pub(crate) fn new(app: &'a AppHandle<R>, event: &'static str) -> Self {
        Self {
            app,
            event,
            reported: AtomicBool::new(false),
        }
    }

    pub(crate) fn report(&self, progress: DownloadProgress) {
        self.reported.store(true, Ordering::Relaxed);
        let _ = self.app.emit(self.event, progress);
    }

    pub(crate) fn clear(&self) {
        if self.reported.swap(false, Ordering::Relaxed) {
            let _ = self.app.emit(self.event, Option::<DownloadProgress>::None);
        }
    }
}

impl<R: Runtime> Drop for ProgressEvents<'_, R> {
    fn drop(&mut self) {
        self.clear();
    }
}
