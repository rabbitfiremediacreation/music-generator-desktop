use super::{native::WavJob, progress::Progress};
use crate::{
    audio_facts,
    catalog::ProviderProfile,
    error::{message, Result},
    generation_limits::validate_request,
    types::{GenerateRequest, Settings},
};
use serde_json::{json, Value};
use std::{path::Path, time::Duration};
use tokio_util::sync::CancellationToken;

const SAMPLE_RATE: u32 = 48_000;

struct Clip<'a> {
    description: &'a str,
    bars: u32,
    bpm: u32,
    seed: u32,
    device: &'static str,
}

impl Clip<'_> {
    fn arguments(&self, models: &Path, output: &Path) -> Vec<String> {
        vec![
            "--model-folder".into(),
            models.to_string_lossy().into_owned(),
            "--output".into(),
            output.to_string_lossy().into_owned(),
            format!("--prompt={}", self.description),
            "--bars".into(),
            self.bars.to_string(),
            "--bpm".into(),
            self.bpm.to_string(),
            "--seed".into(),
            self.seed.to_string(),
            "--device".into(),
            self.device.into(),
        ]
    }

    fn check_output(&self, wav: &[u8]) -> Result<()> {
        let format = audio_facts::wav_facts(wav)?;
        let frames = u64::from(self.bars) * 240 * u64::from(SAMPLE_RATE) / u64::from(self.bpm);
        if format.sample_rate_hz != SAMPLE_RATE
            || format.channels != 2
            || format.bits_per_sample != 24
            || format.frames != frames
        {
            return Err(message(format!(
                "Mimetic A0 must return {frames} frames of 48 kHz stereo PCM24 WAV"
            )));
        }
        Ok(())
    }
}

pub(crate) async fn generate(
    resources: &Path,
    data_root: &Path,
    settings: &Settings,
    profile: &ProviderProfile,
    params: &Value,
    cancel: &CancellationToken,
    progress: impl Fn(Progress),
) -> Result<(Vec<u8>, String, Value)> {
    let request: GenerateRequest = serde_json::from_value(params.clone())?;
    validate_request(&request, &profile.capabilities)?;
    let backend = profile
        .platform(crate::hardware::inspect())?
        .backend
        .as_str();
    let description = request.caption.trim();
    if description.is_empty() || description.contains('\0') {
        return Err(message("Invalid saved short-clip description"));
    }
    let clip = Clip {
        description,
        bars: request.bars.ok_or_else(|| message("Missing bar count"))?,
        bpm: request.bpm,
        seed: u32::try_from(request.seed).map_err(|_| message("Invalid saved Mimetic A0 seed"))?,
        device: match backend {
            "metal" => "mps",
            "cpu" => "cpu",
            "cuda" => "cuda",
            _ => return Err(message("Unknown Mimetic A0 backend")),
        },
    };
    let executable = profile.runtime.executable(resources);
    let job = WavJob {
        executable: &executable,
        model_folder: Path::new(&settings.models_dir),
        data_root,
        log_name: "mimetic-a0.log",
        backend,
        timeout: Duration::try_from_secs_f64(settings.timeout_minutes * 60.0)
            .map_err(|_| message("Invalid generation timeout"))?,
    };
    let (wav, extension, mut meta) = job
        .run(params, cancel, progress, |path| {
            clip.arguments(job.model_folder, path)
        })
        .await?;
    clip.check_output(&wav)?;
    meta["bars"] = json!(clip.bars);
    meta["bpm"] = json!(clip.bpm);
    meta["timesignature"] = json!("4/4");
    Ok((wav, extension, meta))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wav(rate: u32, channels: u16, bits: u16, frames: u32) -> Vec<u8> {
        let align = channels * bits / 8;
        let data = frames * u32::from(align);
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(36 + data).to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&channels.to_le_bytes());
        wav.extend_from_slice(&rate.to_le_bytes());
        wav.extend_from_slice(&(rate * u32::from(align)).to_le_bytes());
        wav.extend_from_slice(&align.to_le_bytes());
        wav.extend_from_slice(&bits.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&data.to_le_bytes());
        wav.resize(44 + data as usize, 0);
        wav
    }

    #[test]
    fn runner_receives_meter_seed_paths_and_description_as_arguments() {
        let clip = Clip {
            description: "--bpm=33, offene Hi-Hat",
            bars: 1,
            bpm: 124,
            seed: u32::MAX,
            device: "mps",
        };
        assert_eq!(
            clip.arguments(Path::new("/models Musík"), Path::new("/work dir/song.wav")),
            [
                "--model-folder",
                "/models Musík",
                "--output",
                "/work dir/song.wav",
                "--prompt=--bpm=33, offene Hi-Hat",
                "--bars",
                "1",
                "--bpm",
                "124",
                "--seed",
                "4294967295",
                "--device",
                "mps",
            ]
        );
    }

    #[test]
    fn crop_has_exact_frames_and_requires_stereo_48khz_pcm24() {
        let clip = Clip {
            description: "house drums",
            bars: 1,
            bpm: 124,
            seed: 31,
            device: "mps",
        };
        let frames = 92_903;
        assert!(clip.check_output(&wav(48_000, 2, 24, frames)).is_ok());
        for invalid in [
            wav(48_000, 2, 24, frames + 1),
            wav(48_000, 1, 24, frames),
            wav(48_000, 2, 16, frames),
            wav(44_100, 2, 24, frames),
        ] {
            assert!(clip.check_output(&invalid).is_err());
        }
    }
}

#[cfg(all(test, target_os = "macos", target_arch = "aarch64"))]
mod acceptance;
