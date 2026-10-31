use crate::{
    db::Database,
    engine::{client::EngineClient, manager::EngineManager},
    error::{message, Result},
    runtime::{Operation, OperationKind, Runtime},
    types::Settings,
};
use std::{path::PathBuf, sync::Arc};
use tauri::{AppHandle, Emitter};

pub struct AppState {
    pub db: Arc<Database>,
    pub resources: PathBuf,
    pub runtime: Arc<Runtime>,
    engine: EngineManager,
    pub synthesis_probe: crate::synthesis_policy::Probe,
}

impl AppState {
    pub fn new(db: Database, resources: PathBuf) -> Self {
        let synthesis_probe = crate::synthesis_policy::Probe::with_data_root(db.root.clone());
        Self {
            db: Arc::new(db),
            resources,
            runtime: Arc::new(Runtime::default()),
            engine: EngineManager::default(),
            synthesis_probe,
        }
    }

    pub fn changed<R: tauri::Runtime>(&self, app: &AppHandle<R>) {
        let _ = app.emit("library-changed", ());
    }

    // Restore durable configuration without starting or scanning the engine.
    pub fn restore_setup(&self) -> Result<bool> {
        let complete = self.db.settings()?.setup_complete;
        self.runtime.set_configured(complete);
        Ok(complete)
    }

    pub async fn start_engine(
        &self,
        operation: &Operation,
        settings: &Settings,
    ) -> Result<EngineClient> {
        if !operation.belongs_to(&self.runtime) {
            return Err(message("Operation belongs to another runtime"));
        }
        if settings.model_provider != "ace-step" {
            return Err(message("Audio analysis is only available with ACE-Step. Choose ACE-Step in the ModelPicker"));
        }
        let cancel = operation.cancellation();
        if settings.setup_complete && operation.kind() != OperationKind::Setup {
            let mut verifier = crate::verification::ModelVerifier::open(&self.db.root);
            if !crate::catalog::verify(
                &crate::catalog::Selection::from_settings(settings),
                std::path::Path::new(&settings.models_dir),
                &mut verifier,
                &cancel,
            )
            .await?
            {
                return Err(message(
                    "Models are missing or invalid. Open Models and hardware test in Settings.",
                ));
            }
        }
        self.engine
            .start(
                &self.resources,
                &self.db.root.join("logs"),
                settings,
                &cancel,
            )
            .await
    }

    pub fn stop_engine(&self) {
        self.engine.stop();
    }
    pub(crate) fn apply_engine_settings(&self, before: &Settings, after: &Settings) {
        self.engine.apply_settings(before, after);
    }
    pub async fn health(&self) -> serde_json::Value {
        self.engine.health(self.runtime.is_ready()).await
    }
    pub fn backend_status(&self) -> crate::engine::backend_status::BackendStatus {
        self.engine.backend_status()
    }
    pub fn begin_shutdown(&self) {
        self.runtime.shutdown();
    }
}
