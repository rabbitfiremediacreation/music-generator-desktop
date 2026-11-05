use super::super::{library, operations, tool};
use serde_json::{json, Value};
use std::collections::BTreeMap;

pub(super) const FORWARDED: &[&str] = &[
    "retry_song",
    "delete_song",
    "update_song",
    "list_songs",
    "save_folder",
    "delete_folder",
    "list_models",
    "download_title_model",
    "update_settings",
    "analyze_audio",
    "export_file",
    "preview_import",
    "preview_library_move",
    "import_library",
];

pub(super) fn tools() -> Vec<Value> {
    let originals: BTreeMap<String, Value> = library::tools()
        .into_iter()
        .chain(operations::tools())
        .map(|definition| {
            (
                definition["name"].as_str().expect("tool name").into(),
                definition,
            )
        })
        .collect();
    let mut context = originals["get_generation_policy"].clone();
    context["name"] = json!("get_context");
    context["description"] = json!("Read desktop readiness, hardware, settings, generation policy, queue progress and folder counts together. sections selects only the required information; omit it for all sections or use [queue] for lightweight progress polling. selection and refresh apply only to policy. Initial model setup and directory grants remain in the desktop assistant.");
    context["inputSchema"]["properties"]["sections"] = json!({
        "type":"array", "minItems":1, "maxItems":5, "uniqueItems":true,
        "items":{"enum":super::CONTEXT_SECTIONS}, "default":super::CONTEXT_SECTIONS
    });

    let mut generate = originals["generate_music"].clone();
    generate["description"] = json!("Queue music and return durable song IDs immediately. For new music supply prompt, style or caption; omitted sampling values use saved studio preferences. With source_song_id, inherit that song's parameters, current title, folder and group, use random seeds and default to one variant; supplied flat parameters override inherited values. Setup and verified models are required. Blank titles may download the local title model. Poll get_song, optionally with wait_seconds, or get_context sections=[queue].");
    generate["inputSchema"]["properties"]["source_song_id"] = id();
    generate["inputSchema"]["properties"]["variants"]["description"] = json!("Number of versions: omitted means one for source_song_id, otherwise the saved studio preference (initially two).");
    for name in ["instrumental", "keep_caption", "seed"] {
        generate["inputSchema"]["properties"][name]
            .as_object_mut()
            .unwrap()
            .remove("default");
    }
    for (name, description) in [
        ("duration", "Requested seconds; omitted values inherit the source song or use the saved studio preference for new music (initially 90)."),
        ("inference_steps", "Omitted values inherit the source song or use saved studio/device/model defaults for new music. CPU iteration policy still applies."),
        ("lm_temperature", "Omitted values inherit the source song or use the saved studio preference for new music (initially 1.2)."),
        ("instrumental", "Omitted values inherit the source song; new music is instrumental by default."),
        ("keep_caption", "Omitted values inherit the source song; new music preserves the supplied caption by default."),
        ("seed", "Omitted values and -1 select random seeds, including when deriving source-song variants. A supplied nonnegative seed is reproducible."),
    ] {
        generate["inputSchema"]["properties"][name]["description"] = json!(description);
    }

    let mut song = originals["get_song"].clone();
    song["description"] = json!("Read flat song metadata, status, lyrics, generation parameters and local audio path. Optionally wait_seconds (0–30) waits for done, error or cancelled; zero returns immediately. completed, timed_out and progress are always included. A positive wait timeout leaves generation running. Audio is ready only when status=done and audio_missing=false.");
    song["inputSchema"]["properties"]["wait_seconds"] =
        json!({"type":"integer","minimum":0,"maximum":30,"default":0});

    let operations = tool("get_operations", "Inspect one background MCP operation by operation_id, or recover up to 100 active/recent operations when omitted. Always returns operations as an array, newest first. Results expire after app restart; song generation remains durable and is queried through get_song.",json!({"operation_id":id()}),&[],true,false);

    let mut models = originals["select_models"].clone();
    models["name"] = json!("set_models");
    models["description"] = json!("Set the active catalog model combination. By default, require verified local files and return the selected profile without downloading. Set download_missing=true to download/verify missing assets (potentially many gigabytes), then activate; this branch returns operation_id for get_operations. Existing selection survives download failure. Respects Expert Mode and hardware limits.");
    models["inputSchema"]["properties"]["download_missing"] =
        json!({"type":"boolean","default":false});
    models["annotations"]["destructiveHint"] = true.into();
    models["annotations"]["openWorldHint"] = true.into();

    let mut cancel = tool("cancel_job", "Cancel exactly a queued/running song (target=song) or a background MCP operation (target=operation) by id. Safe to repeat. Finished songs, audio and completed operation results remain intact. Cancellation is asynchronous; poll get_song or get_operations until terminal.",json!({"target":{"enum":["song","operation"]},"id":id()}),&["target","id"],false,true);
    cancel["annotations"]["idempotentHint"] = true.into();

    let mut tools = vec![context, generate, song, operations, models, cancel];
    for name in FORWARDED {
        let mut definition = originals[*name].clone();
        if matches!(*name, "update_song" | "save_folder" | "update_settings") {
            definition["annotations"]["destructiveHint"] = true.into();
        }
        if matches!(
            *name,
            "download_title_model" | "analyze_audio" | "export_file" | "import_library"
        ) {
            let description = definition["description"].as_str().unwrap();
            definition["description"] = json!(format!("{description} Poll get_operations for progress/results or use cancel_job with target=operation."));
        }
        tools.push(definition);
    }
    tools
}

fn id() -> Value {
    json!({"type":"string","minLength":1,"maxLength":200})
}
