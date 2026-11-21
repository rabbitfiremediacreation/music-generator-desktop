use crate::{
    engine::progress::Progress,
    error::{message, Error, Result},
    runtime::{Operation, OperationKind},
    state::AppState,
    types::OutputKind,
};
use std::{future::Future, path::PathBuf, sync::Arc};
use tauri::{AppHandle, Emitter, Runtime};
use tokio_util::sync::CancellationToken;

mod extended;
mod progress;
use progress::{render_percent, RENDERED_PERCENT};

#[cfg(all(test, target_os = "macos", target_arch = "aarch64"))]
mod magenta_qa;
#[cfg(all(test, target_os = "macos", target_arch = "aarch64"))]
mod yue2_tests;

fn report_progress<R: Runtime>(
    state: &AppState,
    app: &AppHandle<R>,
    operation: &Operation,
    progress: Progress,
    percent: u8,
) {
    if let Some(update) = operation.report(progress, percent) {
        let _ = state
            .db
            .progress(&update.job_id, &update.progress.message());
        let _ = app.emit("generation-progress", update);
    }
}

/// A title model preparation failure only affects naming. Cancellation still ends the job.
async fn prepare_title<F: Future<Output = Result<()>>>(
    title: Option<&str>,
    cancel: &CancellationToken,
    install: impl FnOnce() -> F,
) -> Result<Option<Error>> {
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    if title.is_some_and(|title| !title.trim().is_empty()) {
        return Ok(None);
    }
    let result = install().await;
    if cancel.is_cancelled() || matches!(result, Err(Error::Cancelled)) {
        return Err(Error::Cancelled);
    }
    Ok(result.err())
}

