use super::{
    native::{wav_metadata, WavJob},
    progress::Progress,
};
use crate::{
    audio_facts,
    error::{message, Error, Result},
    types::Settings,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    path::Path,
    time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;

pub(crate) mod options;
mod progress;
mod score;

use options::{Yue2Options, DEFAULT_FLOW_STEPS};

pub(crate) const VAE_FILE: &str = "yue2/YuE2-Vae-F32.gguf";
pub(crate) const MIN_DURATION_SECONDS: u32 = 10;
pub(crate) const MAX_DURATION_SECONDS: u32 = 360;
pub(crate) const DEFAULT_DURATION_SECONDS: u32 = 30;
const SAMPLE_RATE: u32 = 48_000;

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
    style: std::borrow::Cow<'a, str>,
    lyrics: &'a str,
    duration: f64,
    seed: i64,
    output_format: &'static str,
    #[serde(flatten)]
    options: Yue2Options,
}

impl<'a> Request<'a> {
    fn from_params(params: &'a Value) -> Result<Self> {
        let style = params["caption"].as_str().unwrap_or_default();
        let instrumental = params["instrumental"] == true;
        let lyrics = if instrumental {
            ""
        } else {
            params["lyrics"].as_str().unwrap_or_default()
        };
        if style.trim().is_empty()
            || (!instrumental
                && (lyrics.trim().is_empty()
                    || lyrics.trim().eq_ignore_ascii_case("[instrumental]")))
        {
            return Err(message("YuE2 needs a style and lyrics"));
        }
        let seed = params["seed"]
            .as_i64()
            .filter(|seed| *seed >= 0)
            .ok_or_else(|| message("YuE2 needs a resolved song seed"))?;
        let mut options: Yue2Options = params
            .get("yue2")
            .filter(|options| !options.is_null())
            .map(|options| serde_json::from_value(options.clone()))
            .transpose()?
            .unwrap_or_default();
        options.validate(instrumental)?;
        let lm_seed = options.lm_seed.get_or_insert(seed);
        if *lm_seed < 0 {
            return Err(message("YuE2 needs a resolved language model seed"));
        }
        options.steps.get_or_insert(DEFAULT_FLOW_STEPS);
        options.peak_clip.get_or_insert(0);
        options.abc = options.abc.take().filter(|abc| !abc.trim().is_empty());
        if instrumental {
            options.abc = options.abc.and_then(|abc| score::instrumental_score(&abc));
        }
        Ok(Self {
            style: if instrumental {
                format!("Instrumental, {}, no vocals", style.trim()).into()
            } else {
                style.into()
            },
            lyrics,
            duration: duration_limit(params["duration"].as_f64().unwrap_or_default())?,
            seed,
            output_format: "wav16",
            options,
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
    let mut request = Request::from_params(params)?;
    let started = Instant::now();
    let report = |mut update: Progress| {
        update.elapsed_seconds = started.elapsed().as_secs();
        progress(update);
    };
    let timeout = Duration::from_secs_f64(settings.timeout_minutes * 60.0);
    let input = tempfile::Builder::new()
        .prefix("yue2-request-")
        .suffix(".json")
        .tempfile_in(data)?;
    let models = Path::new(&settings.models_dir);
    let model = models.join(&settings.synthesis_model);
    let model = model.to_string_lossy().into_owned();
    let instrumental = params["instrumental"] == true;
    let mut lm_seed = request.options.lm_seed.unwrap_or(request.seed);
    if instrumental && request.options.abc.is_none() {
        let planner = executable.with_file_name("yue-plan");
        if !planner.is_file() {
            return Err(message(
                "The YuE2 instrumental planner is missing. Prepare the engine resources again.",
            ));
        }
        tokio::fs::write(input.path(), serde_json::to_vec(&request)?).await?;
        let alternate_seed = lm_seed.checked_add(1).unwrap_or(0);
        for planning_seed in [lm_seed, alternate_seed] {
            let mut log = self::progress::Yue2Progress::default();
            let planning = WavJob {
                executable: &planner,
                model_folder: models,
                data_root: data,
                log_name: "yue-plan.log",
                backend: "metal",
                timeout: timeout.saturating_sub(started.elapsed()),
            };
            let (abc, _) = planning
                .run_file_observed(
                    "abc",
                    params,
                    cancel,
                    &report,
                    |output| {
                        vec![
                            "--model".into(),
                            model.clone(),
                            "--request".into(),
                            input.path().to_string_lossy().into(),
                            "--out".into(),
                            output.to_string_lossy().into(),
                            "--device".into(),
                            "MTL0".into(),
                            "--lm-seed".into(),
                            planning_seed.to_string(),
                        ]
                    },
                    |line| log.parse(line),
                )
                .await?;
            if let Some(abc) = std::str::from_utf8(&abc)
                .ok()
                .and_then(score::instrumental_score)
            {
                request.options.abc = Some(abc);
                lm_seed = planning_seed;
                break;
            }
        }
        if request.options.abc.is_none() {
            return Err(message(
                "YuE2 could not prepare an instrumental score. Try again with another seed.",
            ));
        }
    }
    let remaining = timeout.saturating_sub(started.elapsed());
    if remaining.is_zero() {
        return Err(message(
            "YuE2 generation timed out before rendering the score",
        ));
    }
    tokio::fs::write(input.path(), serde_json::to_vec(&request)?).await?;
    let job = WavJob {
        executable,
        model_folder: models,
        data_root: data,
        log_name: "yue-synth.log",
        backend: "metal",
        timeout: remaining,
    };
    let mut log = self::progress::Yue2Progress::default();
    let (audio, meta) = job
        .run_file_observed(
            "wav",
            params,
            cancel,
            report,
            |output| {
                vec![
                    "--model".into(),
                    model,
                    "--vae".into(),
                    models.join(VAE_FILE).to_string_lossy().into(),
                    "--request".into(),
                    input.path().to_string_lossy().into(),
                    "--out".into(),
                    output.to_string_lossy().into(),
                    "--device".into(),
                    "MTL0".into(),
                ]
            },
            |line| log.parse(line),
        )
        .await?;
    verify_stereo_wav(&audio)?;
    let mut meta = wav_metadata(&audio, params, meta)?;
    let seconds = meta["duration"]
        .as_f64()
        .ok_or_else(|| message("YuE2 returned no measurable WAV duration"))?;
    // The CLI quantizes the request to its 25 Hz frame rate before decoding.
    if seconds > request.duration + 0.04 {
        return Err(message(
            "YuE2 returned audio beyond the supported duration limit",
        ));
    }
    meta["lm_seed"] = json!(request.options.lm_seed);
    if instrumental && request.options.lm_seed != Some(lm_seed) {
        meta["planning_seed"] = json!(lm_seed);
    }
    meta["effective_inference_steps"] = json!(request.options.steps);
    meta["duration_limit"] = json!(request.duration);
    meta["output_format"] = json!(request.output_format);
    meta["sample_rate"] = json!(SAMPLE_RATE);
    meta["channels"] = json!(2);
    if instrumental {
        meta["instrumental"] = json!(true);
        meta["runtime_seconds"] = json!(started.elapsed().as_secs_f64());
    }
    audio_facts::record_duration(seconds, params, &mut meta);
    Ok((audio, "wav".into(), meta))
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
    fn forwards_each_stage_setting_to_the_cli_request() {
        let params = json!({
            "caption": "soul", "lyrics": "[Verse]\nSing", "duration": 60, "seed": 17,
            "yue2": {
                "lm_seed": 99, "steps": 19, "cot": "melody", "cfg_scale": 1.25, "peak_clip": 30,
                "abc": "X:1\nM:4/4\nK:C\nCDEF|",
                "abc_sampling": {"temperature": 0.5, "top_k": 12, "penalty_window": 40},
                "semantic_sampling": {"top_p": 0.75, "repetition_penalty": 1.25, "min_tokens": 10, "max_tokens": 100}
            }
        });
        let value = serde_json::to_value(Request::from_params(&params).unwrap()).unwrap();
        for (name, setting) in params["yue2"].as_object().unwrap() {
            assert_eq!(value[name], *setting);
        }
        assert_eq!(value["seed"], 17);
        assert_eq!(value["output_format"], "wav16");
        let mut invalid = params.clone();
        invalid["yue2"]["semantic_sampling"]["min_tokens"] = 101.into();
        assert!(Request::from_params(&invalid).is_err());
        invalid = params;
        invalid["yue2"]["cot"] = "off".into();
        assert!(Request::from_params(&invalid).is_err());
    }

    #[test]
    fn applies_an_explicit_duration_cap_even_when_client_omits_duration() {
        assert_eq!(duration_limit(0.0).unwrap(), 30.0);
        assert_eq!(duration_limit(10.0).unwrap(), 10.0);
        assert_eq!(duration_limit(360.0).unwrap(), 360.0);
        for duration in [f64::NAN, -1.0, 9.99, 360.01] {
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
