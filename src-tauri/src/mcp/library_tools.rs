use serde_json::{json, Value};

fn text(maximum: u32) -> Value {
    json!({"type": "string", "maxLength": maximum})
}

fn id() -> Value {
    json!({"type": "string", "minLength": 1, "maxLength": 200})
}

fn cpu_choice() -> Value {
    json!({"type": "string", "enum": ["limit_30", "continue"], "description": "One-call choice for more than 30 CPU/unknown-backend iterations when the saved behavior is Ask. Saved limit_30/continue preferences take precedence."})
}

fn generation() -> Value {
    json!({
        "prompt": text(20000), "style": text(4000), "caption": text(24000),
        "lyrics": text(100000), "title": text(500),
        "instrumental": {"type": "boolean", "default": true},
        "keep_caption": {"type": "boolean", "default": true},
        "duration": {"type": "number", "minimum": 10, "maximum": 600, "description": "Requested seconds; omitted values use the saved studio preference, initially 90."},
        "bpm": {"type": "integer", "minimum": 0, "maximum": 300, "description": "0 selects automatic tempo."},
        "keyscale": text(100), "timesignature": text(100), "vocal_language": text(100),
        "seed": {"type": "integer", "minimum": -1, "maximum": 9007199254740991_i64, "default": -1},
        "variants": {"type": "integer", "minimum": 1, "maximum": 10, "description": "Omitted values use the saved studio preference, initially 2."},
        "inference_steps": {"type": "integer", "minimum": 1, "maximum": 200, "description": "Omitted values use the saved studio preference or device/model recommendation."},
        "lm_temperature": {"type": "number", "minimum": 0, "maximum": 3, "description": "Omitted values use the saved studio preference, initially 1.2."},
        "group_id": id(), "folder_id": {"type": ["string", "null"], "maxLength": 200},
        "model_selection": {
            "type": "object", "additionalProperties": false,
            "properties": {"provider": id(), "language": id(), "synthesis": id()},
            "required": ["provider", "language", "synthesis"]
        }
    })
}

pub(super) fn tools() -> Vec<Value> {
    let mut generate = generation();
    generate["cpu_iteration_decision"] = cpu_choice();
    vec![
        super::super::tool("generate_music", "Queue music generation in the running desktop app and return song IDs immediately. Supply prompt, style or caption. Setup and verified models are required. Omitted sampling values follow saved studio preferences. Blank titles use the local title model and may download it. Poll get_song/get_queue or wait_song for results.", generate, &[], false, false),
        super::super::tool("create_variants", "Queue new variants from a song's stored generation settings with random seeds, preserving its group, current title and folder. Overrides replace individual parameters. Existing audio remains unchanged.", json!({"id": id(), "variants": {"type": "integer", "minimum": 1, "maximum": 10, "default": 1}, "overrides": {"type": "object", "properties": generation(), "additionalProperties": false}, "cpu_iteration_decision": cpu_choice()}), &["id"], false, false),
        super::super::tool("retry_song", "Retry a failed or cancelled song, honoring current model admission and saved CPU behavior. Reducing high CPU iterations creates a new song and preserves the original request.", json!({"id": id(), "cpu_iteration_decision": cpu_choice()}), &["id"], false, false),
        super::super::tool("cancel_song", "Cancel queued or running generation. Safe to repeat; a completed song and its audio are never deleted.", json!({"id": id()}), &["id"], false, false),
        super::super::tool("delete_song", "Permanently delete a terminal song and its audio. Cancel queued/running work first. Requires confirm=true.", json!({"id": id(), "confirm": {"type": "boolean", "const": true}}), &["id", "confirm"], false, true),
        super::super::tool("update_song", "Update a song's title, favorite flag or folder. Use folder_id=null to remove it from its folder.", json!({"id": id(), "title": text(500), "favorite": {"type": "boolean"}, "folder_id": {"type": ["string", "null"], "maxLength": 200}}), &["id"], false, false),
        super::super::tool("list_songs", "Search and page the full song library, newest first. Returns total and next_offset. folder=none selects unfiled songs.", json!({"q": text(1000), "favorites": {"type": "boolean", "default": false}, "group": id(), "folder": id(), "status": {"type": "string", "enum": ["queued", "running", "done", "error", "cancelled"]}, "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 25}, "offset": {"type": "integer", "minimum": 0, "maximum": 1000000000, "default": 0}}), &[], true, false),
        super::super::tool("get_song", "Read a song's status, stored generation parameters, lyrics, result metadata and local audio path. Audio is ready only when status=done and audio_missing=false.", json!({"id": id()}), &["id"], true, false),
        super::super::tool("list_folders", "List library folders and their song counts.", json!({}), &[], true, false),
        super::super::tool("save_folder", "Create a library folder, or rename an existing folder when id is supplied.", json!({"id": id(), "name": {"type": "string", "minLength": 1, "maxLength": 60}}), &["name"], false, false),
        super::super::tool("delete_folder", "Remove a folder and move its songs to the unfiled library without deleting audio. Requires confirm=true.", json!({"id": id(), "confirm": {"type": "boolean", "const": true}}), &["id", "confirm"], false, true),
        super::super::tool("get_queue", "Read ordered queued/running jobs, active generation progress, readiness and library totals.", json!({}), &[], true, false),
        super::super::tool("wait_song", "Wait up to 30 seconds for a song to reach done, error or cancelled. Timeout leaves generation running; call again when timed_out=true.", json!({"id": id(), "timeout_seconds": {"type": "integer", "minimum": 0, "maximum": 30, "default": 10}}), &["id"], true, false),
    ]
}
