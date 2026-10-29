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
    let tools = library::tools()
        .into_iter()
        .chain(operations::tools())
        .collect::<Vec<_>>();
    assert_eq!(definitions().len(), tools.len(), "duplicate tool names");
    assert!(tools.len() >= 25);
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
            CallToolRequestParams::new("cancel_song")
                .with_arguments(json!({"id":ids[0]}).as_object().unwrap().clone()),
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
        "save_folder":folder, "update_song":update, "cancel_song":cancel, "read_resource":resource,
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
