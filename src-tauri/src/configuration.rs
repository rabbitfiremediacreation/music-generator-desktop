use crate::{
    error::{message, Error, Result},
    runtime::{Operation, OperationKind},
    state::AppState,
    types::Settings,
};
use std::{path::Path, sync::Arc};
use tokio_util::sync::CancellationToken;

mod library_move;
mod patch;
pub use patch::{validate_settings, SettingsPatch};

/// Settings and setup share the same authorization, file move and durable commit path.
pub async fn save(
    state: Arc<AppState>,
    values: SettingsPatch,
    authorize: impl FnOnce(&Path) -> Result<()>,
) -> Result<Settings> {
    save_with_progress(state, values, authorize, |_| {}).await
}

pub async fn save_with_progress(
    state: Arc<AppState>,
    values: SettingsPatch,
    authorize: impl FnOnce(&Path) -> Result<()>,
    progress: impl Fn(crate::import::ImportProgress) + Send + 'static,
) -> Result<Settings> {
    if values.expert_only() {
        return state.runtime.update_preferences(|| {
            state.db.set_expert_mode(values.expert_mode.unwrap())?;
            state.db.settings()
        });
    }
    let change = Change::begin(state.clone(), OperationKind::Settings)?;
    let settings = values.apply(state.db.settings()?, &state.db.root, &state.resources)?;
    change
        .commit_with_progress(async { Ok(settings) }, authorize, progress)
        .await
}

pub(crate) struct Change {
    state: Arc<AppState>,
    operation: Operation,
    committed: bool,
}

impl Change {
    pub(crate) fn begin(state: Arc<AppState>, kind: OperationKind) -> Result<Self> {
        assert!(matches!(
            kind,
            OperationKind::Setup | OperationKind::Settings
        ));
        let operation = state.runtime.try_begin(kind)?;
        Ok(Self {
            state,
            operation,
            committed: false,
        })
    }

    pub(crate) fn operation(&self) -> &Operation {
        &self.operation
    }
    pub(crate) fn cancellation(&self) -> CancellationToken {
        self.operation.cancellation()
    }

    pub(crate) async fn commit(
        self,
        tested: impl std::future::Future<Output = Result<Settings>>,
        authorize: impl FnOnce(&Path) -> Result<()>,
    ) -> Result<Settings> {
        self.commit_with_progress(tested, authorize, |_| {}).await
    }

    async fn commit_with_progress(
        mut self,
        tested: impl std::future::Future<Output = Result<Settings>>,
        authorize: impl FnOnce(&Path) -> Result<()>,
        progress: impl Fn(crate::import::ImportProgress) + Send + 'static,
    ) -> Result<Settings> {
        let settings = tested.await?;
        validate_settings(&settings)?;
        let cancel = self.cancellation();
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        let before = self.state.db.settings()?;
        if before.songs_dir != settings.songs_dir && self.state.db.busy()? {
            return Err(message(
                "Finish or cancel queued songs before changing folders",
            ));
        }
        authorize(Path::new(&settings.songs_dir))?;
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        // Move the permit into the blocking commit so dropping the caller cannot unlock
        // configuration while filesystem work is still running.
        tokio::task::spawn_blocking(move || {
            library_move::commit(&self.state.db, &settings, &cancel, progress)?;
            if self.operation.kind() == OperationKind::Settings {
                self.state.apply_engine_settings(&before, &settings);
            }
            self.state.runtime.set_configured(settings.setup_complete);
            self.committed = true;
            drop(self);
            Ok(settings)
        })
        .await
        .map_err(|e| message(e.to_string()))?
    }
}

impl Drop for Change {
    fn drop(&mut self) {
        if !self.committed && self.operation.kind() == OperationKind::Setup {
            self.state.stop_engine();
        }
    }
}

#[cfg(test)]
mod tests;
