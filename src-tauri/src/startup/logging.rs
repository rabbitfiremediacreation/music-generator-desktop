use super::Startup;
use crate::error::Result;
use std::{fs::OpenOptions, io::Write, sync::Mutex};

impl Startup {
    /// Open the diagnostic log before waiting for either webview handshake.
    pub(crate) fn initialize_logging(&self) -> Result<()> {
        let mut log = self.log.lock().expect("startup log poisoned");
        if log.is_none() {
            std::fs::create_dir_all(self.root.join("logs"))?;
            let mut file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(self.root.join("logs/desktop.log"))?;
            writeln!(
                file,
                "{} INFO Startup process pid={} version={} build={} platform={} arch={} elapsed_ms={}",
                chrono::Utc::now().to_rfc3339(),
                std::process::id(),
                env!("CARGO_PKG_VERSION"),
                env!("MUSIC_GENERATOR_BUILD_REVISION"),
                std::env::consts::OS,
                std::env::consts::ARCH,
                self.started.elapsed().as_millis(),
            )?;
            let _ = tracing_subscriber::fmt()
                .with_ansi(false)
                .with_writer(Mutex::new(file.try_clone()?))
                .try_init();
            *log = Some(file);
        }
        Ok(())
    }

    pub(super) fn log_error(&self, attempt: u64, phase: &str, error: &str) -> Result<()> {
        if self.launch_allowed.get() == Some(&false) {
            return Ok(());
        }
        self.initialize_logging()?;
        if let Some(log) = self.log.lock().expect("startup log poisoned").as_mut() {
            writeln!(
                log,
                "{} ERROR Startup failure pid={} attempt={attempt} phase={phase:?} elapsed_ms={} error={error:?}",
                chrono::Utc::now().to_rfc3339(),
                std::process::id(),
                self.started.elapsed().as_millis(),
            )?;
        }
        Ok(())
    }

    pub(super) fn log_event(&self, attempt: u64, event: &str) -> Result<()> {
        self.initialize_logging()?;
        self.log_diagnostic(attempt, event)
    }

    pub(super) fn log_diagnostic(&self, attempt: u64, event: &str) -> Result<()> {
        if let Some(log) = self.log.lock().expect("startup log poisoned").as_mut() {
            writeln!(
                log,
                "{} INFO {event} pid={} attempt={attempt} elapsed_ms={}",
                chrono::Utc::now().to_rfc3339(),
                std::process::id(),
                self.started.elapsed().as_millis(),
            )?;
        }
        Ok(())
    }
}
