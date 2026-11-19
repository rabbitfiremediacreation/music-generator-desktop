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
    pub phone_access: crate::phone_access::PhoneAccess,
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
            phone_access: Default::default(),
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

    pub(crate) async fn generate(
        &self,
        operation: &Operation,
        settings: &Settings,
        selection: &crate::catalog::Selection,
        params: &serde_json::Value,
        progress: impl Fn(crate::engine::progress::Progress),
    ) -> Result<(Vec<u8>, String, serde_json::Value)> {
        let cancel = operation.cancellation();
        if selection.provider == "ace-step" {
            return self
                .start_engine(operation, settings)
                .await?
                .generate(
                    params,
                    &selection.language,
                    &selection.synthesis,
                    &cancel,
                    progress,
                )
                .await;
        }
        if !operation.belongs_to(&self.runtime) || operation.kind() != OperationKind::Generation {
            return Err(message("Native generation requires a generation operation"));
        }
        crate::catalog::ensure_runtime(selection, &self.resources)?;
        self.stop_engine();
        let mut verifier = crate::verification::ModelVerifier::open(&self.db.root);
        if !crate::catalog::verify(
            selection,
            std::path::Path::new(&settings.models_dir),
            &mut verifier,
            &cancel,
        )
        .await?
        {
            return Err(message(
                "Models are missing or invalid. Open the ModelPicker to verify the selected files",
            ));
        }
        self.generate_native(settings, selection, params, &cancel, progress)
            .await
    }

    async fn generate_native(
        &self,
        settings: &Settings,
        selection: &crate::catalog::Selection,
        params: &serde_json::Value,
        cancel: &tokio_util::sync::CancellationToken,
        progress: impl Fn(crate::engine::progress::Progress),
    ) -> Result<(Vec<u8>, String, serde_json::Value)> {
        let catalog = crate::catalog::catalog();
        let profile = catalog
            .profile(selection)
            .ok_or_else(|| message("Unknown native generation profile"))?;
        match selection.provider.as_str() {
            "heartmula" => {
                crate::engine::heartmula::generate(
                    &self.resources,
                    &self.db.root,
                    settings,
                    profile,
                    params,
                    cancel,
                    progress,
                )
                .await
            }
            "yue2" => {
                crate::engine::yue2::generate(
                    &profile.runtime.executable(&self.resources),
                    &self.db.root,
                    settings,
                    params,
                    cancel,
                    progress,
                )
                .await
            }
            _ => Err(message(
                "This model provider has no native generation adapter",
            )),
        }
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
