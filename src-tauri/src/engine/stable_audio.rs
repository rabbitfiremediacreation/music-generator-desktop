use super::{native::WavJob, progress::Progress};
use crate::{
    catalog::{self, GenerationCapabilities, ProviderProfile},
    error::{message, Result},
    types::Settings,
};
use serde_json::Value;
use std::{path::Path, time::Duration};
use tokio_util::sync::CancellationToken;

fn arguments(
    model: &Path,
    spec: &Path,
    backend: &str,
    capabilities: &GenerationCapabilities,
    sfx: bool,
    params: &Value,
) -> Result<Vec<String>> {
    let prompt = params["caption"]
        .as_str()
        .filter(|prompt| !prompt.trim().is_empty() && !prompt.contains('\0'))
        .ok_or_else(|| message("Stable Audio 3 requires a valid prompt"))?;
    let duration_range =
        f64::from(capabilities.min_duration)..=f64::from(capabilities.max_duration);
    let seconds = crate::audio_facts::requested_duration(params)
        .filter(|seconds| duration_range.contains(seconds))
        .ok_or_else(|| message("Invalid Stable Audio 3 duration"))?;
    let seed = params["seed"]
        .as_u64()
        .ok_or_else(|| message("Missing Stable Audio 3 seed"))?;

    let prompt = prompt.trim().replace('|', ",");
    let text = if sfx {
        prompt
    } else {
        format!("TrackType: Music, VocalType: Instrumental, {prompt}")
    };
    Ok(vec![
        "--task".into(),
        "gen".into(),
        "--family".into(),
        "stable_audio".into(),
        "--backend".into(),
        backend.into(),
        "--model".into(),
        model.to_string_lossy().into(),
        "--model-spec-override".into(),
        spec.to_string_lossy().into(),
        "--text".into(),
        text,
        "--request-option".into(),
        format!("duration_sec={seconds}"),
        "--session-option".into(),
        "stable_audio.mem_saver=true".into(),
        "--seed".into(),
        seed.to_string(),
    ])
}

