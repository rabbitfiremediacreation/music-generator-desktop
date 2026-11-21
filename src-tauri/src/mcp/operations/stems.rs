use super::{string, value};
use crate::{
    error::Result,
    mcp::tool,
    state::AppState,
    stems::{export, jobs, mix, model},
};
use serde_json::{json, Value};

pub const NAMES: &[&str] = &[
    "list_stem_models",
    "list_stem_jobs",
    "get_stem_job",
    "separate_song",
    "cancel_stem_job",
    "list_stem_mixes",
    "save_stem_mix",
    "export_stems",
    "list_stem_exports",
    "get_stem_export",
    "cancel_stem_export",
];

pub fn tools() -> Vec<Value> {
    let id = json!({"id":{"type":"string","minLength":1}});
    vec![
        tool("list_stem_models", "List compatible local separation profiles, exact revisions and installation status.", json!({}), &[], true, false),
        tool("list_stem_jobs", "List separation jobs and completed projects, optionally for a library song.", json!({"song_id":{"type":"string"},"folder_id":{"type":"string"},"offset":{"type":"integer","minimum":0}}), &[], true, false),
        tool("get_stem_job", "Read status, actual stems, sample rate, frame count, original offset and pinned model revision.", id.clone(), &["id"], true, false),
        tool("separate_song", "Queue local source separation for a managed library song using the active installed revision. vocals_and_instrumental derives accompaniment by summing non-vocal estimates.", json!({"song_id":{"type":"string"},"model_id":{"type":"string"},"vocals_and_instrumental":{"type":"boolean"}}), &["song_id","model_id"], false, false),
        tool("cancel_stem_job", "Cancel a queued or active separation by its ID.", id.clone(), &["id"], false, false),
        tool("list_stem_mixes", "Read named mix snapshots and settings for a completed project.", id.clone(), &["id"], true, false),
        tool("save_stem_mix", "Save or update a mix for a completed project. Each track specifies role, name, gain_db, pan, mute, solo, fade_in and fade_out. Mix includes tracks, master_db, first, end and looping. first and end use project frames.", json!({"id":{"type":"string"},"version":{"type":"string"},"name":{"type":"string"},"mix":{"type":"object"}}), &["id","name","mix"], false, false),
        tool("export_stems", "Queue an immutable mix snapshot for export. request fields are project_id, kind (raw, processed, mix, package), mix, selected role strings, format, wav_format (float32, pcm16, pcm24), optional sample_rate (44100 or 48000), optional channels (1 or 2), keep_position, include_original and include_mix. Returns a managed export ID.", json!({"request":{"type":"object"}}), &["request"], false, false),
        tool("list_stem_exports", "List the managed exports belonging to a completed project. Files can be retrieved by export ID and file index using the authenticated phone-access API.", id.clone(), &["id"], true, false),
        tool("get_stem_export", "Read status and local file paths for a managed export ID.", id.clone(), &["id"], true, false),
        tool("cancel_stem_export", "Cancel a queued or active stem export by its ID.", id, &["id"], false, false),
    ]
}

pub async fn call(name: &str, args: Value, state: &AppState) -> Result<Value> {
    match name {
        "list_stem_models" => value(model::catalog(state)?),
        "list_stem_jobs" => value(jobs::list(
            state,
            args["song_id"].as_str(),
            None,
            args["folder_id"].as_str(),
            args["offset"]
                .as_u64()
                .unwrap_or(0)
                .min(u64::from(u32::MAX)) as u32,
        )?),
        "get_stem_job" => value(jobs::get(state, string(&args, "id")?)?),
        "separate_song" => {
            Ok(json!({"id": jobs::from_song(state, serde_json::from_value(args)?).await?}))
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
        "export_stems" => Ok(
            json!({"id": export::start(state, serde_json::from_value(args["request"].clone())?)?}),
        ),
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
