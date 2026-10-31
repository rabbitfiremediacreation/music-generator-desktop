use super::super::tool;
use serde_json::{json, Value};

pub(super) fn selection() -> Value {
    json!({"type":"object","additionalProperties":false,
        "properties":{"provider":{"type":"string"},"synthesis":{"type":"string"},"language":{"type":"string"}},
        "required":["provider","synthesis","language"]})
}

fn import_properties() -> Value {
    json!({"root":{"type":"string","description":"Absolute path to the legacy installation or its database directory."},
        "songs_source":{"type":["string","null"],"description":"Optional absolute source audio directory."},
        "songs_dir":{"type":"string","description":"Absolute destination audio directory, already accessible to the desktop app."},
        "allow_partial":{"type":"boolean","default":false,"description":"Allow importing rows with missing audio, after inspecting preview_import."}})
}

pub(super) fn tools() -> Vec<Value> {
    let mut tools = vec![
        tool("get_status", "Inspect desktop readiness, engine health, hardware and current queue progress. Initial model setup is completed in the desktop assistant.",json!({}),&[],true,false),
        tool("get_settings", "Read current settings, model selection and persisted generation form preferences.",json!({}),&[],true,false),
        tool("update_settings", "Update supported preferences through the desktop configuration workflow. Changing songs_dir moves the library and requires an idle queue and an already authorized directory on macOS.",json!({
            "expert_mode":{"type":"boolean"},"cpu_iteration_behavior":{"enum":["ask","limit_30","continue"]},
            "lm_device":{"enum":["auto","cpu"]},"export_format":{"enum":["wav","mp3"]},
            "timeout_minutes":{"type":"number","minimum":1,"maximum":600},
            "songs_dir":{"type":"string","description":"Absolute accessible directory; empty string restores the default."}}),&[],false,false),
        tool("get_generation_policy", "Get actual backend evidence, CPU iteration policy and safe recommended generation defaults for the current or specified model combination.",json!({"selection":selection(),"refresh":{"type":"boolean","default":false}}),&[],true,false),
        tool("list_models", "List supported providers, exact model identifiers, hardware recommendations, estimated downloads and local verification state.",json!({}),&[],true,false),
        tool("select_models", "Activate a verified locally installed model combination. Does not download. Respects Expert Mode and hardware limits.",json!({"selection":selection()}),&["selection"],false,false),
        tool("install_models", "Download and verify a catalog model combination, then activate it. May download many gigabytes. Returns operation_id; poll get_operation and cancel with cancel_operation. Preserves old selection on failure.",json!({"selection":selection()}),&["selection"],false,false),
        tool("download_title_model", "Download/verify the shared local automatic-title model (about 640 MB) without changing the music model. Returns operation_id.",json!({}),&[],false,false),
        tool("get_operation", "Poll a long-running MCP operation for progress, result or error. The latest 100 results are kept until app restart. Song generation uses get_song and get_queue instead.",json!({"operation_id":{"type":"string","minLength":1}}),&["operation_id"],true,false),
        tool("list_operations", "Recover operation IDs after reconnecting and inspect up to 100 active/recent MCP operations, newest first. Results are lost on app restart; song jobs remain durable.",json!({}),&[],true,false),
        tool("cancel_operation", "Request cancellation of this exact MCP operation; never cancels a different GUI operation or generation. Poll until terminal. Already completed results remain intact.",json!({"operation_id":{"type":"string","minLength":1}}),&["operation_id"],false,false),
        tool("analyze_audio", "Analyze a local audio file up to 60 MiB for musical description, BPM and other generation parameters. The absolute path must be accessible to the desktop sandbox. Returns operation_id.",json!({"path":{"type":"string"},"selection":selection()}),&["path"],false,false),
        tool("export_file", "Export audio, lyrics or a folder/all-library ZIP to an absolute accessible path outside app data, models and the source song library. Requires no active operation; queued songs run afterwards. Audio uses the configured WAV/MP3 format; the extension must match. Existing files are refused unless overwrite=true. Returns operation_id.",json!({
            "kind":{"enum":["audio","lyrics","zip"]},"id":{"type":"string"},
            "folder":{"type":"string","description":"For ZIP: omit for all songs, use none for unfiled songs, otherwise a folder ID."},
            "destination":{"type":"string"},"overwrite":{"type":"boolean","default":false}}),&["kind","destination"],false,true),
        tool("preview_import", "Inspect an existing library before importing: counts, missing audio, destination issues and disk space. Imports require an empty current library.",import_properties(),&["root","songs_dir"],true,false),
        tool("preview_library_move", "Check destination conflicts, file counts and required disk space before changing songs_dir with update_settings.",json!({"songs_dir":{"type":"string"}}),&["songs_dir"],true,false),
        tool("import_library", "Import a previously previewed library into an empty current library, preserving source files. Both locations must already be accessible to the desktop app. Returns operation_id with progress and counts.",import_properties(),&["root","songs_dir"],false,false),
    ];
    for tool in &mut tools {
        if matches!(
            tool["name"].as_str(),
            Some("install_models" | "download_title_model")
        ) {
            tool["annotations"]["openWorldHint"] = true.into();
        }
    }
    tools
}
