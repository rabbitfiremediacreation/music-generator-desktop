pub mod backend_status;
pub mod client;
pub mod device;
mod diagnostics;
mod generation;
pub(crate) mod heartmula;
pub(crate) mod manager;
pub(crate) mod mulacover;
pub mod native;
pub mod process;
pub mod progress;
mod response;
use crate::{
    error::{message, Error, Result},
    types::Settings,
};
use backend_status::{BackendLog, BackendSession, Reason};
use client::EngineClient;
use process::OwnedProcess;
use std::{
    net::TcpListener,
    path::{Path, PathBuf},
    time::Duration,
};
use tokio_util::sync::CancellationToken;

pub struct Engine {
    processes: Vec<OwnedProcess>,
    pub client: EngineClient,
    pub backend: BackendSession,
}

// CPU-only Macs share one server: a second CPU LM would duplicate model memory.
pub fn device_plan(settings: &Settings, cpu_only: bool) -> (bool, bool) {
    (cpu_only, settings.cpu_lm() && !cpu_only)
}

pub fn engine_path(resources: &Path) -> PathBuf {
    resources.join("engine").join(if cfg!(windows) {
        "ace-server.exe"
    } else {
        "ace-server"
    })
}

impl Engine {
    pub async fn start(
        resources: &Path,
        logs: &Path,
        settings: &Settings,
        cancel: &CancellationToken,
    ) -> Result<Self> {
        let binary = engine_path(resources);
        if !binary.is_file() {
            return Err(message(
                "Bundled engine is missing. Run npm run engine:prepare before building the app.",
            ));
        }
        let (cpu_synth, separate_lm) = device_plan(settings, crate::hardware::cpu_only());
        let mut processes = Vec::new();
        let (synth, process, synthesis_log) = start_one(
            &binary,
            &logs.join("ace-server.log"),
            settings,
            cpu_synth,
            cancel,
        )
        .await?;
        processes.push(process);
        let (lm, language_log) = if separate_lm {
            let (url, process, log) =
                start_one(&binary, &logs.join("ace-lm.log"), settings, true, cancel).await?;
            processes.push(process);
            (url, Some(log))
        } else {
            (synth.clone(), None)
        };
        let mut client =
            EngineClient::new(synth, lm, settings.poll_interval, settings.timeout_minutes)?;
        client.synth_log = Some(logs.join("ace-server.log"));
        let cpu_reason = if cpu_synth {
            Some(Reason::CpuOnly)
        } else if settings.lm_device == "cpu" {
            Some(Reason::CpuRequested)
        } else if separate_lm {
            Some(Reason::LmSelftestFailed)
        } else {
            None
        };
        let cuda_unsupported = crate::hardware::inspect()
            .cuda
            .as_ref()
            .is_some_and(|cuda| cuda.architecture_supported == Some(false));
        let backend =
            BackendSession::new(synthesis_log, language_log, cpu_reason, cuda_unsupported);
        Ok(Self {
            processes,
            client,
            backend,
        })
    }

    pub fn alive(&mut self) -> bool {
        self.processes
            .iter_mut()
            .all(|p| p.alive().unwrap_or(false))
    }
}

async fn start_one(
    binary: &Path,
    log: &Path,
    settings: &Settings,
    cpu: bool,
    cancel: &CancellationToken,
) -> Result<(String, OwnedProcess, BackendLog)> {
    if let Some(folder) = log.parent() {
        std::fs::create_dir_all(folder)?;
    }
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(2))
        .build()?;
    let cpu_args = if cpu {
        device::cpu_arguments(binary, cancel).await?
    } else {
        Vec::new()
    };
    let deadline = tokio::time::Instant::now() + Duration::from_secs(120);
    for _ in 0..3 {
        if tokio::time::Instant::now() >= deadline {
            break;
        }
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let port = listener.local_addr()?.port();
        drop(listener);
        let mut args = vec![
            "--host".into(),
            "127.0.0.1".into(),
            "--port".into(),
            port.to_string(),
            "--models".into(),
            settings.models_dir.clone(),
            "--max-batch".into(),
            "1".into(),
        ];
        if let Some(chunk) = settings.vae_chunk {
            args.extend(["--vae-chunk".into(), chunk.to_string()]);
        }
        args.extend(cpu_args.iter().cloned());
        let observation = BackendLog::capture(log);
        let mut process = OwnedProcess::spawn(binary, &args, cpu, log)?;
        let url = format!("http://127.0.0.1:{port}");
        while tokio::time::Instant::now() < deadline {
            if cancel.is_cancelled() {
                return Err(Error::Cancelled);
            }
            if !process.alive()? {
                break;
            }
            let response = tokio::select! {
                _ = cancel.cancelled() => return Err(Error::Cancelled),
                _ = tokio::time::sleep_until(deadline) => break,
                response = client.get(format!("{url}/health")).send() => response,
            };
            if response.is_ok_and(|r| r.status().is_success()) && process.alive()? {
                return Ok((url, process, observation));
            }
            tokio::select! {
                _ = cancel.cancelled() => return Err(Error::Cancelled),
                _ = tokio::time::sleep(Duration::from_millis(500)) => {},
            }
        }
    }
    Err(message("Engine did not become ready. See the engine logs; check your graphics driver or run the hardware test again."))
}
