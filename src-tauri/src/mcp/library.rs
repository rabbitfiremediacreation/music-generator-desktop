use crate::{
    error::{message, Result},
    state::AppState,
    types::SongFilter,
};
use serde_json::{json, Value};
use std::{sync::Arc, time::Duration};

#[path = "library_db.rs"]
mod database;
#[path = "library_tools.rs"]
mod definitions;
#[path = "library_generation.rs"]
mod generation;

pub fn tools() -> Vec<Value> {
    definitions::tools()
}

fn string<'a>(args: &'a Value, key: &str) -> Result<&'a str> {
    args[key]
        .as_str()
        .ok_or_else(|| message(format!("Missing {key}")))
}

fn confirmation(args: &Value) -> Result<()> {
    if args["confirm"] != true {
        return Err(message("Explicit confirm=true is required"));
    }
    Ok(())
}

fn require_folder(state: &AppState, id: &str) -> Result<()> {
    let folders = state.db.folders()?;
    if !folders["folders"]
        .as_array()
        .is_some_and(|folders| folders.iter().any(|folder| folder["id"] == id))
    {
        return Err(message("Folder not found"));
    }
    Ok(())
}

pub async fn call<R: tauri::Runtime>(
    name: &str,
    args: Value,
    state: Arc<AppState>,
    app: &tauri::AppHandle<R>,
) -> Option<Result<Value>> {
    let read_only = matches!(
        name,
        "list_songs" | "get_song" | "list_folders" | "get_queue" | "wait_song"
    );
    if !read_only
        && !matches!(
            name,
            "generate_music"
                | "create_variants"
                | "retry_song"
                | "cancel_song"
                | "delete_song"
                | "update_song"
                | "save_folder"
                | "delete_folder"
        )
    {
        return None;
    }
    let result = async {
        match name {
            "generate_music" => generation::generate(state.clone(), args).await,
            "create_variants" => generation::variants(state.clone(), args).await,
            "retry_song" => generation::retry(state.clone(), args).await,
            "list_songs" => {
                let filter: SongFilter = serde_json::from_value(args.clone())?;
                state.db.mcp_song_page(
                    &filter,
                    args["status"].as_str().unwrap_or(""),
                    args["limit"].as_u64().unwrap_or(25).clamp(1, 100) as u32,
                    args["offset"].as_u64().unwrap_or(0).min(1_000_000_000) as u32,
                )
            }
            "get_song" => Ok(serde_json::to_value(state.db.song(string(&args, "id")?)?)?),
            "cancel_song" => {
                let id = string(&args, "id")?;
                let cancelled = state
                    .runtime
                    .update_preferences(|| state.db.mcp_cancel_song(id))?;
                if cancelled {
                    state.runtime.cancel_song(id);
                }
                Ok(json!({"cancelled": cancelled, "song": state.db.song(id)?}))
            }
            "delete_song" => {
                confirmation(&args)?;
                let id = string(&args, "id")?;
                state
                    .runtime
                    .update_preferences(|| state.db.mcp_delete_song(id))?;
                Ok(json!({"deleted": true, "id": id}))
            }
            "update_song" => {
                let id = string(&args, "id")?;
                if !["title", "favorite", "folder_id"]
                    .iter()
                    .any(|key| args.get(key).is_some())
                {
                    return Err(message("Supply title, favorite or folder_id"));
                }
                state.runtime.update_preferences(|| {
                    state.db.song(id)?;
                    state.db.patch(id, &args)?;
                    Ok(serde_json::to_value(state.db.song(id)?)?)
                })
            }
            "list_folders" => state.db.folders(),
            "save_folder" => {
                let id = args["id"].as_str();
                state.runtime.update_preferences(|| {
                    if let Some(id) = id {
                        require_folder(&state, id)?;
                    }
                    state.db.folder_save(id, string(&args, "name")?)
                })
            }
            "delete_folder" => {
                confirmation(&args)?;
                let id = string(&args, "id")?;
                state.runtime.update_preferences(|| {
                    require_folder(&state, id)?;
                    state.db.folder_delete(id)
                })?;
                Ok(json!({"deleted": true, "id": id, "songs_preserved": true}))
            }
            "get_queue" => {
                let mut queue = state.db.queue()?;
                queue["jobs"] = json!(state.db.mcp_queue_jobs()?);
                queue["active"] = json!(state.runtime.is_busy());
                queue["ready"] = json!(state.runtime.is_ready());
                queue["progress"] = json!(state.runtime.progress());
                Ok(queue)
            }
            "wait_song" => {
                wait_song(
                    &state,
                    string(&args, "id")?,
                    args["timeout_seconds"].as_u64().unwrap_or(10).min(30),
                )
                .await
            }
            _ => unreachable!("tool name checked above"),
        }
    }
    .await;
    if !read_only && result.is_ok() {
        state.changed(app);
    }
    Some(result)
}

async fn wait_song(state: &AppState, id: &str, seconds: u64) -> Result<Value> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds.min(30));
    let shutdown = state.runtime.cancellation();
    loop {
        let song = state.db.song(id)?;
        let completed = matches!(song.status.as_str(), "done" | "error" | "cancelled");
        let timed_out = !completed && tokio::time::Instant::now() >= deadline;
        if completed || timed_out {
            return Ok(
                json!({"song": song, "completed": completed, "timed_out": timed_out, "progress": state.runtime.progress().filter(|progress| progress.job_id == id)}),
            );
        }
        tokio::select! {
            _ = shutdown.cancelled() => return Err(crate::error::Error::Cancelled),
            _ = tokio::time::sleep_until(deadline.min(tokio::time::Instant::now() + Duration::from_millis(250))) => (),
        }
    }
}

#[cfg(test)]
#[path = "library_tests.rs"]
mod tests;
