use super::{native::WavJob, progress::Progress};
use crate::{
    catalog::ProviderProfile,
    error::{message, Result},
    types::Settings,
};
use serde_json::Value;
use std::{path::Path, time::Duration};
use tokio_util::sync::CancellationToken;

pub(crate) async fn generate(
    resources: &Path,
    data_root: &Path,
    settings: &Settings,
    profile: &ProviderProfile,
    params: &Value,
    cancel: &CancellationToken,
    progress: impl Fn(Progress),
) -> Result<(Vec<u8>, String, Value)> {
    let backend = &profile.platform(crate::hardware::inspect())?.backend;
    let executable = profile.runtime.executable(resources);
    let timeout = Duration::try_from_secs_f64(settings.timeout_minutes * 60.0)
        .map_err(|_| message("Invalid generation timeout"))?;
    let mut arguments = arguments(profile, &settings.models_dir, params)?;
    WavJob {
        executable: &executable,
        model_folder: Path::new(&settings.models_dir),
        data_root,
        log_name: "audiocraft.log",
        backend,
        timeout,
    }
    .run(params, cancel, progress, |output| {
        arguments.extend(["--output".into(), output.to_string_lossy().into_owned()]);
        arguments
    })
    .await
}

fn arguments(profile: &ProviderProfile, models_dir: &str, params: &Value) -> Result<Vec<String>> {
    let capabilities = &profile.capabilities;
    let duration = params["duration"]
        .as_f64()
        .filter(|duration| {
            (f64::from(capabilities.min_duration)..=f64::from(capabilities.max_duration))
                .contains(duration)
        })
        .ok_or_else(|| message("Invalid AudioCraft duration"))?;
    let seed = params["seed"]
        .as_u64()
        .and_then(|seed| u32::try_from(seed).ok())
        .ok_or_else(|| message("Invalid AudioCraft seed"))?;
    let prompt = params["caption"]
        .as_str()
        .filter(|prompt| !prompt.trim().is_empty() && !prompt.contains('\0'))
        .ok_or_else(|| message("Invalid AudioCraft prompt"))?;
    Ok(vec![
        "--profile".into(),
        profile.selection.synthesis.clone(),
        "--models-dir".into(),
        models_dir.into(),
        format!("--prompt={prompt}"),
        "--duration".into(),
        duration.to_string(),
        "--seed".into(),
        seed.to_string(),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog;
    use serde_json::json;

    #[test]
    fn passes_the_profile_and_caption_as_arguments_without_shell_interpretation() {
        let catalog = catalog::catalog();
        let profile = catalog
            .profiles
            .iter()
            .find(|profile| profile.selection.synthesis == "musicgen-small")
            .unwrap();
        let prompt = "-Kölner Jazz; piano & drums\nsoft bass";
        let models = "/tmp/Modelle Müller";
        let params = json!({"caption": prompt, "duration": 2.5, "seed": u32::MAX});
        assert_eq!(
            arguments(profile, models, &params).unwrap(),
            [
                "--profile",
                "musicgen-small",
                "--models-dir",
                models,
                &format!("--prompt={prompt}"),
                "--duration",
                "2.5",
                "--seed",
                "4294967295",
            ]
        );
    }

    #[test]
    fn magnet_uses_the_exact_checkpoint_duration() {
        let catalog = catalog::catalog();
        let profile = catalog
            .profiles
            .iter()
            .find(|profile| profile.selection.synthesis == "magnet-small-30secs")
            .unwrap();
        for duration in [1, 10, 29, 31] {
            let params = json!({"caption": "jazz", "duration": duration, "seed": 0});
            assert!(arguments(profile, "/models", &params).is_err());
        }
        let params = json!({"caption": "jazz", "duration": 30, "seed": 0});
        assert!(arguments(profile, "/models", &params).is_ok());
    }
}
