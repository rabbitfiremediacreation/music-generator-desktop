//! Shared lifecycle for one-shot native generators.
use super::{process::OwnedProcess, progress::Progress};
use crate::{
    audio_facts,
    error::{message, Error, Result},
};
use serde_json::{json, Value};
use std::{
    path::Path,
    time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;

pub struct NativeJob<'a> {
    pub executable: &'a Path,
    pub model_folder: &'a Path,
    pub data_root: &'a Path,
    pub log_name: &'a str,
    pub backend: &'a str,
    pub timeout: Duration,
}

pub type WavJob<'a> = NativeJob<'a>;

impl NativeJob<'_> {
    pub async fn run(
        &self,
        params: &Value,
        cancel: &CancellationToken,
        progress: impl Fn(Progress),
        arguments: impl FnOnce(&Path) -> Vec<String>,
    ) -> Result<(Vec<u8>, String, Value)> {
        let (audio, metadata) = self
            .run_file("wav", params, cancel, progress, arguments)
            .await?;
        let metadata = wav_metadata(&audio, params, metadata)?;
        Ok((audio, "wav".into(), metadata))
    }

    pub async fn run_file(
        &self,
        extension: &str,
        params: &Value,
        cancel: &CancellationToken,
        progress: impl Fn(Progress),
        arguments: impl FnOnce(&Path) -> Vec<String>,
    ) -> Result<(Vec<u8>, Value)> {
        let (bytes, metadata, _) = self
            .run_job(extension, params, cancel, progress, false, |output, _| {
                arguments(output)
            })
            .await?;
        Ok((bytes, metadata))
    }

    pub async fn run_with_report(
        &self,
        params: &Value,
        cancel: &CancellationToken,
        progress: impl Fn(Progress),
        arguments: impl FnOnce(&Path, &Path) -> Vec<String>,
    ) -> Result<(Vec<u8>, String, Value, Vec<u8>)> {
        let (audio, metadata, report) = self
            .run_job("wav", params, cancel, progress, true, arguments)
            .await?;
        let metadata = wav_metadata(&audio, params, metadata)?;
        Ok((audio, "wav".into(), metadata, report))
    }

    async fn run_job(
        &self,
        extension: &str,
        params: &Value,
        cancel: &CancellationToken,
        progress: impl Fn(Progress),
        with_report: bool,
        arguments: impl FnOnce(&Path, &Path) -> Vec<String>,
    ) -> Result<(Vec<u8>, Value, Vec<u8>)> {
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        let logs = self.data_root.join("logs");
        tokio::fs::create_dir_all(&logs).await?;
        let work = tempfile::Builder::new()
            .prefix("music-job-")
            .tempdir_in(self.data_root)?;
        let output = work.path().join(format!("song.{extension}"));
        let report = work.path().join("report.json");
        let args = arguments(&output, &report);
        let started = Instant::now();
        let mut process = OwnedProcess::spawn_with_model_folder(
            self.executable,
            &args,
            false,
            &logs.join(self.log_name),
            Some(self.model_folder),
        )?;
        let mut elapsed = None;
        let phase = if extension == "wav" {
            "generation"
        } else {
            "synth"
        };
        loop {
            if cancel.is_cancelled() {
                return Err(Error::Cancelled);
            }
            if started.elapsed() >= self.timeout {
                return Err(message(format!(
                    "Music generation timed out. See {}",
                    self.log_name
                )));
            }
            if let Some(status) = process.status()? {
                if !status.success() {
                    return Err(message(format!(
                        "Native music generation failed ({status}). See {}",
                        self.log_name
                    )));
                }
                break;
            }
            let seconds = started.elapsed().as_secs();
            if elapsed != Some(seconds) {
                progress(Progress {
                    elapsed_seconds: seconds,
                    ..Progress::new(phase)
                });
                elapsed = Some(seconds);
            }
            tokio::select! {
                _ = cancel.cancelled() => return Err(Error::Cancelled),
                _ = tokio::time::sleep(Duration::from_millis(200)) => {}
            }
        }
        let runtime_seconds = started.elapsed().as_secs_f64();
        let (bytes, report) = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(Error::Cancelled),
            output = async {
                let bytes = tokio::fs::read(output).await?;
                let report = if with_report { tokio::fs::read(report).await? } else { Vec::new() };
                std::io::Result::Ok((bytes, report))
            } => output?,
        };
        let meta = json!({
            "runtime_seconds": runtime_seconds,
            "backend": self.backend,
            "seed": params["seed"],
        });
        Ok((bytes, meta, report))
    }
}

fn wav_metadata(audio: &[u8], params: &Value, mut metadata: Value) -> Result<Value> {
    let wav = audio_facts::wav_facts(audio)?;
    metadata["audio_format"] = json!({
        "container": "wav",
        "encoding": "pcm",
        "sample_rate_hz": wav.sample_rate_hz,
        "channels": wav.channels,
        "bits_per_sample": wav.bits_per_sample,
    });
    audio_facts::record_duration(wav.duration_seconds, params, &mut metadata);
    Ok(metadata)
}
