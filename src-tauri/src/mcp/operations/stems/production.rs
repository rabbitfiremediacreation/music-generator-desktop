mod schema;
pub(super) use schema::tools;

use super::super::{files, string, tasks, value};
use crate::{
    catalog::Selection,
    error::{message, Error, Result},
    runtime::{Operation, OperationKind},
    state::AppState,
    stems::{jobs, mix, model_layer, spectral},
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::AppHandle;

pub(crate) const GENERATE: &str = "generate_stem_track";
pub(crate) const SCAN: &str = "scan_stem_artifacts";
pub(crate) const PREVIEW: &str = "preview_stem_repair";
pub(crate) const REPAIR: &str = "repair_stem_track";

#[derive(Deserialize)]
struct Generation {
    project_id: String,
    selection: Selection,
    track: String,
    name: String,
    #[serde(default)]
    prompt: String,
    mix: Option<mix::Mix>,
    version_id: Option<String>,
}

pub(in crate::mcp::operations) fn generate<R: tauri::Runtime>(
    state: Arc<AppState>,
    app: &AppHandle<R>,
    args: Value,
) -> Result<Value> {
    let input: Generation = serde_json::from_value(args)?;
    let operation = state.runtime.try_begin(OperationKind::StemGeneration)?;
    let cancel = operation.cancellation();
    let task = tasks::for_app(app).begin(GENERATE, cancel.clone())?;
    let accepted = task.accepted();
    let progress = task.clone();
    let app = app.clone();
    task.spawn(async move {
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        let mix = match (input.mix, input.version_id) {
            (Some(mix), _) => mix,
            (None, Some(id)) => mix::load(&state, &input.project_id, &id)?,
            (None, None) => mix::Mix::defaults(jobs::get(&state, &input.project_id)?.complete()?),
        };
        let request = model_layer::Request {
            selection: input.selection,
            track: input.track,
            name: input.name,
            prompt: input.prompt,
            mix,
        };
        let layer =
            model_layer::generate(&state, &input.project_id, request, operation, |update| {
                progress.progress(update);
            })
            .await?;
        state.changed(&app);
        value(layer)
    });
    Ok(accepted)
}

pub(in crate::mcp::operations) fn restore<R: tauri::Runtime>(
    name: &str,
    state: Arc<AppState>,
    app: &AppHandle<R>,
    args: Value,
) -> Result<Value> {
    let id = string(&args, "project_id")?.to_owned();
    let role = string(&args, "role")?.to_owned();
    let work = match name {
        SCAN => Restoration::Scan,
        PREVIEW => Restoration::Preview {
            selection: serde_json::from_value(args["selection"].clone())?,
            destination: files::absolute(string(&args, "destination")?)?,
        },
        REPAIR => Restoration::Repair(serde_json::from_value(args["selection"].clone())?),
        _ => return Err(message("Unknown stem restoration operation")),
    };
    let operation = matches!(work, Restoration::Repair(_))
        .then(|| state.runtime.try_begin(OperationKind::Import))
        .transpose()?;
    let cancel = operation
        .as_ref()
        .map_or_else(|| state.runtime.cancellation(), Operation::cancellation);
    let task = tasks::for_app(app).begin(name, cancel.clone())?;
    let accepted = task.accepted();
    let app = app.clone();
    let notify = operation.is_some();
    let worker_state = state.clone();
    task.spawn(async move {
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            let _operation = operation;
            if cancel.is_cancelled() {
                return Err(Error::Cancelled);
            }
            match work {
                Restoration::Scan => {
                    let regions = spectral::scan(&worker_state, &id, &role, &cancel)?;
                    Ok(json!({"regions":regions}))
                }
                Restoration::Preview {
                    selection,
                    destination,
                } => {
                    let directory = files::preview_directory(&worker_state, &destination)?;
                    value(spectral::write_audition(
                        &worker_state,
                        &id,
                        &role,
                        &selection,
                        directory,
                        &cancel,
                    )?)
                }
                Restoration::Repair(selection) => value(spectral::apply(
                    &worker_state,
                    &id,
                    &role,
                    &selection,
                    &cancel,
                )?),
            }
        })
        .await
        .map_err(|error| message(error.to_string()))??;
        if notify {
            state.changed(&app);
        }
        Ok(outcome)
    });
    Ok(accepted)
}

enum Restoration {
    Scan,
    Preview {
        selection: spectral::RepairRequest,
        destination: std::path::PathBuf,
    },
    Repair(spectral::RepairRequest),
}
