use super::{
    jobs,
    layer::{self, Layer, LayerStaging},
    mix::{Mix, Render, RenderTrack, WaveFormat},
    resample,
};
use crate::{
    catalog::{self, Selection},
    download::DownloadProgress,
    engine::progress::Progress,
    error::{message, Result},
    runtime::{JobProgress, OperationKind},
    state::AppState,
    types::Settings,
};
use serde::Deserialize;
use std::{path::Path, sync::Arc};
use tokio_util::sync::CancellationToken;

#[derive(Deserialize)]
pub struct Request {
    pub selection: Selection,
    pub track: String,
    pub name: String,
    pub prompt: String,
    pub mix: Mix,
}

const INSTRUMENTS: &[&str] = &[
    "drums",
    "bass",
    "guitar",
    "keyboard",
    "percussion",
    "strings",
    "synth",
    "fx",
    "brass",
    "woodwinds",
];

pub async fn prepare(
    state: &AppState,
    selection: &Selection,
    progress: impl Fn(DownloadProgress) + Sync,
) -> Result<()> {
    let transfer = state
        .runtime
        .transfer("stem-model", &serde_json::to_string(selection)?)?;
    let settings = state.db.settings()?;
    let catalog = catalog::catalog();
    validate_model(&catalog, &settings, selection)?;
    catalog::ensure_runtime(selection, &state.resources, &state.db.root)?;
    catalog::prepare_profile(
        &catalog,
        &state.db,
        &settings,
        selection,
        &transfer.cancellation(),
        progress,
    )
    .await?;
    state.refresh_engine_models();
    Ok(())
}

fn validate_model(
    catalog: &catalog::Catalog,
    settings: &Settings,
    selection: &Selection,
) -> Result<()> {
    if selection.provider != "ace-step"
        || !catalog.models.iter().any(|model| {
            model.provider == selection.provider
                && model.file == selection.synthesis
                && matches!(
                    model.family.as_str(),
                    "acestep-v15-base" | "acestep-v15-xl-base"
                )
        })
    {
        return Err(message("stem_layer_generated_model"));
    }
    catalog::validate_activation(settings, selection, crate::hardware::inspect())
}

pub async fn generate(
    state: &Arc<AppState>,
    project_id: &str,
    request: Request,
    progress: impl Fn(JobProgress),
) -> Result<Layer> {
    let operation = state.runtime.try_begin(OperationKind::StemGeneration)?;
    let cancel = operation.cancellation();
    let job = jobs::get(state, project_id)?;
    let project = job.complete()?;
    request.mix.validate(project)?;
    request.mix.validate_track_ids(state, project_id)?;
    if job.request.preview || request.mix.tracks.len() >= 32 {
        return Err(message("stem_layer_generated_unavailable"));
    }
    if project.frames > u64::from(project.rate) * 600 {
        return Err(message("stem_layer_generated_too_long"));
    }
    let name = request.name.trim();
    let prompt = request.prompt.trim();
    if !INSTRUMENTS.contains(&request.track.as_str())
        || !(1..=80).contains(&name.chars().count())
        || prompt.chars().count() > 1000
    {
        return Err(message("stem_layer_generated_invalid"));
    }
    let selection = &request.selection;
    let mut settings = state.db.settings()?;
    validate_model(&catalog::catalog(), &settings, selection)?;
    selection.apply(&mut settings)?;
    operation.start_stem_generation(name);
    let report = |update: Progress| {
        let percent = generation_percent(&update);
        if let Some(update) = operation.report(update, percent) {
            progress(update);
        }
    };
    report(Progress::new("starting"));
    if !catalog::cached(
        selection,
        Path::new(&settings.models_dir),
        &crate::verification::ModelVerifier::open(&state.db.root),
    )? {
        state.stop_engine();
    }
    let client = state.start_engine(&operation, &settings).await?;
    let frames = project.frames;
    let source_id = job.source.id.clone();
    let staging = LayerStaging::new(state, frames)?.mark_generated();
    let context = staging.audio().with_file_name("context.wav");
    let store = Arc::clone(state);
    let mix = request.mix;
    let render_path = context.clone();
    let render_cancel = cancel.clone();
    report(Progress::new("context"));
    blocking(move || write_context(&store, &job, &mix, &render_path, &render_cancel)).await?;
    let caption = if prompt.is_empty() {
        &request.track
    } else {
        prompt
    };
    let audio = client
        .lego(
            &selection.synthesis,
            &request.track,
            caption,
            &context,
            &cancel,
            &report,
        )
        .await?;
    report(Progress::new("saving"));
    let store = Arc::clone(state);
    let project_id = project_id.to_owned();
    let name = name.to_owned();
    let render_cancel = cancel.clone();
    let layer = blocking(move || {
        std::fs::remove_file(context)?;
        resample::align_generated(&audio, &staging.audio(), frames, &render_cancel)?;
        staging.publish(
            &store,
            &project_id,
            &source_id,
            name,
            frames,
            &render_cancel,
        )
    })
    .await?;
    report(Progress::new("complete"));
    Ok(layer)
}

/// Reserve progress for preparing and saving the track, and scale measured engine steps in between.
fn generation_percent(progress: &Progress) -> u8 {
    match progress.phase {
        "context" => 5,
        "synth" | "loading" => 12,
        "dit" => {
            let step = u64::from(progress.step.unwrap_or_default());
            let total = u64::from(progress.total_steps.unwrap_or_default().max(1));
            12 + (72 * step.min(total) / total) as u8
        }
        "vae" => 90,
        "saving" => 95,
        "complete" => 100,
        _ => 0,
    }
}

fn write_context(
    state: &AppState,
    job: &jobs::Job,
    mix: &Mix,
    path: &Path,
    cancel: &CancellationToken,
) -> Result<()> {
    let frames = job.complete()?.frames;
    let sources = mix
        .audible()
        .map(|track| {
            Ok((
                track,
                layer::audio_path(
                    state,
                    job,
                    track.replacement.as_ref().unwrap_or(&track.role),
                )?,
            ))
        })
        .collect::<Result<Vec<_>>>()?;
    if sources.is_empty() {
        return Err(message("stem_layer_generated_context"));
    }
    let tracks = sources
        .iter()
        .map(|(track, path)| RenderTrack {
            path,
            controls: Some(track),
        })
        .collect::<Vec<_>>();
    let peak = Render {
        tracks: &tracks,
        frames,
        first: 0,
        end: frames,
        prefix: 0,
        mix,
        master: true,
        format: WaveFormat::Pcm16,
    }
    .write(path, cancel, |_| {})?;
    if peak < 1.0 / 32768.0 {
        return Err(message("stem_layer_generated_context"));
    }
    Ok(())
}

async fn blocking<T: Send + 'static>(
    task: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    tokio::task::spawn_blocking(task)
        .await
        .map_err(|_| message("stem_output_invalid"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn track_progress_reserves_room_before_and_after_the_engine_steps() {
        let halfway = Progress {
            step: Some(25),
            total_steps: Some(50),
            ..Progress::new("dit")
        };
        let milestones = [
            generation_percent(&Progress::new("starting")),
            generation_percent(&Progress::new("context")),
            generation_percent(&Progress::new("synth")),
            generation_percent(&halfway),
            generation_percent(&Progress::new("vae")),
            generation_percent(&Progress::new("saving")),
            generation_percent(&Progress::new("complete")),
        ];
        assert_eq!(milestones, [0, 5, 12, 48, 90, 95, 100]);
    }
}
