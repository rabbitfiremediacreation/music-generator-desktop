//! Agent control shares the desktop's state, admission rules and queue worker.
pub mod bridge;
mod library;
mod operations;
mod resources;
pub mod server;
pub mod transport;

use serde_json::{json, Value};

fn tool(
    name: &str,
    description: &str,
    properties: Value,
    required: &[&str],
    read_only: bool,
    destructive: bool,
) -> Value {
    json!({
        "name": name,
        "description": description,
        "inputSchema": {
            "type": "object", "properties": properties, "required": required,
            "additionalProperties": false
        },
        "annotations": {
            "readOnlyHint": read_only, "destructiveHint": destructive,
            "idempotentHint": read_only,
            "openWorldHint": matches!(name, "generate_music" | "create_variants" | "retry_song")
        }
    })
}
