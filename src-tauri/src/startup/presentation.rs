use super::*;

#[cfg(any(windows, test))]
mod recovery;
#[cfg(windows)]
pub(super) mod windows;

pub(super) async fn show<R: Runtime>(window: &WebviewWindow<R>) -> Result<()> {
    window.show().map_err(|e| message(e.to_string()))?;
    Ok(())
}

impl Startup {
    // Completion is called only after the existing frontend frame handshake.
    // Keep recovery inside the original deadline and transition lock.
    pub(super) async fn finish_main<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        attempt: u64,
        recovery: impl std::future::Future<Output = Result<()>>,
    ) -> Result<()> {
        let deadline = self
            .main_deadline
            .lock()
            .expect("startup deadline poisoned")
            .ok_or_else(|| message("startup_main_not_shown"))?;
        let _ = self.log_diagnostic(
            attempt,
            "Main frontend frames acknowledged; pixels unverified",
        );
        let result = tokio::time::timeout_at(deadline, recovery)
            .await
            .unwrap_or_else(|_| Err(message("startup_main_timeout")))
            .and_then(|()| self.with_pending_presentation(attempt, || Ok(())));
        if let Err(error) = result {
            self.report(app, attempt, "error", Some(error.to_string()));
            return Err(error);
        }
        Ok(())
    }

    // The caller holds transition throughout this bounded operation. Neither another
    // show request nor startup_complete may overtake native presentation.
    pub(super) async fn present_main<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        attempt: u64,
        deadline: tokio::time::Instant,
        presentation: impl std::future::Future<Output = Result<()>>,
    ) -> Result<()> {
        let _ = self.log_diagnostic(attempt, "Main presentation requested");
        let result = tokio::time::timeout_at(deadline, presentation)
            .await
            .unwrap_or_else(|_| Err(message("startup_main_timeout")));
        // A ready future can win timeout_at even after the deadline.
        let result = result.and_then(|()| {
            self.ensure_active(attempt)?;
            if tokio::time::Instant::now() >= deadline {
                return Err(message("startup_main_timeout"));
            }
            Ok(())
        });
        if let Err(error) = result {
            self.report(app, attempt, "error", Some(error.to_string()));
            return Err(error);
        }
        self.main_shown.store(attempt, Ordering::Relaxed);
        let _ = self.log_diagnostic(
            attempt,
            "Main presentation completed; awaiting frontend frames",
        );
        Ok(())
    }

    fn with_pending_presentation<T>(
        &self,
        attempt: u64,
        operation: impl FnOnce() -> Result<T>,
    ) -> Result<T> {
        // A queued UI callback may outlive its awaiting future. Hold status while
        // touching the HWND so timeout/retry cannot invalidate it mid-operation.
        let status = self.status.lock().expect("startup status poisoned");
        if status.attempt != attempt || status.error.is_some() || status.phase == "ready" {
            return Err(message("startup_attempt_expired"));
        }
        if !self
            .main_deadline
            .lock()
            .expect("startup deadline poisoned")
            .is_some_and(|deadline| tokio::time::Instant::now() < deadline)
        {
            return Err(message("startup_main_timeout"));
        }
        operation()
    }
}

#[cfg(all(test, unix))]
mod tests;
