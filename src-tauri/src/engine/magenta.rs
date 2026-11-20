//! Timed local capture from Magenta RealTime 2's C++/MLX stream.
use super::{native::WavJob, progress::Progress};
use crate::error::{message, Error, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{path::Path, time::Duration};
use tokio_util::sync::CancellationToken;

const SAMPLE_RATE: u32 = 48_000;
const MAX_SEED: u32 = 1_000_000_000;

struct Capture<'a> {
    prompt: &'a str,
    frames: u32,
    seed: u32,
}

impl<'a> Capture<'a> {
    fn from_params(params: &'a Value) -> Result<Self> {
        // The queue combines the submitted style and prompt into the caption.
        let prompt = params["caption"]
            .as_str()
            .map(str::trim)
            .filter(|s| !s.is_empty() && !s.contains('\0'))
            .ok_or_else(|| message("Magenta RealTime 2 requires a text prompt"))?;
        let seconds = params["duration"]
            .as_f64()
            .filter(|seconds| (10.0..=120.0).contains(seconds))
            .ok_or_else(|| {
                message("Magenta recording duration must be between 10 and 120 seconds")
            })?;
        let seed = params["seed"]
            .as_u64()
            .filter(|seed| *seed <= u64::from(MAX_SEED))
            .ok_or_else(|| message("Magenta recording requires a resolved seed"))?;
        Ok(Self {
            prompt,
            frames: (seconds * f64::from(SAMPLE_RATE)).round() as u32,
            seed: seed as u32,
        })
    }

    fn arguments(&self, bundle: &Path, output: &Path, report: &Path) -> Vec<String> {
        vec![
            bundle.to_string_lossy().into_owned(),
            self.frames.to_string(),
            self.seed.to_string(),
            self.prompt.into(),
            output.to_string_lossy().into_owned(),
            report.to_string_lossy().into_owned(),
        ]
    }

    fn seconds(&self) -> f64 {
        f64::from(self.frames) / f64::from(SAMPLE_RATE)
    }

    fn check_wav(&self, audio: &[u8]) -> Result<()> {
        // WavJob has already checked the RIFF container. The recorder emits
        // a fixed PCM header followed by exactly the requested stereo frames.
        let pcm16_stereo_48khz = [1, 0, 2, 0, 128, 187, 0, 0, 0, 238, 2, 0, 4, 0, 16, 0];
        let data_bytes = self.frames * 4;
        if audio.get(20..36) != Some(&pcm16_stereo_48khz)
            || audio.get(36..40) != Some(b"data")
            || audio.get(40..44) != Some(&data_bytes.to_le_bytes())
            || audio.len() != 44 + data_bytes as usize
        {
            return Err(message(
                "Magenta returned a WAV with unexpected format or length",
            ));
        }
        Ok(())
    }
}

#[derive(Deserialize, Serialize)]
struct StreamMetrics {
    first_audio_ms: f64,
    underrun_blocks: u64,
    peak_rss_bytes: u64,
    capture_seconds: f64,
    realtime: bool,
}

impl StreamMetrics {
    fn read(report: &[u8], requested_seconds: f64) -> Result<Self> {
        let metrics: Self = serde_json::from_slice(report)
            .map_err(|_| message("Magenta recording diagnostics are missing or invalid"))?;
        if metrics.first_audio_ms <= 0.0
            || metrics.peak_rss_bytes == 0
            || metrics.capture_seconds + 0.001 < requested_seconds
            || (metrics.realtime && metrics.underrun_blocks != 0)
        {
            return Err(message("Magenta recording diagnostics are inconsistent"));
        }
        Ok(metrics)
    }
}

pub async fn generate(
    executable: &Path,
    model_folder: &Path,
    data_root: &Path,
    params: &Value,
    cancel: &CancellationToken,
    progress: impl Fn(Progress),
) -> Result<(Vec<u8>, String, Value)> {
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    let capture = Capture::from_params(params)?;
    let bundle = std::path::absolute(model_folder)?.join("magenta-realtime-2");
    let (audio, extension, mut meta, report) = WavJob {
        executable,
        model_folder,
        data_root,
        log_name: "mrt2-record.log",
        backend: "mlx",
        timeout: Duration::from_secs(120) + Duration::from_secs_f64(capture.seconds()),
    }
    .run_with_report(params, cancel, progress, |output, report| {
        capture.arguments(&bundle, output, report)
    })
    .await?;
    capture.check_wav(&audio)?;
    meta["stream_metrics"] =
        serde_json::to_value(StreamMetrics::read(&report, capture.seconds())?)?;
    Ok((audio, extension, meta))
}

#[cfg(test)]
mod tests;
