use super::{native::WavJob, progress::Progress};
use crate::{
    audio_facts,
    error::{message, Error, Result},
    types::Settings,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::{path::Path, time::Duration};
use tokio_util::sync::CancellationToken;

pub(crate) const VAE_FILE: &str = "yue2/YuE2-Vae-F32.gguf";
pub(crate) const MIN_DURATION_SECONDS: u32 = 10;
pub(crate) const MAX_DURATION_SECONDS: u32 = 60;
pub(crate) const DEFAULT_DURATION_SECONDS: u32 = 30;
const SAMPLE_RATE: u32 = 48_000;
const FLOW_STEPS: u32 = 32;

/// The native runner caps its semantic frames at 25 Hz and can end the song early.
pub(crate) fn duration_limit(seconds: f64) -> Result<f64> {
    if seconds == 0.0 {
        return Ok(f64::from(DEFAULT_DURATION_SECONDS));
    }
    if (f64::from(MIN_DURATION_SECONDS)..=f64::from(MAX_DURATION_SECONDS)).contains(&seconds) {
        return Ok(seconds);
    }
    Err(message(format!(
        "YuE2 duration must be between {MIN_DURATION_SECONDS} and {MAX_DURATION_SECONDS} seconds"
    )))
}

#[derive(Serialize)]
struct Request<'a> {
    style: &'a str,
    lyrics: &'a str,
    duration: f64,
    lm_seed: i64,
    seed: i64,
    steps: u32,
    output_format: &'static str,
    peak_clip: u32,
}

impl<'a> Request<'a> {
    fn from_params(params: &'a Value) -> Result<Self> {
        let style = params["caption"].as_str().unwrap_or_default();
        let lyrics = params["lyrics"].as_str().unwrap_or_default();
        if style.trim().is_empty() || lyrics.trim().is_empty() || params["instrumental"] == true {
            return Err(message("YuE2 needs a style and lyrics"));
        }
        let seed = params["seed"]
            .as_i64()
            .filter(|seed| *seed >= 0)
            .ok_or_else(|| message("YuE2 needs a resolved song seed"))?;
        Ok(Self {
            style,
            lyrics,
            duration: duration_limit(params["duration"].as_f64().unwrap_or_default())?,
            lm_seed: seed,
            seed,
            steps: FLOW_STEPS,
            output_format: "wav16",
            peak_clip: 0,
        })
    }
}

/// The native runner writes a fixed 44-byte header for stereo 16-bit PCM.
fn verify_stereo_wav(audio: &[u8]) -> Result<()> {
    let valid_header = audio.get(12..36).is_some_and(|format| {
        &format[..8] == b"fmt \x10\0\0\0"
            && format[8..12] == [1, 0, 2, 0]
            && format[12..16] == SAMPLE_RATE.to_le_bytes()
            && format[20..24] == [4, 0, 16, 0]
    });
    if !valid_header || audio.get(36..40) != Some(b"data") {
        return Err(message("YuE2 returned audio in an unexpected WAV format"));
    }
    Ok(())
}

/// Run one native synthesis job in the app's data folder and return its verified stereo WAV.
pub(crate) async fn generate(
    executable: &Path,
    data: &Path,
    settings: &Settings,
    params: &Value,
    cancel: &CancellationToken,
    progress: impl Fn(Progress),
) -> Result<(Vec<u8>, String, Value)> {
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    let request = Request::from_params(params)?;
    let input = tempfile::Builder::new()
        .prefix("yue2-request-")
        .suffix(".json")
        .tempfile_in(data)?;
    tokio::fs::write(input.path(), serde_json::to_vec(&request)?).await?;
    let models = Path::new(&settings.models_dir);
    let job = WavJob {
        executable,
        model_folder: models,
        data_root: data,
        log_name: "yue-synth.log",
        backend: "metal",
        timeout: Duration::from_secs_f64(settings.timeout_minutes * 60.0),
    };
    let (audio, extension, mut meta) = job
        .run(params, cancel, progress, |output| {
            vec![
                "--model".into(),
                models
                    .join(&settings.synthesis_model)
                    .to_string_lossy()
                    .into(),
                "--vae".into(),
                models.join(VAE_FILE).to_string_lossy().into(),
                "--request".into(),
                input.path().to_string_lossy().into(),
                "--out".into(),
                output.to_string_lossy().into(),
                "--device".into(),
                "MTL0".into(),
            ]
        })
        .await?;
    verify_stereo_wav(&audio)?;
    let seconds = meta["duration"]
        .as_f64()
        .ok_or_else(|| message("YuE2 returned no measurable WAV duration"))?;
    // The CLI quantizes the request to its 25 Hz frame rate before decoding.
    if seconds > request.duration + 0.04 {
        return Err(message(
            "YuE2 returned audio beyond the supported duration limit",
        ));
    }
    meta["lm_seed"] = json!(request.lm_seed);
    meta["duration_limit"] = json!(request.duration);
    meta["output_format"] = json!(request.output_format);
    meta["sample_rate"] = json!(SAMPLE_RATE);
    meta["channels"] = json!(2);
    audio_facts::record_duration(seconds, params, &mut meta);
    Ok((audio, extension, meta))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_only_supported_inputs_to_one_wav_request() {
        let params = json!({
            "caption": "soul, piano",
            "lyrics": "[Verse]\nWe keep the light on",
            "duration": 47.5,
            "seed": i64::MAX - 1,
            "bpm": 100,
            "inference_steps": 200,
            "abc": "X:1",
            "variants": 8,
        });
        assert_eq!(
            serde_json::to_value(Request::from_params(&params).unwrap()).unwrap(),
            json!({
                "style": "soul, piano",
                "lyrics": "[Verse]\nWe keep the light on",
                "duration": 47.5,
                "lm_seed": i64::MAX - 1,
                "seed": i64::MAX - 1,
                "steps": 32,
                "output_format": "wav16",
                "peak_clip": 0,
            })
        );
    }

    #[test]
    fn applies_an_explicit_duration_cap_even_when_client_omits_duration() {
        assert_eq!(duration_limit(0.0).unwrap(), 30.0);
        assert_eq!(duration_limit(10.0).unwrap(), 10.0);
        assert_eq!(duration_limit(60.0).unwrap(), 60.0);
        for duration in [f64::NAN, -1.0, 9.99, 60.01] {
            assert!(duration_limit(duration).is_err());
        }
    }

    #[test]
    fn validates_stereo_pcm_at_the_expected_rate() {
        let mut wav = b"RIFF\x28\0\0\0WAVEfmt \x10\0\0\0\x01\0\x02\0\x80\xbb\0\0\0\xee\x02\0\x04\0\x10\0data\x04\0\0\0\0\0\0\0".to_vec();
        assert!(verify_stereo_wav(&wav).is_ok());
        assert!(verify_stereo_wav(&wav[..30]).is_err());
        wav[22] = 1;
        assert!(verify_stereo_wav(&wav).is_err());
        wav[22] = 2;
        wav[24] = 0;
        assert!(verify_stereo_wav(&wav).is_err());
    }
}