pub async fn worker<R: Runtime>(state: Arc<AppState>, app: AppHandle<R>) {
    loop {
        if state.runtime.is_shutdown() {
            break;
        }
        if !state.runtime.is_ready() {
            state.runtime.wait().await;
            continue;
        }
        let Ok(operation) = state.runtime.begin(OperationKind::Generation).await else {
            break;
        };
        if state.runtime.is_shutdown() {
            break;
        }
        if !state.runtime.is_ready() {
            drop(operation);
            continue;
        }
        let next = match state.db.claim_work() {
            Ok(next) => next,
            Err(e) => {
                tracing::error!("Queue: {e}");
                None
            }
        };
        use crate::stems::jobs::Work;
        let (sid, params) = match next {
            Some(Work::Song(id, params)) => (id, params),
            Some(Work::Separate(id)) => {
                operation.start_song(&id);
                let _awake = crate::power::KeepAwake::new();
                crate::stems::jobs::run(&state, &id, &operation, || state.changed(&app)).await;
                continue;
            }
            Some(Work::Export(id)) => {
                operation.start_song(&id);
                crate::stems::jobs::run_export(&state, &id, &operation, || state.changed(&app))
                    .await;
                continue;
            }
            None => {
                drop(operation);
                state.runtime.wait().await;
                continue;
            }
        };
        let cancel = operation.cancellation();
        operation.start_song(&sid);
        if state.db.song(&sid).is_ok_and(|s| s.status != "running") {
            cancel.cancel();
        }
        let report =
            |progress, percent| report_progress(&state, &app, &operation, progress, percent);
        report(Progress::new("starting"), 0);
        state.changed(&app);
        let _awake = crate::power::KeepAwake::new();
        let outcome = async {
            let mut settings = state.db.settings()?;
            // Admission checks Expert Mode for new jobs and retries. Already accepted rows
            // keep running after it is disabled, including rows restored after restart.
            // New jobs carry an immutable model snapshot. Legacy rows remain untouched.
            let selection = crate::admission::profile_for_song(&settings, &params)?;
            selection.apply(&mut settings)?;
            crate::admission::validate_saved_profile(&selection, &params)?;
            let ace_step = selection.provider == "ace-step";
            let has_token_stages = ace_step || selection.provider == "yue2";
            let render_progress = |progress: Progress, section, sections| {
                let percent = render_percent(&progress, section, sections, has_token_stages);
                report(progress, percent);
            };
            // Existing installations lazily fetch only this shared model for blank titles.
            // Explicit titles require neither a title download nor title inference.
            let title = state.db.song(&sid)?.title;
            let title_preparation_error = if ace_step {
                prepare_title(title.as_deref(), &cancel, || async {
                    report(Progress::new("title_download"), 1);
                    let progress =
                        crate::download::ProgressEvents::new(&app, "model-download-progress");
                    crate::titles::install(
                        &state.db.root,
                        std::path::Path::new(&settings.models_dir),
                        &cancel,
                        |update| progress.report(update),
                    )
                    .await?;
                    drop(progress);
                    let _ = app.emit("models-changed", ());
                    Ok(())
                })
                .await?
            } else {
                None
            };
            let capabilities = crate::catalog::capabilities(&selection)?;
            let output_kind = capabilities.output_kind;
            let (bytes, ext, mut meta) =
                if let Some(duration) = extended::duration(&params, &capabilities) {
                    let (state, operation, settings, selection) =
                        (&state, &operation, &settings, &selection);
                    extended::generate(
                        duration,
                        &params,
                        &capabilities,
                        &cancel,
                        |part, step, total_steps| async move {
                            render_progress(
                                Progress {
                                    step: Some(step),
                                    total_steps: Some(total_steps),
                                    ..Progress::new("starting")
                                },
                                step,
                                total_steps,
                            );
                            state
                                .generate(operation, settings, selection, &part, |progress| {
                                    render_progress(progress, step, total_steps)
                                })
                                .await
                        },
                    )
                    .await?
                } else {
                    state
                        .generate(&operation, &settings, &selection, &params, |progress| {
                            render_progress(progress, 1, 1)
                        })
                        .await?
                };
            let expected_format = match output_kind {
                OutputKind::Audio => ext != "mid",
                OutputKind::Midi => ext == "mid",
            };
            if !expected_format {
                return Err(message("The model returned an unexpected file type"));
            }
            if output_kind.is_audio()
                && state
                    .db
                    .song(&sid)?
                    .title
                    .as_deref()
                    .unwrap_or("")
                    .trim()
                    .is_empty()
            {
                let title_result = match title_preparation_error {
                    Some(error) => Err(error),
                    None => {
                        // Free resident music weights before loading the CPU-only text model.
                        state.stop_engine();
                        report(Progress::new("title"), RENDERED_PERCENT);
                        let input = crate::titles::request(&params, &meta);
                        crate::titles::generate(
                            &state.resources,
                            &state.db.root,
                            std::path::Path::new(&settings.models_dir),
                            &input,
                            &cancel,
                            |progress| report(progress, RENDERED_PERCENT),
                        )
                        .await
                    }
                };
                match title_result {
                    Ok(title) => {
                        meta["generated_title"] = serde_json::json!(title);
                        meta["title_model"] = serde_json::json!(crate::titles::manifest().revision);
                    }
                    Err(Error::Cancelled) => return Err(Error::Cancelled),
                    Err(error) => {
                        tracing::warn!("Automatic title: {error}");
                        meta["title_generation_error"] = serde_json::json!(error.to_string());
                    }
                }
            }
            let saving = if output_kind.is_audio() {
                "saving"
            } else {
                "saving_midi"
            };
            report(Progress::new(saving), 98);
            let dir = PathBuf::from(settings.songs_dir);
            tokio::fs::create_dir_all(&dir).await?;
            let filename = format!("{sid}.{ext}");
            let path = dir.join(&filename);
            let temp = dir.join(format!("{sid}.part"));
            tokio::fs::write(&temp, bytes).await?;
            if cancel.is_cancelled() {
                let _ = tokio::fs::remove_file(temp).await;
                return Err(Error::Cancelled);
            }
            tokio::fs::rename(&temp, &path).await?;
            let engine = if ace_step {
                "acestep_cpp"
            } else {
                &selection.provider
            };
            let finish = state
                .db
                .finish_output(&sid, &filename, &meta, engine, output_kind);
            if !matches!(finish, Ok(true)) {
                let _ = tokio::fs::remove_file(&path).await;
            }
            if finish? {
                report(Progress::new("complete"), 100);
            }
            Ok::<_, Error>(())
        }
        .await;
        if let Err(error) = outcome {
            if !state.runtime.is_shutdown() {
                let _ = state.db.fail(&sid, &error.to_string());
            }
        }
        drop(operation);
        state.changed(&app);
    }
    state.stop_engine();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::message;

    #[tokio::test]
    async fn failed_title_installation_allows_music_generation_with_a_warning() {
        let cancel = CancellationToken::new();
        let warning = prepare_title(Some(" \t"), &cancel, || async { Err(message("offline")) })
            .await
            .unwrap()
            .unwrap();
        assert_eq!(warning.to_string(), "offline");
    }

    #[tokio::test]
    async fn explicit_title_does_not_prepare_the_model() {
        let cancel = CancellationToken::new();
        let warning = prepare_title(Some("My title"), &cancel, || async {
            panic!("Explicit titles must bypass installation")
        })
        .await
        .unwrap();
        assert!(warning.is_none());
    }

    #[tokio::test]
    async fn cancelling_during_title_preparation_stops_the_job() {
        let cancel = CancellationToken::new();
        let preparation = prepare_title(None, &cancel, || async {
            cancel.cancelled().await;
            // An I/O error can arrive at the same time as cancellation.
            Err(message("download interrupted"))
        });
        tokio::pin!(preparation);
        assert!(futures_util::poll!(preparation.as_mut()).is_pending());
        cancel.cancel();
        assert!(matches!(preparation.await, Err(Error::Cancelled)));
    }

    #[tokio::test]
    async fn installer_cancellation_is_propagated() {
        let cancel = CancellationToken::new();
        let result = prepare_title(None, &cancel, || async { Err(Error::Cancelled) }).await;
        assert!(matches!(result, Err(Error::Cancelled)));
    }
}

#[cfg(all(test, target_os = "macos", target_arch = "aarch64"))]
mod text2midi_acceptance;

#[cfg(all(test, target_os = "macos", target_arch = "aarch64"))]
#[path = "jobs/heartmula_hardware.rs"]
mod heartmula_hardware;
