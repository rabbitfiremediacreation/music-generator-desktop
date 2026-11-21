use super::{native::WavJob, progress::Progress};
use crate::{
    catalog::{self, ProviderProfile},
    error::{message, Result},
    types::Settings,
};
use serde_json::Value;
use std::{path::Path, time::Duration};
use tokio_util::sync::CancellationToken;

fn arguments(
    model: &Path,
    spec: Option<&Path>,
    backend: &str,
    params: &Value,
) -> Result<Vec<String>> {
    let lyrics = params["lyrics"]
        .as_str()
        .filter(|lyrics| !lyrics.trim().is_empty())
        .ok_or_else(|| message("HeartMuLa requires lyrics"))?;
    let tags = params["style"]
        .as_str()
        .into_iter()
        .flat_map(|style| style.split(','))
        .map(str::trim)
        .filter(|tag| !tag.is_empty())
        .collect::<Vec<_>>()
        .join(",");
    if tags.is_empty() {
        return Err(message("HeartMuLa requires style tags"));
    }
    let seconds = params["duration"]
        .as_f64()
        .filter(|seconds| seconds.is_finite() && *seconds > 0.0)
        .ok_or_else(|| message("Missing HeartMuLa duration"))?;
    let seed = params["seed"]
        .as_u64()
        .and_then(|seed| u32::try_from(seed).ok())
        .ok_or_else(|| message("Missing HeartMuLa seed"))?;

    let mut args = vec![
        "--log".into(),
        "--task".into(),
        "gen".into(),
        "--family".into(),
        "heartmula".into(),
        "--backend".into(),
        backend.into(),
        "--model".into(),
        model.to_string_lossy().into(),
        "--lyrics".into(),
        lyrics.into(),
        "--request-option".into(),
        format!("tags={tags}"),
        "--request-option".into(),
        format!("duration_sec={seconds}"),
        "--session-option".into(),
        "heartmula.mem_saver=true".into(),
        "--seed".into(),
        seed.to_string(),
    ];
    if let Some(spec) = spec {
        args.extend([
            "--model-spec-override".into(),
            spec.to_string_lossy().into(),
        ]);
    }
    Ok(args)
}

