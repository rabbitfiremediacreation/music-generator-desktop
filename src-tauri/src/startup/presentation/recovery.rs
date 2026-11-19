use super::Startup;
use crate::error::Result;
use std::{future::Future, time::Duration};

// The successful external HWND experiment used 0.8 s. This is a bounded
// workaround, not a pixel detector; rAF also succeeds in the black-window cases.
pub(super) const HIDDEN_INTERVAL: Duration = Duration::from_millis(800);

impl Startup {
    pub(super) fn has_recovery_budget(&self, attempt: u64) -> bool {
        // Leave time for User32 and the UI dispatch on both sides of the interval.
        let required = HIDDEN_INTERVAL + Duration::from_millis(200);
        let deadline = *self
            .main_deadline
            .lock()
            .expect("startup deadline poisoned");
        let enough_time = deadline.is_some_and(|end| {
            end.saturating_duration_since(tokio::time::Instant::now()) >= required
        });
        if !enough_time {
            let _ = self.log_diagnostic(
                attempt,
                "Native presentation skipped: insufficient time before deadline",
            );
        }
        enough_time
    }
}

pub(super) async fn cycle<T, F: Future<Output = Result<()>>>(
    hide: impl Future<Output = Result<Option<T>>>,
    show: impl FnOnce(T) -> F,
) -> Result<()> {
    if let Some(hidden) = hide.await? {
        tokio::time::sleep(HIDDEN_INTERVAL).await;
        show(hidden).await?;
    }
    Ok(())
}

/// Return from our temporary splash, never from another foreground window.
pub(super) struct Activation {
    pub was_foreground: bool,
    pub temporary_foreground: usize,
}

impl Activation {
    pub fn may_restore(&self, foreground: usize) -> bool {
        self.was_foreground
            && self.temporary_foreground != 0
            && self.temporary_foreground == foreground
    }
}

#[cfg(test)]
mod tests;
