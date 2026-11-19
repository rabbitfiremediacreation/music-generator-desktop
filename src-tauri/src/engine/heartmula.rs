use super::{native::WavJob, progress::Progress};
use crate::{
    catalog::ProviderProfile,
    error::{message, Result},
    types::Settings,
};
use serde_json::Value;
use std::{path::Path, time::Duration};
use tokio_util::sync::CancellationToken;

fn arguments(model: &Path, spec: &Path, backend: &str, params: &Value) -> Result<Vec<String>> {
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

    Ok(vec![
        "--log".into(),
        "--task".into(),
        "gen".into(),
        "--family".into(),
        "heartmula".into(),
        "--backend".into(),
        backend.into(),
        "--model".into(),
        model.to_string_lossy().into(),
        "--model-spec-override".into(),
        spec.to_string_lossy().into(),
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
    let executable = profile.runtime.executable(resources);
    let model_folder = Path::new(&settings.models_dir);
    let model = model_folder.join("heartmula");
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
    let request = arguments(&model, &spec, &platform.backend, params)?;
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
            Path::new("model_specs"),
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
            duration: f64::from(profile.capabilities.min_duration),
            ..Default::default()
        };
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
        assert_eq!(original["inference_steps"], 0);
        assert!(original.get("use_cot_caption").is_none());
        assert!(original["seed"].as_u64().is_some());
        validate_saved_profile(&selection, &original).unwrap();
        db.fail(&id, "interrupted").unwrap();
        db.retry(&id).unwrap();
        assert_eq!(db.claim_next().unwrap().unwrap().1, original);
        let mut changed = original;
        changed["generation_profile"]["runtime_revision"] = "different-runtime".into();
        assert!(validate_saved_profile(&selection, &changed).is_err());
    }
}