fn model_package(profile: &ProviderProfile) -> Result<Option<String>> {
    let files = catalog::required(&profile.selection)?;
    match files.as_slice() {
        [file] if file.role == "weights" && file.file.ends_with(".gguf") => {
            Ok(Some(file.file.clone()))
        }
        _ if profile.selection.synthesis == "heartmula-oss-3b-hny" => Ok(None),
        _ => Err(message("Missing pinned HeartMuLa GGUF package")),
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
    let platform = profile.platform(crate::hardware::inspect())?;
    let executable = profile.runtime.executable(resources);
    let model_folder = Path::new(&settings.models_dir);
    let package = model_package(profile)?;
    let model = model_folder.join(package.as_deref().unwrap_or("heartmula"));
    let spec = executable
        .parent()
        .ok_or_else(|| message("Invalid HeartMuLa runtime location"))?
        .join("model_specs");
    let job = WavJob {
        executable: &executable,
        model_folder,
        data_root,
        log_name: "heartmula.log",
        backend: &platform.backend,
        timeout: Duration::from_secs_f64(settings.timeout_minutes * 60.0),
    };
    // The request has been validated by admission. Parse the persisted fields before launching.
    // GGUF bundles carry their own spec, tokenizer and codec.
    let request = arguments(
        &model,
        package.is_none().then_some(spec.as_path()),
        &platform.backend,
        params,
    )?;
    let (audio, format, mut meta) = job
        .run(params, cancel, progress, |output| {
            let mut args = request;
            args.extend(["--out".into(), output.to_string_lossy().into()]);
            args
        })
        .await?;
    meta["generation_profile"] = params["generation_profile"].clone();
    Ok((audio, format, meta))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        admission::validate_saved_profile,
        catalog::{self, Selection},
        db::Database,
        types::GenerateRequest,
    };

    #[test]
    fn native_arguments_preserve_vocal_text_seed_and_duration_cap() {
        let lyrics = "[Verse]\nStraßenlichter im Regen";
        let params = serde_json::json!({
            "lyrics": lyrics,
            "style": " pop, , drums  , warm vocals ",
            "duration": 12.5,
            "seed": u32::MAX,
        });
        let args = arguments(
            Path::new("model folder"),
            Some(Path::new("model_specs")),
            "metal",
            &params,
        )
        .unwrap();
        assert!(args.windows(2).any(|pair| pair == ["--lyrics", lyrics]));
        assert!(args.windows(2).any(|pair| pair == ["--seed", "4294967295"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--request-option", "duration_sec=12.5"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--request-option", "tags=pop,drums,warm vocals"]));
    }

    #[test]
    fn resolves_each_gguf_from_its_profile_and_keeps_original_directory_mode() {
        let catalog = catalog::catalog();
        let variants = [
            ("heartmula-oss-3b-hny", None),
            (
                "heartmula-oss-3b-hny-q8_0",
                Some("heartmula-gguf/HeartMuLa-oss-3B-HNY-Q8_0.gguf"),
            ),
            (
                "heartmula-oss-3b-q8_0",
                Some("heartmula-gguf/HeartMuLa-oss-3B-Q8_0.gguf"),
            ),
            (
                "heartmula-oss-3b-f16",
                Some("heartmula-gguf/HeartMuLa-oss-3B-F16.gguf"),
            ),
        ];
        for (synthesis, expected) in variants {
            let selection = Selection {
                provider: "heartmula".into(),
                synthesis: synthesis.into(),
                language: String::new(),
            };
            let profile = catalog.profile(&selection).unwrap();
            assert_eq!(profile.capabilities.max_duration, 240);
            assert_eq!(model_package(profile).unwrap().as_deref(), expected);
            if let Some(file) = expected {
                let args = arguments(
                    Path::new(file),
                    None,
                    "metal",
                    &serde_json::json!({"lyrics":"Test", "style":"folk", "duration":240, "seed":42}),
                )
                .unwrap();
                assert!(args.windows(2).any(|pair| pair == ["--model", file]));
                assert!(args
                    .windows(2)
                    .any(|pair| pair == ["--request-option", "duration_sec=240"]));
                assert!(!args.iter().any(|arg| arg == "--model-spec-override"));
            }
        }
    }

    #[test]
    fn saved_native_job_keeps_its_profile_and_resolved_seed_across_retries() {
        let root = tempfile::tempdir().unwrap();
        let db = Database::open(root.path()).unwrap();
        let selection = Selection {
            provider: "heartmula".into(),
            synthesis: "heartmula-oss-3b-hny".into(),
            language: String::new(),
        };
        let profile = catalog::generation_profile(&selection).unwrap();
        let request = GenerateRequest {
            model_selection: Some(selection.clone()),
            style: "folk, cello".into(),
            lyrics: "The river carries on".into(),
            instrumental: false,
            duration: 240.0,
            ..Default::default()
        };
        let too_long = GenerateRequest {
            duration: 240.01,
            ..request.clone()
        };
        assert!(db.enqueue_with_profile(&too_long, Some(&profile)).is_err());
        let id = db
            .enqueue_with_profile(&request, Some(&profile))
            .unwrap()
            .remove(0);
        let (_, original) = db.claim_next().unwrap().unwrap();
        assert_eq!(
            original["generation_profile"],
            serde_json::to_value(&profile).unwrap()
        );
        assert_eq!(original["caption"], "folk, cello");
        assert_eq!(original["duration"], 240.0);
        assert_eq!(original["inference_steps"], 0);
        assert!(original.get("use_cot_caption").is_none());
        assert!(original["seed"].as_u64().is_some());
        validate_saved_profile(&selection, &original).unwrap();
        db.fail(&id, "interrupted").unwrap();
        db.retry(&id).unwrap();
        assert_eq!(db.claim_next().unwrap().unwrap().1, original);
        let mut changed = original;
        changed["generation_profile"]["capabilities"]["max_duration"] = 30.into();
        assert!(validate_saved_profile(&selection, &changed).is_err());
        changed["duration"] = 30.0.into();
        validate_saved_profile(&selection, &changed).unwrap();
        changed["generation_profile"]["runtime_revision"] = "different-runtime".into();
        assert!(validate_saved_profile(&selection, &changed).is_err());
    }
}
