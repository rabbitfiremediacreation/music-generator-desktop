use super::{native::WavJob, progress::Progress};
use crate::{
    catalog::ProviderProfile,
    error::{message, Result},
    types::Settings,
};
use serde_json::{json, Value};
use std::{path::Path, time::Duration};
use tokio_util::sync::CancellationToken;

fn arguments(model: &Path, reference: &Path, backend: &str, params: &Value) -> Result<Vec<String>> {
    let style = params["style"]
        .as_str()
        .map(str::trim)
        .filter(|style| !style.is_empty())
        .ok_or_else(|| message("MuLaCover requires a style description"))?;
    let lyrics = params["lyrics"]
        .as_str()
        .filter(|lyrics| !lyrics.trim().is_empty())
        .ok_or_else(|| message("MuLaCover requires lyrics"))?;
    let seconds = crate::audio_facts::requested_duration(params)
        .ok_or_else(|| message("Missing MuLaCover duration"))?;
    let seed = params["seed"]
        .as_u64()
        .and_then(|seed| u32::try_from(seed).ok())
        .ok_or_else(|| message("Missing or invalid MuLaCover seed"))?;

    Ok(vec![
        "--log".into(),
        "--task".into(),
        "gen".into(),
        "--family".into(),
        "mulacover".into(),
        "--backend".into(),
        backend.into(),
        "--model".into(),
        model.to_string_lossy().into(),
        "--model-spec-override".into(),
        "embedded".into(),
        "--audio".into(),
        reference.to_string_lossy().into(),
        "--request-option".into(),
        format!("tags={style}"),
        "--request-option".into(),
        format!("duration_sec={seconds}"),
        "--seed".into(),
        seed.to_string(),
        "--request-option".into(),
        format!("lyrics={lyrics}"),
    ])
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
    let [model_file] = profile.files.as_slice() else {
        return Err(message(
            "MuLaCover requires one complete GGUF in the verified model profile",
        ));
    };
    let token = params["reference_audio"]
        .as_str()
        .ok_or_else(|| message("Choose a WAV reference for MuLaCover"))?;
    let reference = crate::reference_audio::resolve(data_root, token)?;
    let executable = profile.runtime.executable(resources);
    let model_folder = Path::new(&settings.models_dir);
    let args = arguments(
        &model_folder.join(model_file),
        &reference,
        &platform.backend,
        params,
    )?;
    let job = WavJob {
        executable: &executable,
        model_folder,
        data_root,
        log_name: "mulacover.log",
        backend: &platform.backend,
        timeout: Duration::from_secs_f64(settings.timeout_minutes * 60.0),
    };
    let (audio, format, mut meta) = job
        .run(params, cancel, progress, |output| {
            let mut args = args;
            args.extend(["--out".into(), output.to_string_lossy().into()]);
            args
        })
        .await?;
    if !crate::audio_facts::is_stereo_48khz_pcm16(&audio) {
        return Err(message(
            "MuLaCover returned audio outside its 48 kHz stereo PCM16 WAV format",
        ));
    }
    meta["generation_profile"] = params["generation_profile"].clone();
    meta["reference_mode"] = json!("audio");
    meta["duration_is_limit"] = json!(true);
    if let Some(seconds) = meta["duration"].as_f64() {
        crate::audio_facts::record_duration(seconds, params, &mut meta);
    }
    Ok((audio, format, meta))
}

#[cfg(test)]
mod tests {
    use super::*;

    const MODEL_FILE: &str = "mulacover/MuLaCover-Q8_0.gguf";
    use crate::{
        catalog::{self, Selection},
        db::Database,
        types::GenerateRequest,
    };
    use sha2::{Digest, Sha256};

