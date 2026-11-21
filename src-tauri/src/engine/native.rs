//! Shared lifecycle for one-shot native generators.
use super::{process::OwnedProcess, progress::Progress};
use crate::{
    audio_facts,
    error::{message, Error, Result},
};
use serde_json::{json, Value};
use std::{
    io::SeekFrom,
    path::Path,
    time::{Duration, Instant},
};
use tokio::io::{AsyncBufReadExt, AsyncSeekExt, BufReader};
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

type ProgressParser<'a> = &'a mut (dyn FnMut(&str) -> Option<Progress> + Send);

#[derive(Default)]
struct RunOptions<'a> {
    with_report: bool,
    parse: Option<ProgressParser<'a>>,
}

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
            .run_job(
                extension,
                params,
                cancel,
                progress,
                RunOptions::default(),
                |output, _| arguments(output),
            )
            .await?;
        Ok((bytes, metadata))
    }

    /// Read progress from this invocation's appended log while the engine is running.
    pub async fn run_file_observed(
        &self,
        extension: &str,
        params: &Value,
        cancel: &CancellationToken,
        progress: impl Fn(Progress),
        arguments: impl FnOnce(&Path) -> Vec<String>,
        mut parse: impl FnMut(&str) -> Option<Progress> + Send,
    ) -> Result<(Vec<u8>, Value)> {
        let options = RunOptions {
            parse: Some(&mut parse),
            ..Default::default()
        };
        let (bytes, metadata, _) = self
            .run_job(extension, params, cancel, progress, options, |output, _| {
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
            .run_job(
                "wav",
                params,
                cancel,
                progress,
                RunOptions {
                    with_report: true,
                    ..Default::default()
                },
                arguments,
            )
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
        mut options: RunOptions<'_>,
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
        let log = logs.join(self.log_name);
        let mut reader = if options.parse.is_some() {
            open_log_tail(&log).await
        } else {
            None
        };
        let mut line = Vec::new();
        let started = Instant::now();
        let mut process = OwnedProcess::spawn_with_model_folder(
            self.executable,
            &args,
            false,
            &log,
            Some(self.model_folder),
        )?;
        let phase = match extension {
            "wav" => "generation",
            "abc" => "planning",
            _ => "synth",
        };
        let mut current = Progress::new(phase);
        let mut emitted = None;
        let runtime_seconds = loop {
            if cancel.is_cancelled() {
                return Err(Error::Cancelled);
            }
            if started.elapsed() >= self.timeout {
                return Err(message(format!(
                    "Music generation timed out. See {}",
                    self.log_name
                )));
            }
            let status = process.status()?;
            if let (Some(reader), Some(parse)) = (&mut reader, &mut options.parse) {
                while reader
                    .read_until(b'\n', &mut line)
                    .await
                    .is_ok_and(|read| read > 0)
                    && line.ends_with(b"\n")
                {
                    if let Ok(text) = std::str::from_utf8(&line) {
                        if let Some(update) = parse(text.trim_end()) {
                            current = update;
                        }
                    }
                    line.clear();
                }
            }
            current.elapsed_seconds = started.elapsed().as_secs();
            if emitted.as_ref() != Some(&current) {
                progress(current.clone());
                emitted = Some(current.clone());
            }
            if let Some(status) = status {
                if !status.success() {
                    return Err(message(format!(
                        "Native music generation failed ({status}). See {}",
                        self.log_name
                    )));
                }
                break started.elapsed().as_secs_f64();
            }
            tokio::select! {
                _ = cancel.cancelled() => return Err(Error::Cancelled),
                _ = tokio::time::sleep(Duration::from_millis(200)) => {}
            }
        };
        let (bytes, report) = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(Error::Cancelled),
            output = async {
                let bytes = tokio::fs::read(output).await?;
                let report = if options.with_report { tokio::fs::read(report).await? } else { Vec::new() };
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

async fn open_log_tail(path: &Path) -> Option<BufReader<tokio::fs::File>> {
    let mut file = tokio::fs::OpenOptions::new()
        .read(true)
        .append(true)
        .create(true)
        .open(path)
        .await
        .ok()?;
    file.seek(SeekFrom::End(0)).await.ok()?;
    Some(BufReader::new(file))
}

pub(super) fn wav_metadata(audio: &[u8], params: &Value, mut metadata: Value) -> Result<Value> {
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
