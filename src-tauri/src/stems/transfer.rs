use crate::{
    error::{message, Result},
    state::AppState,
};
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

/// Make a single transfer visible and cancellable from the desktop model manager.
pub(crate) struct Transfer(Arc<AppState>);

impl Transfer {
    pub(crate) fn claim(
        state: Arc<AppState>,
        key: &str,
        cancel: CancellationToken,
    ) -> Result<Self> {
        {
            let mut active = state.stem_transfer.lock().unwrap();
            if active.is_some() {
                return Err(message("stem_install_busy"));
            }
            *active = Some((key.into(), cancel));
        }
        Ok(Self(state))
    }
}

impl Drop for Transfer {
    fn drop(&mut self) {
        self.0.stem_transfer.lock().unwrap().take();
    }
}