    #[test]
    fn local_audio_is_the_only_reference_passed_to_the_runtime() {
        let params = json!({
            "style": "genre:[folk]; instrument:[piano,cello]",
            "lyrics": "[Verse]\nEin grüner Morgen",
            "duration": 12.5,
            "seed": 42,
            "reference_audio": "opaque-token",
            "melody_file": "untrusted.mid",
        });
        assert_eq!(
            arguments(
                Path::new(MODEL_FILE),
                Path::new("reference audio.wav"),
                "metal",
                &params
            )
            .unwrap(),
            [
                "--log",
                "--task",
                "gen",
                "--family",
                "mulacover",
                "--backend",
                "metal",
                "--model",
                MODEL_FILE,
                "--model-spec-override",
                "embedded",
                "--audio",
                "reference audio.wav",
                "--request-option",
                "tags=genre:[folk]; instrument:[piano,cello]",
                "--request-option",
                "duration_sec=12.5",
                "--seed",
                "42",
                "--request-option",
                "lyrics=[Verse]\nEin grüner Morgen",
            ]
        );
    }

    #[test]
    fn lyrics_and_style_cannot_be_interpreted_as_cli_flags() {
        let params = json!({"style": "--log", "lyrics": "--model", "duration": 10, "seed": 0});
        let args = arguments(
            Path::new(MODEL_FILE),
            Path::new("reference.wav"),
            "metal",
            &params,
        )
        .unwrap();
        assert!(args.iter().any(|arg| arg == "tags=--log"));
        assert!(args.iter().any(|arg| arg == "lyrics=--model"));
        assert_eq!(args.iter().filter(|arg| *arg == "--model").count(), 1);
    }

    #[test]
    fn invalid_saved_inputs_are_rejected_before_launch() {
        let model = Path::new(MODEL_FILE);
        let reference = Path::new("reference.wav");
        for params in [
            json!({"style": "  ", "lyrics": "Words", "duration": 10, "seed": 0}),
            json!({"style": "folk", "lyrics": "  ", "duration": 10, "seed": 0}),
            json!({"style": "folk", "lyrics": "Words", "duration": 0, "seed": 0}),
            json!({"style": "folk", "lyrics": "Words", "duration": 10, "seed": -1}),
            json!({"style": "folk", "lyrics": "Words", "duration": 10, "seed": u64::from(u32::MAX) + 1}),
        ] {
            assert!(arguments(model, reference, "metal", &params).is_err());
        }
    }

    #[test]
    fn retry_keeps_reference_style_seed_and_model_snapshot() {
        let root = tempfile::tempdir().unwrap();
        let db = Database::open(root.path()).unwrap();
        let selection = Selection {
            provider: "mulacover".into(),
            synthesis: "mulacover-noncommercial".into(),
            language: String::new(),
        };
        let profile = catalog::generation_profile(&selection).unwrap();
        assert!(profile.files.iter().any(|model| model.file == MODEL_FILE));
        let mut wav = b"RIFF\x28\0\0\0WAVEfmt \x10\0\0\0\x01\0\x01\0".to_vec();
        wav.extend(16_000u32.to_le_bytes());
        wav.extend(32_000u32.to_le_bytes());
        wav.extend(b"\x02\0\x10\0data\x04\0\0\0\0\0\x01\0");
        let reference = format!("{:x}", Sha256::digest(&wav));
        let folder = root.path().join("reference-audio");
        std::fs::create_dir(&folder).unwrap();
        std::fs::write(folder.join(format!("{reference}.wav")), wav).unwrap();
        let request = GenerateRequest {
            model_selection: Some(selection.clone()),
            reference_audio: Some(reference.clone()),
            style: "genre:[folk]; instrument:[piano,cello]".into(),
            lyrics: "[Verse]\nListen to the morning".into(),
            instrumental: false,
            duration: f64::from(profile.capabilities.min_duration),
            ..Default::default()
        };
        let id = db
            .enqueue_with_profile(&request, Some(&profile))
            .unwrap()
            .remove(0);
        let (_, saved) = db.claim_next().unwrap().unwrap();
        assert_eq!(saved["reference_audio"], reference);
        assert_eq!(saved["style"], request.style);
        assert!(saved["seed"].as_u64().is_some());
        crate::admission::validate_saved_profile(&selection, &saved).unwrap();
        db.fail(&id, "interrupted").unwrap();
        db.retry(&id).unwrap();
        assert_eq!(db.claim_next().unwrap().unwrap().1, saved);
    }
}
