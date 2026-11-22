mod mix_schema;
pub(super) mod production;
mod schemas;
mod setup;
pub(super) use setup::select;

use super::{files::absolute, string, value};
use crate::{
    error::{message, Result},
    state::AppState,
    stems::{export, jobs, layer, mix, model},
};
use serde_json::{json, Value};

pub const NAMES: &[&str] = &[
    "list_stem_models",
    "set_stem_model",
    "list_stem_jobs",
    "get_stem_job",
    "separate_song",
    "cancel_stem_job",
    "retry_stem_job",
    "add_stem_track",
    production::GENERATE,
    production::SCAN,
    production::PREVIEW,
    production::REPAIR,
    "list_stem_mixes",
    "save_stem_mix",
    "export_stems",
    "list_stem_exports",
    "get_stem_export",
    "cancel_stem_export",
];

pub fn tools() -> Vec<Value> {
    let mut tools = schemas::tools();
    tools.extend(production::tools());
    tools
}

async fn separate(state: &AppState, args: Value) -> Result<Value> {
    let options: jobs::Options = serde_json::from_value(args.clone())?;
    let path;
    let input = if let Some(id) = args["song_id"].as_str() {
        jobs::Input::Song(id)
    } else if let Some(id) = args["source_id"].as_str() {
        jobs::Input::Managed(id)
    } else {
        path = absolute(string(&args, "path")?)?;
        jobs::Input::File(&path)
    };
    let request = options.request(state, input).await?;
    Ok(json!({"id":jobs::enqueue(state, request)?}))
}

fn start_export(state: &AppState, mut request: Value) -> Result<Value> {
    if let Some(id) = request["version_id"].as_str() {
        let mix = mix::load(state, string(&request, "project_id")?, id)?;
        if request.get("selected").is_none() {
            request["selected"] = json!(mix
                .tracks
                .iter()
                .filter(|t| t.export)
                .map(|t| &t.role)
                .collect::<Vec<_>>());
        }
        request["mix"] = value(mix)?;
    }
    Ok(json!({"id": export::start(state, serde_json::from_value(request)?)?}))
}

pub async fn call(name: &str, args: Value, state: &AppState) -> Result<Value> {
    match name {
        "list_stem_models" => value(model::catalog(state)?),
        "list_stem_jobs" => value(jobs::list(
            state,
            args["song_id"].as_str(),
            args["source_id"].as_str(),
            args["folder_id"].as_str(),
            args["offset"]
                .as_u64()
                .unwrap_or(0)
                .min(u64::from(u32::MAX)) as u32,
        )?),
        "get_stem_job" => {
            let job = jobs::get(state, string(&args, "id")?)?;
            let mut result = value(&job)?;
            if args["include_mix"] == true {
                if let Ok(project) = job.complete() {
                    result["default_mix"] = value(mix::Mix::defaults(project))?;
                }
            }
            Ok(result)
        }
        "separate_song" => separate(state, args).await,
        "retry_stem_job" => {
            let id = string(&args, "id")?;
            jobs::retry(state, id)?;
            Ok(json!({"id":id}))
        }
        "add_stem_track" => {
            let path = absolute(string(&args, "path")?)?;
            let name = path
                .file_name()
                .ok_or_else(|| message("audio_read"))?
                .to_string_lossy();
            value(layer::import(state, string(&args, "id")?, &path, &name).await?)
        }
        "cancel_stem_job" => Ok(json!({"cancelled": jobs::cancel(state, string(&args, "id")?)?})),
        "list_stem_mixes" => value(mix::versions(state, string(&args, "id")?)?),
        "save_stem_mix" => value(mix::save(
            state,
            string(&args, "id")?,
            args["version"].as_str(),
            string(&args, "name")?,
            serde_json::from_value(args["mix"].clone())?,
        )?),
        "export_stems" => start_export(state, args["request"].clone()),
        "list_stem_exports" => value(export::list(state, string(&args, "id")?)?),
        "get_stem_export" => {
            let id = string(&args, "id")?;
            let status = export::get(state, id)?;
            let files: Vec<_> = (0..status.outputs.len())
                .map(|index| export::path(state, id, index))
                .collect::<Result<_>>()?;
            Ok(json!({"export": status, "local_files": files}))
        }
        "cancel_stem_export" => {
            Ok(json!({"cancelled": export::cancel(state, string(&args, "id")?)?}))
        }
        _ => Err(crate::error::message("Unknown stem operation")),
    }
}
