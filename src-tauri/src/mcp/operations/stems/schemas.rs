use super::mix_schema::mix;
use crate::{audio_export::AudioFormat, mcp::tool};
use serde_json::{json, Value};

pub(super) fn id() -> Value {
    json!({"type":"string","minLength":1,"maxLength":200})
}

fn export_request() -> Value {
    let formats: Vec<_> = AudioFormat::ALL
        .into_iter()
        .filter(|f| *f != AudioFormat::Original)
        .collect();
    json!({"type":"object","additionalProperties":false,"properties":{
        "project_id":id(),"kind":{"enum":["raw","processed","mix","package"]},
        "mix":mix(),"version_id":id(),
        "selected":{"type":"array","items":id(),"uniqueItems":true,"description":"Role IDs for individual tracks or a version 2 package. With a version_id, defaults to tracks marked for export."},
        "format":{"enum":formats},"wav_format":{"enum":["float32","pcm16","pcm24"]},
        "sample_rate":{"enum":[44100,48000,null]},"channels":{"enum":[1,2,null]},
        "keep_position":{"type":"boolean"},"include_original":{"type":"boolean"},"include_mix":{"type":"boolean"}
    },"required":["project_id","kind","format","wav_format"],"oneOf":[{"required":["mix"]},{"required":["version_id"]}]})
}

fn separation() -> Value {
    let mut definition = tool("separate_song", "Queue separation from a library song, a managed source from get_stem_job, or a local audio file accessible to the desktop. Choose exactly one source. Uses the active ready revision from list_stem_models. Poll get_stem_job with the returned id.", json!({
        "song_id":id(),"source_id":id(),"path":{"type":"string","minLength":1,"description":"Absolute audio path on the desktop host."},
        "model_id":id(),"name":{"type":"string","minLength":1,"maxLength":160},"folder_id":id(),
        "start":{"type":"number","minimum":0,"description":"Start in source seconds."},
        "end":{"type":"number","exclusiveMinimum":0,"description":"Exclusive end in source seconds. Omit for the end of the source or the first 20 seconds of a preview range."},
        "quality":{"enum":["fast","standard"],"default":"standard"},
        "overlap":{"type":"number","minimum":0,"maximum":0.5,"default":0.25},
        "preview":{"type":"boolean","default":false},"outputs":{"type":"array","items":id(),"minItems":1,"uniqueItems":true,"description":"Model roles and/or instrumental. Omit for all native roles."},
        "vocals_and_instrumental":{"type":"boolean","description":"Select vocals plus summed accompaniment. Use alone or set false with outputs."}
    }), &["model_id"], false, false);
    definition["inputSchema"]["oneOf"] =
        json!([{"required":["song_id"]},{"required":["source_id"]},{"required":["path"]}]);
    definition["inputSchema"]["not"] = json!({"required":["outputs","vocals_and_instrumental"],"properties":{"vocals_and_instrumental":{"const":true}}});
    definition
}

pub(super) fn tools() -> Vec<Value> {
    let by_id = json!({"id":id()});
    let mut setup = tool("set_stem_model", "Activate an installed separation revision. To install a compatible pinned revision and its required separation engine, set download_missing=true. This can download gigabytes and returns an operation_id for get_operations or cancel_job(target=operation). Use the catalog id as pin.model, with its repository and revision.", json!({
        "pin":{"type":"object","additionalProperties":false,"properties":{"model":id(),"repository":{"type":"string","minLength":3,"maxLength":193,"pattern":"^[A-Za-z0-9_][A-Za-z0-9_.-]*/[A-Za-z0-9_][A-Za-z0-9_.-]*$"},"revision":{"type":"string","pattern":"^[A-Fa-f0-9]{40}$"}},"required":["model","repository","revision"]},
        "download_missing":{"type":"boolean","default":false}
    }), &["pin"], false, true);
    setup["annotations"]["openWorldHint"] = json!(true);
    vec![
        setup,
        tool("list_stem_models", "List compatible separation profiles, engine readiness, pinned revisions and installation status.", json!({}), &[], true, false),
        tool("list_stem_jobs", "List up to 40 separation jobs or projects, newest first. Page with offset. folder_id=none selects unfiled projects.", json!({"song_id":id(),"source_id":id(),"folder_id":id(),"offset":{"type":"integer","minimum":0,"maximum":u32::MAX}}), &[], true, false),
        tool("get_stem_job", "Read separation status, project roles, timing and pinned revision. Set include_mix=true on a completed project to get an editable default_mix.", json!({"id":id(),"include_mix":{"type":"boolean","default":false}}), &["id"], true, false),
        separation(),
        tool("cancel_stem_job", "Cancel a queued or active separation by project ID.", by_id.clone(), &["id"], false, true),
        tool("retry_stem_job", "Requeue a failed or cancelled separation with the same source, settings, revision and ID.", by_id.clone(), &["id"], false, false),
        tool("list_stem_mixes", "List the latest 100 named mixes of a completed project.", by_id.clone(), &["id"], true, false),
        tool("add_stem_track", "Import and align a local audio file to a completed project. Append its returned role to mix.tracks or use it as a track replacement when saving.", json!({"id":id(),"path":{"type":"string","minLength":1,"description":"Absolute audio path on the desktop host."}}), &["id","path"], false, false),
        tool("save_stem_mix", "Create a named mix or update the mix ID supplied in version. Start with get_stem_job(include_mix=true) or a snapshot from list_stem_mixes. first and exclusive end are project frames.", json!({"id":id(),"version":id(),"name":{"type":"string","minLength":1,"maxLength":120},"mix":mix()}), &["id","name","mix"], false, true),
        tool("export_stems", "Queue an immutable export from an inline mix or saved version_id. Mix uses audible channels, raw and processed use selected roles, and package creates a WAV ZIP. Poll get_stem_export with the returned id.", json!({"request":export_request()}), &["request"], false, false),
        tool("list_stem_exports", "List the latest 50 managed exports for a project.", by_id.clone(), &["id"], true, false),
        tool("get_stem_export", "Read export status, peaks and local output paths for a managed export ID.", by_id.clone(), &["id"], true, false),
        tool("cancel_stem_export", "Cancel a queued or active stem export by export ID.", by_id, &["id"], false, true),
    ]
}
