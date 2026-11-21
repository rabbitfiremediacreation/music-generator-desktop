use crate::{
    configuration::Change,
    download::{self, ensure_space},
    engine::client::selftest_ok,
    error::{message, Result},
    hardware, manifest,
    runtime::{Operation, OperationKind},
    state::AppState,
    types::Settings,
    verification::ModelVerifier,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{path::Path, sync::Arc};
use tokio_util::sync::CancellationToken;

#[cfg(test)]
mod tests;

#[derive(Debug, Clone, Deserialize)]
pub struct SetupRequest {
    pub lm: String,
    pub xl: bool,
    pub models_dir: String,
    pub songs_dir: String,
}

pub fn plan(request: &SetupRequest) -> Result<Vec<(manifest::Model, String)>> {
    let mut selected = manifest::selected(&request.lm, request.xl)?
        .into_iter()
        .map(|m| {
            let url = format!("{}/{}", manifest::manifest().base_url, m.file);
            (m, url)
        })
        .collect::<Vec<_>>();
    let title = crate::titles::manifest();
    selected.push((title.model, title.url));
    Ok(selected)
}

/// The wizard cannot activate or download non-recommended profiles outside Expert Mode.
pub fn validate_selection(
    request: &SetupRequest,
    settings: &Settings,
    hardware: &hardware::Hardware,
) -> Result<()> {
    let catalog = crate::catalog::catalog();
    let mut selection = crate::catalog::Selection {
        provider: "ace-step".into(),
        synthesis: catalog.basic_models.synthesis[0].clone(),
        language: manifest::lm_file(&request.lm),
    };
    catalog.ensure_allowed(&selection, settings.expert_mode, Some(hardware))?;
    if request.xl {
        selection.synthesis = catalog.basic_models.synthesis[1].clone();
        catalog.ensure_allowed(&selection, settings.expert_mode, Some(hardware))?;
    }
    Ok(())
}

pub fn fingerprint(lm: &str, gpu: &str) -> String {
    format!(
        "{}:{}:{}:{}:{:?}",
        std::env::consts::OS,
        std::env::consts::ARCH,
        manifest::manifest().engines,
        lm,
        gpu
    )
}

pub async fn configure(
    state: Arc<AppState>,
    request: SetupRequest,
    progress: impl Fn(crate::download::DownloadProgress) + Sync,
    stage: impl Fn(&str) + Sync,
    authorize: impl FnOnce(&Path) -> Result<()>,
) -> Result<Value> {
    let change = Change::begin(state.clone(), OperationKind::Setup)?;
    validate_selection(&request, &state.db.settings()?, hardware::inspect())?;
    let cancel = change.cancellation();
    let settings = prepare_configuration(
        &state,
        change.operation(),
        &request,
        &cancel,
        &progress,
        &stage,
    )
    .await?;
    let settings = change.commit(async { Ok(settings) }, authorize).await?;
    Ok(json!({"ok":true,"mode":settings.mode,"backend_status":state.backend_status()}))
}

async fn prepare_configuration(
    state: &AppState,
    operation: &Operation,
    request: &SetupRequest,
    cancel: &CancellationToken,
    progress: &impl Fn(crate::download::DownloadProgress),
    stage: &impl Fn(&str),
) -> Result<Settings> {
    let selected = plan(request)?;
    let (models, songs) = crate::paths::setup_folders(&request.models_dir, &request.songs_dir)?;
    std::fs::create_dir_all(&models).map_err(|_| message("path_access"))?;
    std::fs::create_dir_all(&songs).map_err(|_| message("path_access"))?;
    crate::sandbox::remember(&models).map_err(|_| message("path_access"))?;
    crate::sandbox::remember(&songs).map_err(|_| message("path_access"))?;
    state.stop_engine();
    let required: u64 = selected
        .iter()
        .filter(|(m, _)| !models.join(&m.file).exists())
        .map(|(m, _)| {
            m.estimated_bytes.saturating_sub(
                models
                    .join(format!("{}.part", m.file))
                    .metadata()
                    .map(|m| m.len())
                    .unwrap_or(0),
            )
        })
        .sum();
    ensure_space(&models, required + 1024 * 1024 * 1024)?;
    let client = download::client()?;
    let mut verifier = ModelVerifier::open(&state.db.root);
    for (model, url) in selected {
        download::fetch(
            || crate::hugging_face_token::get(&client, &url, &state.db.root),
            None,
            &models,
            &model,
            &mut verifier,
            cancel,
            progress,
        )
        .await?;
    }
    crate::titles::probe(&state.resources, cancel).await?;
    let mut settings = state.db.settings()?;
    if Path::new(&settings.songs_dir) != songs && state.db.busy()? {
        return Err(message(
            "Finish or cancel queued songs before moving the song folder",
        ));
    }
    let hw = hardware::inspect();
    settings.songs_dir = songs.to_string_lossy().into();
    settings.models_dir = models.to_string_lossy().into();
    settings.vae_chunk = hw.vae_chunk;
    settings.mode = "single".into();
    // The wizard deliberately returns to the supported starter profile.
    crate::catalog::Selection {
        provider: "ace-step".into(),
        synthesis: if request.xl && settings.dit == "xl" {
            "acestep-v15-xl-sft-Q8_0.gguf"
        } else {
            "acestep-v15-sft-Q8_0.gguf"
        }
        .into(),
        language: manifest::lm_file(&request.lm),
    }
    .apply(&mut settings)?;
    settings.tested_fingerprint = fingerprint(&settings.lm_model, &hw.gpu);
    let mut settings =
        test_hardware(state, operation, settings, hw.cpu_only, cancel, stage).await?;
    settings.setup_complete = true;
    Ok(settings)
}

async fn test_hardware(
    state: &AppState,
    operation: &Operation,
    mut settings: Settings,
    cpu_only: bool,
    cancel: &CancellationToken,
    stage: &impl Fn(&str),
) -> Result<Settings> {
    if cpu_only {
        // The Intel engine contains no GPU backend. A GPU correctness benchmark is
        // inapplicable and can take minutes on older CPUs; verify server readiness.
        stage("starting");
        state.start_engine(operation, &settings).await?;
    } else {
        stage("testing");
        let test = json!({"caption":"calm ambient pad, soft piano","lyrics":"[Instrumental]","duration":10,"vocal_language":"unknown","seed":42,"lm_model":settings.lm_model});
        let accelerated = state.start_engine(operation, &settings).await;
        let mut okay = false;
        if let Ok(mut engine) = accelerated {
            engine.timeout = std::time::Duration::from_secs(300);
            okay = engine
                .language_model(&test, cancel, |_| {})
                .await
                .is_ok_and(|v| selftest_ok(&v));
        }
        if cancel.is_cancelled() {
            return Err(crate::error::Error::Cancelled);
        }
        if !okay {
            state.stop_engine();
            settings.mode = "split".into();
            stage("cpu-fallback");
            let mut engine = state.start_engine(operation, &settings).await?;
            engine.timeout = std::time::Duration::from_secs(300);
            if !selftest_ok(&engine.language_model(&test, cancel, |_| {}).await?) {
                return Err(message(
                    "Language model self-test failed on CPU. See the engine logs.",
                ));
            }
        }
    }
    Ok(settings)
}
