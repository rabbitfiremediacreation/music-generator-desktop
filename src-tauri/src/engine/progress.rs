use crate::error::{message, Result};
use futures_util::StreamExt;
use serde::Serialize;
use std::time::Duration;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Progress {
    pub phase: &'static str,
    pub step: Option<u32>,
    pub total_steps: Option<u32>,
    pub elapsed_seconds: u64,
}

impl Progress {
    pub fn new(phase: &'static str) -> Self {
        Self {
            phase,
            step: None,
            total_steps: None,
            elapsed_seconds: 0,
        }
    }

    pub fn message(&self) -> String {
        let label = match self.phase {
            "starting" => "Starting engine",
            "loading" => "Loading models",
            "lm" => "LM",
            "dit" => "DiT",
            "vae" => "VAE",
            "title_download" => "Preparing title model",
            "title" => "Generating song title",
            "saving" => "Saving audio",
            "saving_midi" => "Saving MIDI",
            _ => "Synth",
        };
        let steps = match (self.step, self.total_steps) {
            (Some(step), Some(total)) => format!(" · {step}/{total}"),
            (Some(step), None) => format!(" · {step}"),
            _ => String::new(),
        };
        format!(
            "{label}{steps} · {}:{:02}",
            self.elapsed_seconds / 60,
            self.elapsed_seconds % 60
        )
    }
}

// Engine logs contain a replayed backlog. Accept only the current job's execution window.
pub struct JobLogs {
    id: String,
    active: bool,
}

impl JobLogs {
    pub fn new(id: &str) -> Self {
        Self {
            id: id.into(),
            active: false,
        }
    }

    pub fn parse(&mut self, line: &str) -> Option<Progress> {
        if let Some(job) = line.strip_prefix("[Server] Job ") {
            let (id, action) = job.split_once(' ')?;
            if action.starts_with("created ") {
                self.active = id == self.id;
            } else if id == self.id && action.starts_with("done ") {
                self.active = false;
            }
            return None;
        }
        if !self.active {
            return None;
        }
        if let Some(rest) = line.strip_prefix("[DiT] Step ") {
            let (step, total) = rest.split_whitespace().next()?.split_once('/')?;
            let (step, total) = (step.parse::<u32>().ok()?, total.parse::<u32>().ok()?);
            if total == 0 || step > total {
                return None;
            }
            return Some(Progress {
                step: Some(step),
                total_steps: Some(total),
                ..Progress::new("dit")
            });
        }
        if line.starts_with("[LM-Phase1]")
            || line.starts_with("[LM-Phase2]")
            || line.starts_with("[LM-Generate]")
        {
            let step = line
                .split_once(" Step ")
                .and_then(|(_, s)| s.split(',').next()?.parse().ok());
            return Some(Progress {
                step,
                ..Progress::new("lm")
            });
        }
        if line.starts_with("[VAE] Graph:")
            || line.starts_with("[VAE] Tiled decode:")
            || line.starts_with("[VAE] Decoded:")
        {
            return Some(Progress::new("vae"));
        }
        if line.starts_with("[Server] Loading synth:")
            || line.starts_with("[GGUF] ")
            || line.starts_with("[Store] Load ")
        {
            return Some(Progress::new("loading"));
        }
        None
    }
}

// Decode complete UTF-8 log lines even when network chunks split code points or CRLF.
#[derive(Default)]
pub struct LogLines(Vec<u8>);
impl LogLines {
    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<String>> {
        let mut lines = Vec::new();
        for &byte in bytes {
            if byte == b'\n' {
                let line = String::from_utf8(std::mem::take(&mut self.0))
                    .map_err(|e| message(e.to_string()))?;
                if let Some(data) = line.trim_end_matches('\r').strip_prefix("data:") {
                    lines.push(data.strip_prefix(' ').unwrap_or(data).to_owned());
                }
            } else {
                if self.0.len() >= 64 * 1024 {
                    return Err(message("Engine log line too long"));
                }
                self.0.push(byte);
            }
        }
        Ok(lines)
    }
}

pub async fn stream_logs(
    http: &reqwest::Client,
    base: &str,
    id: &str,
    progress: impl Fn(Progress),
) {
    loop {
        let mut job = JobLogs::new(id);
        let _ = read_logs(http, base, &mut job, &progress).await;
        // Recheck the job marker in each replay; missing markers leave elapsed-time fallback active.
        tokio::time::sleep(Duration::from_secs(3)).await;
    }
}

async fn read_logs(
    http: &reqwest::Client,
    base: &str,
    job: &mut JobLogs,
    progress: &impl Fn(Progress),
) -> Result<()> {
    let response = http
        .get(format!("{base}/logs"))
        .send()
        .await?
        .error_for_status()?;
    if !response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with("text/event-stream"))
    {
        return Err(message("Engine has no log stream"));
    }
    let mut stream = response.bytes_stream();
    let mut lines = LogLines::default();
    while let Some(chunk) = stream.next().await {
        for line in lines.push(&chunk?)? {
            if let Some(update) = job.parse(&line) {
                progress(update);
            }
        }
    }
    Ok(())
}
