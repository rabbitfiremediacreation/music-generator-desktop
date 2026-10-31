use super::*;

impl Startup {
    pub(super) async fn allowed(&self) -> bool {
        let allowed = *self
            .launch_allowed
            .get_or_init(|| async {
                match tauri::async_runtime::spawn_blocking(
                    crate::launch_location::installation_required,
                )
                .await
                {
                    Ok(required) => !required,
                    Err(error) => {
                        eprintln!("Startup location check failed; allowing startup: {error}");
                        true
                    }
                }
            })
            .await;
        allowed
    }

    pub(super) async fn require_allowed<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        attempt: u64,
    ) -> Result<()> {
        if self.allowed().await {
            return Ok(());
        }
        self.report(app, attempt, "installation_required", None);
        Err(message("Installation required"))
    }

    /// Keep data initialization behind the splash handshake and reuse successful state on retry.
    pub async fn prepare<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        attempt: u64,
    ) -> Result<Arc<AppState>> {
        self.require_allowed(app, attempt).await?;
        self.ensure_active(attempt)?;
        self.initialize_logging()?;
        self.wait_for_splash(app, attempt).await?;
        self.ensure_active(attempt)?;
        let _guard = self.initialization.lock().await;
        self.ensure_active(attempt)?;
        if let Some(state) = app.try_state::<Arc<AppState>>() {
            return Ok(state.inner().clone());
        }
        self.report(app, attempt, "data", None);
        let root = self.root.clone();
        let resources = self.resources.clone();
        let state = tauri::async_runtime::spawn_blocking(move || -> Result<Arc<AppState>> {
            let db = db::Database::open(&root)?;
            sandbox::initialize(&root)?;
            crate::audio_export::cleanup_stale(&root);
            Ok(Arc::new(AppState::new(db, resources)))
        })
        .await
        .map_err(|e| message(e.to_string()))??;
        tracing::info!(
            elapsed_ms = self.started.elapsed().as_millis(),
            splash_ms = self.painted_ms.load(Ordering::Relaxed),
            "Startup data initialization finished"
        );
        app.manage(state.clone());
        tauri::async_runtime::spawn(jobs::worker(state.clone(), app.clone()));
        self.ensure_active(attempt)?;
        Ok(state)
    }

    async fn wait_for_splash<R: Runtime>(&self, app: &AppHandle<R>, attempt: u64) -> Result<()> {
        let mut painted = self.painted.subscribe();
        loop {
            self.ensure_active(attempt)?;
            let ready = tokio::time::timeout(
                std::time::Duration::from_secs(15),
                painted.wait_for(|ready| *ready == attempt || self.snapshot().attempt != attempt),
            )
            .await
            .map(|result| result.map(|_| ()));
            self.ensure_active(attempt)?;
            if let Ok(result) = ready {
                result.map_err(|error| message(error.to_string()))?;
                return Ok(());
            }
            let _transition = self.transition.lock().await;
            self.ensure_active(attempt)?;
            if self.automatic_retry.swap(true, Ordering::Relaxed) {
                self.report(app, attempt, "error", Some("startup_splash_timeout".into()));
                return Err(message("startup_splash_timeout"));
            }
            self.log_event(attempt, "Automatic splash retry")?;
            self.report(app, attempt, "starting", None);
            let result = app
                .get_webview_window("splash")
                .ok_or_else(|| message("Startup window is unavailable"))?
                .reload();
            if let Err(error) = result {
                self.report(app, attempt, "error", Some(error.to_string()));
                return Err(message(error.to_string()));
            }
        }
    }
}
