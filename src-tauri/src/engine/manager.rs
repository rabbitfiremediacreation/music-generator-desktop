use super::{backend_status::BackendStatus, client::EngineClient, Engine};
use crate::{
    error::{Error, Result},
    types::Settings,
};
use serde_json::{json, Value};
use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::Duration,
};
use tokio_util::sync::CancellationToken;

/// Owns resident processes; configuration readiness belongs to the application runtime.
#[derive(Default)]
pub(crate) struct EngineManager {
    engine: Mutex<Option<Engine>>,
    has_started: AtomicBool,
    refresh: AtomicBool,
}

impl EngineManager {
    // Callers hold the runtime's exclusive operation permit while starting an engine.
    pub async fn start(
        &self,
        resources: &Path,
        logs: &Path,
        settings: &Settings,
        cancel: &CancellationToken,
    ) -> Result<EngineClient> {
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        {
            let mut engine = self.engine.lock().unwrap();
            if !self.refresh.swap(false, Ordering::AcqRel)
                && engine.as_mut().is_some_and(Engine::alive)
            {
                return Ok(engine.as_ref().unwrap().client.clone());
            }
            engine.take();
        }
        let started = Engine::start(resources, logs, settings, cancel).await?;
        let mut engine = self.engine.lock().unwrap();
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        let client = started.client.clone();
        *engine = Some(started);
        self.has_started.store(true, Ordering::Relaxed);
        Ok(client)
    }

    pub fn stop(&self) {
        self.engine.lock().unwrap().take();
    }

    pub(crate) fn refresh_models(&self) {
        self.refresh.store(true, Ordering::Release);
    }

    pub fn backend_status(&self) -> BackendStatus {
        let mut owned = self.engine.lock().unwrap();
        match owned.as_mut() {
            Some(engine) => {
                if engine.alive() {
                    engine.backend.status()
                } else {
                    BackendStatus::inactive(true)
                }
            }
            None => BackendStatus::inactive(self.has_started.load(Ordering::Relaxed)),
        }
    }

    pub fn apply_settings(&self, before: &Settings, after: &Settings) {
        let mut engine = self.engine.lock().unwrap();
        if before.lm_device != after.lm_device
            || before.mode != after.mode
            || before.models_dir != after.models_dir
            || before.vae_chunk != after.vae_chunk
        {
            engine.take();
        } else if let Some(engine) = engine.as_mut() {
            engine.client.poll = Duration::from_secs_f64(after.poll_interval);
            engine.client.timeout = Duration::from_secs_f64(after.timeout_minutes * 60.0);
        }
    }

    pub async fn health(&self, ready: bool) -> Value {
        let client = {
            let mut engine = self.engine.lock().unwrap();
            match engine.as_mut() {
                Some(engine) => {
                    if !engine.alive() {
                        return json!({"ok":false,"error":"Model engine stopped unexpectedly","backend_status":BackendStatus::inactive(true)});
                    }
                    Some(engine.client.clone())
                }
                None => None,
            }
        };
        let Some(client) = client else {
            return json!({"ok":ready,"idle":ready,"error":if ready { None } else { Some("Complete model setup first") },"backend_status":self.backend_status()});
        };
        let synth = client
            .http
            .get(format!("{}/health", client.synth))
            .timeout(Duration::from_secs(5))
            .send()
            .await;
        let lm = client
            .http
            .get(format!("{}/health", client.lm))
            .timeout(Duration::from_secs(5))
            .send()
            .await;
        let props = match client
            .http
            .get(format!("{}/props", client.synth))
            .timeout(Duration::from_secs(5))
            .send()
            .await
        {
            Ok(response) => response.json::<Value>().await.ok(),
            Err(_) => None,
        };
        json!({"ok":synth.is_ok_and(|r| r.status().is_success()) && lm.is_ok_and(|r| r.status().is_success()),"props":props,"backend_status":self.backend_status()})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn resident() -> EngineManager {
        let mut client =
            EngineClient::new("http://unused".into(), "http://unused".into(), 1.5, 30.0).unwrap();
        client.synth_log = Some("synthesis.log".into());
        EngineManager {
            engine: Mutex::new(Some(Engine {
                processes: Vec::new(),
                client,
                backend: super::super::backend_status::BackendSession::new(
                    super::super::backend_status::BackendLog::capture(Path::new("synthesis.log")),
                    None,
                    None,
                    false,
                ),
            })),
            has_started: AtomicBool::new(true),
            ..EngineManager::default()
        }
    }
    #[test]
    fn timing_changes_keep_the_resident_engine_and_its_diagnostics() {
        let manager = resident();
        let before = Settings::default();
        let mut after = before.clone();
        after.timeout_minutes = 45.0;
        after.poll_interval = 2.0;
        manager.apply_settings(&before, &after);
        let engine = manager.engine.lock().unwrap();
        let client = &engine.as_ref().unwrap().client;
        assert_eq!(client.timeout, Duration::from_secs(2700));
        assert_eq!(client.poll, Duration::from_secs(2));
        assert_eq!(
            client.synth_log.as_deref(),
            Some(Path::new("synthesis.log"))
        );
    }
    #[tokio::test]
    async fn changing_the_device_clears_the_old_backend_from_health() {
        let manager = resident();
        let before = Settings::default();
        let mut after = before.clone();
        after.lm_device = "cpu".into();
        manager.apply_settings(&before, &after);
        let health = manager.health(true).await;
        assert_eq!(health["backend_status"]["state"], "stopped");
        assert_eq!(health["backend_status"]["synthesis"]["backend"], "unknown");
    }

    #[tokio::test]
    async fn healthy_servers_do_not_confirm_a_backend_until_models_execute() {
        use crate::engine::backend_status::{BackendLog, BackendSession};
        use axum::{routing::get, Json, Router};
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("engine.log");
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let app = Router::new()
            .route("/health", get(|| async { Json(json!({"status":"ok"})) }))
            .route("/props", get(|| async { Json(json!({"models":{}})) }));
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let manager = resident();
        {
            let mut engine = manager.engine.lock().unwrap();
            let engine = engine.as_mut().unwrap();
            engine.client.synth = url.clone();
            engine.client.lm = url;
            engine.backend = BackendSession::new(BackendLog::capture(&path), None, None, false);
        }
        let health = manager.health(true).await;
        assert_eq!(health["ok"], true);
        assert_eq!(
            health["backend_status"]["language_model"]["state"],
            "unconfirmed"
        );
        std::fs::write(&path, "[Load] LM backend: CUDA0 (CPU threads: 4)\n").unwrap();
        let health = manager.health(true).await;
        assert_eq!(
            health["backend_status"]["language_model"]["backend"],
            "cuda"
        );
        assert_eq!(
            health["backend_status"]["synthesis"]["state"],
            "unconfirmed"
        );
        manager.stop();
        assert_eq!(
            manager.health(true).await["backend_status"]["state"],
            "stopped"
        );
        task.abort();
    }
}
