use crate::error::Result;
use std::{future::Future, time::Duration};

// The successful external HWND experiment used 0.8 s. This is a bounded
// workaround, not a pixel detector; rAF also succeeds in the black-window cases.
pub(super) const HIDDEN_INTERVAL: Duration = Duration::from_millis(800);

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
