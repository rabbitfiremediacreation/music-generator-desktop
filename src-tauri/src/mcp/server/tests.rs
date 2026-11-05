use super::*;
use crate::{db::Database, types::GenerateRequest};
use rmcp::ServiceExt;

fn fixture() -> (tempfile::TempDir, MusicServer<tauri::test::MockRuntime>) {
    let root = tempfile::tempdir().unwrap();
    let app = tauri::test::mock_app();
    let state = Arc::new(AppState::new(
        Database::open(root.path()).unwrap(),
        root.path().join("resources"),
    ));
    (root, MusicServer::new(state, app.handle().clone()))
}

#[test]
fn complete_catalog_has_valid_unique_strict_schemas() {
    let tools = surface::tools();
    assert_eq!(definitions().len(), tools.len(), "duplicate tool names");
    assert_eq!(tools.len(), 20);
    for obsolete in [
        "get_status",
        "get_settings",
        "get_generation_policy",
        "get_queue",
        "list_folders",
        "wait_song",
        "create_variants",
        "get_operation",
        "list_operations",
        "select_models",
        "install_models",
        "cancel_song",
        "cancel_operation",
    ] {
        assert!(
            !definitions().contains_key(obsolete),
            "obsolete public tool: {obsolete}"
        );
    }
    for tool in tools {
        assert_eq!(tool["inputSchema"]["additionalProperties"], false, "{tool}");
        assert!(tool["annotations"]["readOnlyHint"].is_boolean());
        assert!(!definitions()[tool["name"].as_str().unwrap()]
            .validator
            .is_valid(&json!({"unexpected":true})));
    }
}

#[tokio::test]
async fn validation_rejects_unknown_fields_ranges_and_missing_confirmation() {
    let (_root, server) = fixture();
    for (name, args) in [
        (
            "generate_music",
            json!({"prompt":"piano", "inference_steps":201}),
        ),
        ("generate_music", json!({"prompt":"piano", "duration":-1})),
        ("generate_music", json!({"promtp":"typo"})),
        ("delete_song", json!({"id":"anything"})),
        ("delete_song", json!({"id":"anything", "confirm":false})),
        ("list_songs", json!({"limit":101})),
        ("get_context", json!({"sections":["unknown"]})),
        ("get_song", json!({"id":"anything","wait_seconds":31})),
        ("cancel_job", json!({"id":"anything","target":"all"})),
    ] {
        assert_eq!(
            server.invoke(name, args).await.unwrap().is_error,
            Some(true),
            "{name}"
        );
    }
    assert!(server.invoke("unknown", json!({})).await.is_err());
    assert_eq!(server.state.db.folders().unwrap()["all"], 0);
}

#[tokio::test]
async fn sdk_roundtrip_controls_the_shared_library() {
    let (_root, server) = fixture();
    let state = server.state.clone();
    let ids = state
        .db
        .enqueue(&GenerateRequest {
            prompt: "Local MCP test fixture".into(),
            title: "Protocol test".into(),
            duration: 10.0,
            ..Default::default()
        })
        .unwrap();
    let (server_io, client_io) = tokio::io::duplex(65536);
    let task = tokio::spawn(async move {
        server
            .serve(server_io)
            .await
            .unwrap()
            .waiting()
            .await
            .unwrap();
    });
    let client = ().serve(client_io).await.unwrap();
    let tools = client.list_all_tools().await.unwrap();
    assert!(tools.iter().any(|t| t.name == "generate_music"));
    let folder = client
        .call_tool(
            CallToolRequestParams::new("save_folder").with_arguments(
                json!({"name":"MCP integration"})
                    .as_object()
                    .unwrap()
                    .clone(),
            ),
        )
        .await
        .unwrap();
    let folder_value = serde_json::to_value(&folder).unwrap();
    let folder_id = folder_value["structuredContent"]["result"]["id"]
        .as_str()
        .unwrap();
    let update = client
        .call_tool(
            CallToolRequestParams::new("update_song").with_arguments(
                json!({"id":ids[0], "favorite":true, "folder_id":folder_id})
                    .as_object()
                    .unwrap()
                    .clone(),
            ),
        )
        .await
        .unwrap();
    assert_eq!(
        state.db.song(&ids[0]).unwrap().folder_id.as_deref(),
        Some(folder_id)
    );
    assert!(state.db.song(&ids[0]).unwrap().favorite);
    let cancel = client
        .call_tool(
            CallToolRequestParams::new("cancel_job").with_arguments(
                json!({"target":"song","id":ids[0]})
                    .as_object()
                    .unwrap()
                    .clone(),
            ),
        )
        .await
        .unwrap();
    assert_eq!(state.db.song(&ids[0]).unwrap().status, "cancelled");
    let resources = client.list_all_resources().await.unwrap();
    assert_eq!(resources.len(), 4);
    let resource = client
        .read_resource(ReadResourceRequestParams::new(format!(
            "music://songs/{}",
            ids[0]
        )))
        .await
        .unwrap();
    let prompts = client.list_all_prompts().await.unwrap();
    assert_eq!(prompts[0].name, "create_music");
    let transcript = json!({
        "description":"Actual SDK roundtrip against an isolated SQLite fixture; mock Tauri window runtime, no audio engine or model download.",
        "server": client.peer_info(), "tool_count":tools.len(),
        "tools": tools.iter().map(|tool| tool.name.to_string()).collect::<Vec<_>>(),
        "save_folder":folder, "update_song":update, "cancel_job":cancel, "read_resource":resource,
        "verified":"Changes visible in the same AppState database; cancellation preserved the song."
    });
    if let Some(path) = std::env::var_os("MUSIC_GENERATOR_MCP_TEST_TRANSCRIPT") {
        std::fs::write(path, serde_json::to_vec_pretty(&transcript).unwrap()).unwrap();
    }
    println!("MCP integration: {} tools, folder creation, song update, cancellation and resource read verified", tools.len());
    client.cancel().await.unwrap();
    task.await.unwrap();
}

