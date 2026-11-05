//! Public agent vocabulary; focused services retain their independent implementation contracts.
mod definitions;

use super::server::MusicServer;
use crate::error::{message, Result};
use serde_json::{json, Value};

const CONTEXT_SECTIONS: &[&str] = &["status", "settings", "policy", "queue", "folders"];

pub fn tools() -> Vec<Value> {
    definitions::tools()
}

/// Adapt semantic public tools to existing services without exposing internal aliases.
pub async fn call<R: tauri::Runtime>(
    server: &MusicServer<R>,
    name: &str,
    args: Value,
) -> Result<Value> {
    let result = match name {
        "get_context" => context(server, args).await,
        "generate_music" => {
            let (name, args) = generation_request(args)?;
            server.dispatch_internal(name, args).await
        }
        "get_song" => {
            let seconds = args["wait_seconds"].as_u64().unwrap_or(0).min(30);
            let result = server
                .dispatch_internal(
                    "wait_song",
                    json!({"id":args["id"], "timeout_seconds":seconds}),
                )
                .await?;
            flatten_song(result, seconds)
        }
        "get_operations" => {
            if let Some(id) = args.get("operation_id") {
                let operation = server
                    .dispatch_internal("get_operation", json!({"operation_id":id}))
                    .await?;
                Ok(json!({"operations":[operation]}))
            } else {
                server.dispatch_internal("list_operations", json!({})).await
            }
        }
        "set_models" => {
            let operation = if args["download_missing"].as_bool().unwrap_or(false) {
                "install_models"
            } else {
                "select_models"
            };
            server
                .dispatch_internal(operation, json!({"selection":args["selection"]}))
                .await
        }
        "cancel_job" => {
            let (operation, args) = cancellation_request(args)?;
            server.dispatch_internal(operation, args).await
        }
        name if definitions::FORWARDED.contains(&name) => {
            server.dispatch_internal(name, args).await
        }
        _ => Err(message("Unknown tool")),
    }?;
    Ok(public_operation_result(result))
}

async fn context<R: tauri::Runtime>(server: &MusicServer<R>, args: Value) -> Result<Value> {
    let sections: Vec<_> = args["sections"]
        .as_array()
        .map(|sections| sections.iter().filter_map(Value::as_str).collect())
        .unwrap_or_else(|| CONTEXT_SECTIONS.to_vec());
    let mut context = json!({});
    if sections.contains(&"status") {
        context = server.dispatch_internal("get_status", json!({})).await?;
        // The queue section owns the richer queue/progress shape.
        if let Some(context) = context.as_object_mut() {
            context.remove("queue");
            context.remove("progress");
        }
    }
    if sections.contains(&"settings") {
        let settings = server.dispatch_internal("get_settings", json!({})).await?;
        context
            .as_object_mut()
            .ok_or_else(|| message("Invalid status result"))?
            .extend(
                settings
                    .as_object()
                    .ok_or_else(|| message("Invalid settings result"))?
                    .clone(),
            );
    }
    if sections.contains(&"policy") {
        let mut request = json!({"refresh":args["refresh"].as_bool().unwrap_or(false)});
        if let Some(selection) = args.get("selection") {
            request["selection"] = selection.clone();
        }
        match server
            .dispatch_internal("get_generation_policy", request)
            .await
        {
            Ok(policy) => context["policy"] = policy,
            Err(error) if args.get("selection").is_none() => {
                // First-run setup can have no selected model; readiness/settings remain useful.
                context["policy"] = Value::Null;
                context["policy_error"] = json!(error.to_string());
            }
            Err(error) => return Err(error),
        }
    }
    if sections.contains(&"queue") {
        context["queue"] = server.dispatch_internal("get_queue", json!({})).await?;
    }
    if sections.contains(&"folders") {
        context["folders"] = server.dispatch_internal("list_folders", json!({})).await?;
    }
    Ok(context)
}

fn generation_request(mut args: Value) -> Result<(&'static str, Value)> {
    let values = args
        .as_object_mut()
        .ok_or_else(|| message("Expected generation arguments"))?;
    let Some(source) = values.remove("source_song_id") else {
        return Ok(("generate_music", args));
    };
    let variants = values.remove("variants").unwrap_or_else(|| json!(1));
    let decision = values.remove("cpu_iteration_decision");
    let mut request = json!({"id":source, "variants":variants, "overrides":values});
    if let Some(decision) = decision {
        request["cpu_iteration_decision"] = decision;
    }
    Ok(("create_variants", request))
}

fn cancellation_request(args: Value) -> Result<(&'static str, Value)> {
    match args["target"].as_str() {
        Some("song") => Ok(("cancel_song", json!({"id":args["id"]}))),
        Some("operation") => Ok(("cancel_operation", json!({"operation_id":args["id"]}))),
        _ => Err(message("Cancellation target must be song or operation")),
    }
}

fn flatten_song(mut result: Value, seconds: u64) -> Result<Value> {
    let mut song = result
        .as_object_mut()
        .and_then(|value| value.remove("song"))
        .filter(Value::is_object)
        .ok_or_else(|| message("Invalid song result"))?;
    song["completed"] = result["completed"].clone();
    song["timed_out"] = json!(seconds > 0 && result["timed_out"] == true);
    song["progress"] = result["progress"].clone();
    Ok(song)
}

fn public_operation_result(mut result: Value) -> Value {
    if result["poll_tool"] == "get_operation" {
        result["poll_tool"] = json!("get_operations");
    }
    result
}

#[cfg(test)]
mod tests;