fn verify_output(audio: &[u8], duration: Option<f64>, max_duration: u32) -> Result<()> {
    // WavJob validates PCM before this check. The audio.cpp launcher writes fmt first.
    if audio.get(12..16) != Some(b"fmt ") || audio.get(22..24) != Some(&[2, 0]) {
        return Err(message("Stable Audio 3 did not return stereo WAV audio"));
    }
    if !duration.is_some_and(|seconds| seconds <= f64::from(max_duration)) {
        return Err(message(
            "Stable Audio 3 exceeded its maximum output duration",
        ));
    }
    Ok(())
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
    let platform = profile.platform(crate::hardware::inspect())?;
    let executable = profile.runtime.executable(resources);
    let model_folder = Path::new(&settings.models_dir);
    let checkpoint = catalog::required(&profile.selection)?
        .into_iter()
        .find(|asset| {
            asset.role == "weights"
                && asset.source.as_ref().is_some_and(|source| {
                    source.path == "model.safetensors" || source.path.ends_with(".gguf")
                })
        })
        .ok_or_else(|| message("Missing Stable Audio 3 checkpoint pin"))?;
    // Pass the verified checkpoint itself so neighboring files cannot change which format is loaded.
    let model = model_folder.join(checkpoint.file);
    let spec = executable
        .parent()
        .ok_or_else(|| message("Invalid Stable Audio 3 runtime location"))?
        .join("model_specs/stable_audio.json");
    let job = WavJob {
        executable: &executable,
        model_folder,
        data_root,
        log_name: "stable-audio-3.log",
        backend: &platform.backend,
        timeout: Duration::from_secs_f64(settings.timeout_minutes * 60.0),
    };
    let request = arguments(
        &model,
        &spec,
        &platform.backend,
        &profile.capabilities,
        checkpoint.family == "stable-audio-3-small-sfx",
        params,
    )?;
    let (audio, format, mut meta) = job
        .run(params, cancel, progress, |output| {
            let mut args = request;
            args.extend(["--out".into(), output.to_string_lossy().into()]);
            args
        })
        .await?;
    verify_output(
        &audio,
        meta["duration"].as_f64(),
        profile.capabilities.max_duration,
    )?;
    meta["generation_profile"] = params["generation_profile"].clone();
    Ok((audio, format, meta))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn capabilities(max_duration: u32) -> GenerationCapabilities {
        GenerationCapabilities {
            min_duration: 5,
            max_duration,
            max_variants: 1,
            prompt: true,
            style_description: false,
            lyrics: false,
            lyrics_required: false,
            instrumental: true,
            bpm: false,
            advanced: false,
            analysis: false,
            reference_audio: false,
            yue2_options: false,
            max_seed: None,
            output_kind: crate::types::OutputKind::Audio,
            bars: None,
        }
    }

    fn command(max_duration: u32, params: &Value) -> Result<Vec<String>> {
        arguments(
            Path::new("Model Files/model.safetensors"),
            Path::new("model_specs/stable_audio.json"),
            "metal",
            &capabilities(max_duration),
            false,
            params,
        )
    }

    #[test]
    fn the_sfx_route_uses_the_pinned_gguf_and_keeps_its_prompt() {
        let args = arguments(
            Path::new("stable-audio-3-small-sfx/stable-audio-3-small-sfx-q8_0.gguf"),
            Path::new("model_specs/stable_audio.json"),
            "metal",
            &capabilities(10),
            true,
            &serde_json::json!({"caption": "oncoming train", "duration": 7, "seed": 2}),
        )
        .unwrap();
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--text", "oncoming train"]));
        assert!(args.windows(2).any(|pair| pair
            == [
                "--model",
                "stable-audio-3-small-sfx/stable-audio-3-small-sfx-q8_0.gguf"
            ]));
    }

    #[test]
    fn passes_the_verified_checkpoint_and_single_instrumental_prompt() {
        let params = json!({
            "caption": "--drums | café piano",
            "duration": 12.5,
            "seed": 42,
            "lyrics": "[Instrumental]",
        });
        assert_eq!(
            command(120, &params).unwrap(),
            [
                "--task",
                "gen",
                "--family",
                "stable_audio",
                "--backend",
                "metal",
                "--model",
                "Model Files/model.safetensors",
                "--model-spec-override",
                "model_specs/stable_audio.json",
                "--text",
                "TrackType: Music, VocalType: Instrumental, --drums , café piano",
                "--request-option",
                "duration_sec=12.5",
                "--session-option",
                "stable_audio.mem_saver=true",
                "--seed",
                "42",
            ]
        );
    }

    #[test]
    fn enforces_each_profile_duration_and_resolved_seed() {
        for max_duration in [120, 380] {
            let mut params = json!({"caption": "ambient", "duration": max_duration, "seed": 0});
            assert!(command(max_duration, &params).is_ok());
            params["duration"] = json!(f64::from(max_duration) + 0.01);
            assert!(command(max_duration, &params).is_err());
            params["duration"] = json!(4.99);
            assert!(command(max_duration, &params).is_err());
            params["duration"] = json!(5);
            assert!(command(max_duration, &params).is_ok());
            params["seed"] = json!(-1);
            assert!(command(max_duration, &params).is_err());
            params["seed"] = json!(0);
            params["caption"] = json!("invalid\0prompt");
            assert!(command(max_duration, &params).is_err());
        }
    }

    fn silent_wav(channels: u16, seconds: u32) -> Vec<u8> {
        let rate = 1000u32;
        let frame_bytes = channels * 2;
        let byte_rate = rate * u32::from(frame_bytes);
        let data_bytes = seconds * byte_rate;
        let mut wav = Vec::new();
        wav.extend(b"RIFF");
        wav.extend((data_bytes + 36).to_le_bytes());
        wav.extend(b"WAVEfmt ");
        wav.extend(16u32.to_le_bytes());
        wav.extend(1u16.to_le_bytes());
        wav.extend(channels.to_le_bytes());
        wav.extend(rate.to_le_bytes());
        wav.extend(byte_rate.to_le_bytes());
        wav.extend(frame_bytes.to_le_bytes());
        wav.extend(16u16.to_le_bytes());
        wav.extend(b"data");
        wav.extend(data_bytes.to_le_bytes());
        wav.resize(44 + data_bytes as usize, 0);
        wav
    }

    #[test]
    fn expects_stereo_and_checks_the_measured_duration() {
        let measured = |audio: &[u8]| Some(crate::audio_facts::duration(audio).unwrap());
        for max_duration in [120, 380] {
            let stereo = silent_wav(2, max_duration);
            assert!(verify_output(&stereo, measured(&stereo), max_duration).is_ok());
            let mono = silent_wav(1, max_duration);
            assert!(verify_output(&mono, measured(&mono), max_duration).is_err());
            let long = silent_wav(2, max_duration + 1);
            assert!(verify_output(&long, measured(&long), max_duration).is_err());
        }
    }
}
