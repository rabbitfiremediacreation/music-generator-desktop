use super::{native::WavJob, progress::Progress};
use crate::{
    error::{message, Result},
    types::Settings,
};
use serde_json::{json, Value};
use std::{path::Path, time::Duration};
use tokio_util::sync::CancellationToken;

pub(crate) async fn generate(
    executable: &Path,
    data_root: &Path,
    settings: &Settings,
    params: &Value,
    cancel: &CancellationToken,
    progress: impl Fn(Progress),
) -> Result<(Vec<u8>, String, Value)> {
    let snapshot = serde_json::from_value::<crate::types::GenerateRequest>(params.clone())?;
    let seed = u32::try_from(snapshot.seed).map_err(|_| message("Invalid DiffRhythm 2 seed"))?;
    let timeout = Duration::try_from_secs_f64(settings.timeout_minutes * 60.0)
        .map_err(|_| message("Invalid generation timeout"))?;
    let model_folder = Path::new(&settings.models_dir).join("diffrhythm2");
    let (audio, extension, mut meta) = WavJob {
        executable,
        model_folder: &model_folder,
        data_root,
        log_name: "diffrhythm2.log",
        backend: "cuda",
        timeout,
    }
    .run(params, cancel, progress, |output| {
        vec![
            "--models".into(),
            model_folder.to_string_lossy().into_owned(),
            "--output".into(),
            output.to_string_lossy().into_owned(),
            format!("--lyrics={}", snapshot.lyrics),
            format!("--style={}", snapshot.style),
            format!("--duration={}", snapshot.duration),
            format!("--seed={seed}"),
        ]
    })
    .await?;
    meta["audio_origin"] = json!("mono");
    Ok((audio, extension, meta))
}
