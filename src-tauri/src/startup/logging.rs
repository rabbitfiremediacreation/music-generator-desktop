use super::Startup;
use crate::error::Result;
use std::{fs::OpenOptions, io::Write, sync::Mutex};

impl Startup {
    /// Open the diagnostic log before waiting for either webview handshake.
    pub(super) fn initialize_logging(&self) -> Result<()> {
        let mut log = self.log.lock().expect("startup log poisoned");
        if log.is_none() {
            std::fs::create_dir_all(self.root.join("logs"))?;
            let file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(self.root.join("logs/desktop.log"))?;
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
                "{} ERROR Startup failure attempt={attempt} phase={phase:?} elapsed_ms={} error={error:?}",
                chrono::Utc::now().to_rfc3339(),
                self.started.elapsed().as_millis(),
            )?;
        }
        Ok(())
    }

    pub(super) fn log_event(&self, attempt: u64, event: &str) -> Result<()> {
        self.initialize_logging()?;
        if let Some(log) = self.log.lock().expect("startup log poisoned").as_mut() {
            writeln!(
                log,
                "{} INFO {event} attempt={attempt} elapsed_ms={}",
                chrono::Utc::now().to_rfc3339(),
                self.started.elapsed().as_millis(),
            )?;
        }
        Ok(())
    }
}
