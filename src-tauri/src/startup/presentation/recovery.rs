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

/// Reclaim only the foreground lost by our own hide, never subsequent user input.
pub(super) struct Activation {
    pub was_foreground: bool,
    pub foreground_after_hide: usize,
    pub last_input: Option<u32>,
}

impl Activation {
    pub fn may_restore(&self, foreground: usize, last_input: Option<u32>) -> bool {
        self.was_foreground
            && self.foreground_after_hide == foreground
            && self.last_input.is_some()
            && self.last_input == last_input
    }
}

#[cfg(test)]
mod tests;