#[test]
fn resource_paths_are_explicit_and_never_arbitrary_files() {
    assert_eq!(
        resources::resolve("music://songs/abc123").unwrap().0,
        "get_song"
    );
    assert_eq!(
        resources::resolve("music://songs/legacy_song_1").unwrap().1,
        json!({"id":"legacy_song_1"})
    );
    for uri in [
        "file:///etc/passwd",
        "music://songs/../settings",
        "music://songs/",
        "music://operations/a?b",
    ] {
        assert!(resources::resolve(uri).is_err());
    }
}

#[tokio::test]
async fn context_sections_and_operations_avoid_unrequested_work() {
    let (_root, server) = fixture();
    let result = server
        .invoke("get_context", json!({"sections":["queue"]}))
        .await
        .unwrap();
    assert_ne!(result.is_error, Some(true));
    let value = result.structured_content.unwrap()["result"].clone();
    assert_eq!(value.as_object().unwrap().len(), 1);
    assert_eq!(value["queue"]["ready"], false);
    assert!(!server.state.runtime.is_busy());
    let result = server.invoke("get_operations", json!({})).await.unwrap();
    assert_eq!(
        result.structured_content.unwrap()["result"]["operations"],
        json!([])
    );
    for old in [
        "get_status",
        "get_queue",
        "get_operation",
        "cancel_song",
        "create_variants",
    ] {
        assert!(server.invoke(old, json!({})).await.is_err());
    }
}

#[tokio::test]
async fn unified_song_read_keeps_shape_and_cancel_never_deletes() {
    let (_root, server) = fixture();
    let id = server
        .state
        .db
        .enqueue(&GenerateRequest {
            prompt: "Song status fixture".into(),
            ..Default::default()
        })
        .unwrap()
        .remove(0);
    let immediate = server.invoke("get_song", json!({"id":id})).await.unwrap();
    let initial = immediate.structured_content.unwrap()["result"].clone();
    assert_eq!(initial["id"], id);
    assert_eq!(initial["status"], "queued");
    assert_eq!(initial["completed"], false);
    assert_eq!(initial["timed_out"], false);
    let cancelled = server
        .invoke("cancel_job", json!({"target":"song","id":id}))
        .await
        .unwrap();
    assert_ne!(cancelled.is_error, Some(true));
    let waited = server
        .invoke("get_song", json!({"id":id,"wait_seconds":30}))
        .await
        .unwrap();
    let terminal = waited.structured_content.unwrap()["result"].clone();
    assert_eq!(terminal["status"], "cancelled");
    assert_eq!(terminal["completed"], true);
    assert_eq!(
        terminal.as_object().unwrap().keys().collect::<Vec<_>>(),
        initial.as_object().unwrap().keys().collect::<Vec<_>>()
    );
    server
        .invoke("cancel_job", json!({"target":"song","id":id}))
        .await
        .unwrap();
    assert_eq!(server.state.db.song(&id).unwrap().status, "cancelled");
}

#[tokio::test]
async fn model_selection_does_not_implicitly_start_a_download() {
    let (_root, server) = fixture();
    let selection = crate::catalog::Selection::from_settings(&server.state.db.settings().unwrap());
    let result = server
        .invoke("set_models", json!({"selection":selection}))
        .await
        .unwrap();
    assert_eq!(result.is_error, Some(true));
    let operations = server.invoke("get_operations", json!({})).await.unwrap();
    assert_eq!(
        operations.structured_content.unwrap()["result"]["operations"],
        json!([])
    );
    assert!(!server.state.runtime.is_busy());
}
