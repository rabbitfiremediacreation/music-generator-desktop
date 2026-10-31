use super::*;

fn access() -> Access {
    Access {
        authorization: format!("Bearer {}", "a".repeat(64)),
        authority: "127.0.0.1:9876".into(),
    }
}

fn headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(header::HOST, "127.0.0.1:9876".parse().unwrap());
    headers.insert(
        header::AUTHORIZATION,
        access().authorization.parse().unwrap(),
    );
    headers
}

#[test]
fn requires_token_and_direct_local_authority_without_browser_origin() {
    assert_eq!(access().check(&headers()), Ok(()));
    let mut request = headers();
    request.remove(header::AUTHORIZATION);
    assert_eq!(access().check(&request), Err(StatusCode::UNAUTHORIZED));
    let mut request = headers();
    request.insert(
        header::AUTHORIZATION,
        format!("Bearer {}", "b".repeat(64)).parse().unwrap(),
    );
    assert_eq!(access().check(&request), Err(StatusCode::UNAUTHORIZED));
    for host in ["evil.example:9876", "localhost:9876", "127.0.0.1:4321"] {
        let mut request = headers();
        request.insert(header::HOST, host.parse().unwrap());
        assert_eq!(access().check(&request), Err(StatusCode::FORBIDDEN));
    }
    for origin in ["null", "https://example.com", "http://127.0.0.1:9876"] {
        let mut request = headers();
        request.insert(header::ORIGIN, origin.parse().unwrap());
        assert_eq!(access().check(&request), Err(StatusCode::FORBIDDEN));
    }
}

#[test]
fn token_configuration_rejects_weak_or_header_injecting_values() {
    assert!(validate_token(&"a".repeat(64)).is_ok());
    assert!(validate_token("short").is_err());
    assert!(validate_token(&format!("{}\r\nInjected: true", "a".repeat(64))).is_err());
}

#[test]
fn credentials_are_private_and_shutdown_preserves_replacement() {
    let root = tempfile::tempdir().unwrap();
    let info = ConnectionInfo {
        url: "http://127.0.0.1:1234/mcp".into(),
        token: "a".repeat(64),
        pid: 1,
    };
    let descriptor = ConnectionFile::create(root.path(), info.clone()).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&descriptor.path)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
    let replacement = ConnectionInfo { pid: 2, ..info };
    let next = ConnectionFile::create(root.path(), replacement).unwrap();
    drop(descriptor);
    assert!(next.path.exists());
    let path = next.path.clone();
    drop(next);
    assert!(!path.exists());
}

#[cfg(unix)]
#[tokio::test]
async fn http_client_controls_the_shared_library_and_enforces_access() {
    use crate::{db::Database, types::GenerateRequest};
    use serde_json::{json, Value};
    use tauri::test::{mock_builder, mock_context, noop_assets};
    let root = tempfile::tempdir().unwrap();
    let state = Arc::new(AppState::new(
        Database::open(root.path()).unwrap(),
        root.path().into(),
    ));
    let song_id = state
        .db
        .enqueue(&GenerateRequest {
            prompt: "Test fixture: soft piano".into(),
            ..Default::default()
        })
        .unwrap()
        .remove(0);
    state.db.claim_next().unwrap();
    let app = mock_builder().build(mock_context(noop_assets())).unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let token = "test-token-012345678901234567890123456789";
    let cancellation = state.runtime.cancellation();
    let router = router(
        state.clone(),
        app.handle().clone(),
        address.to_string(),
        token.into(),
        cancellation.clone(),
    );
    let server = tokio::spawn(async move {
        axum::serve(listener, router)
            .with_graceful_shutdown(cancellation.cancelled_owned())
            .await
            .unwrap();
    });
    let url = format!("http://{address}/mcp");
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let post = |body: Value| {
        client
            .post(&url)
            .bearer_auth(token)
            .header("Accept", "application/json, text/event-stream")
            .header(
                "MCP-Protocol-Version",
                body.pointer("/params/_meta/io.modelcontextprotocol~1protocolVersion")
                    .and_then(Value::as_str)
                    .unwrap_or("2025-11-25"),
            )
            .json(&body)
    };
    let init = json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{
        "protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"integration-test","version":"1"}
    }});
    assert_eq!(
        client.post(&url).json(&init).send().await.unwrap().status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        post(init.clone())
            .header("Origin", "https://example.com")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        post(init.clone())
            .header("Host", "attacker.example")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    let initialized: Value = post(init)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(initialized["result"]["protocolVersion"], "2025-11-25");
    assert_eq!(
        initialized["result"]["serverInfo"]["name"],
        "music-generator"
    );
    let list: Value = post(json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    let tools = list["result"]["tools"].as_array().unwrap();
    assert!(tools.iter().any(|tool| tool["name"] == "generate_music"));
    assert!(tools.iter().any(|tool| tool["name"] == "export_file"));
    let folder: Value = post(
        json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{
            "name":"save_folder","arguments":{"name":"MCP integration"}
        }}),
    )
    .send()
    .await
    .unwrap()
    .error_for_status()
    .unwrap()
    .json()
    .await
    .unwrap();
    let folder_id = folder["result"]["structuredContent"]["result"]["id"]
        .as_str()
        .unwrap();
    assert_eq!(state.db.folders().unwrap()["folders"][0]["id"], folder_id);
    let song: Value = post(
        json!({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{
            "name":"get_song","arguments":{"id":song_id}
        }}),
    )
    .send()
    .await
    .unwrap()
    .error_for_status()
    .unwrap()
    .json()
    .await
    .unwrap();
    assert_eq!(
        song["result"]["structuredContent"]["result"]["status"],
        "running"
    );
    assert_eq!(
        state.db.song(&song_id).unwrap().status,
        "running",
        "MCP must not open a second database and reset active jobs"
    );
    let meta = json!({
        "io.modelcontextprotocol/protocolVersion":"2026-07-28",
        "io.modelcontextprotocol/clientCapabilities":{},
        "io.modelcontextprotocol/clientInfo":{"name":"modern-integration-test","version":"1"}
    });
    let discover: Value =
        post(json!({"jsonrpc":"2.0","id":5,"method":"server/discover","params":{"_meta":meta}}))
            .header("Mcp-Method", "server/discover")
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .json()
            .await
            .unwrap();
    assert!(discover["result"]["supportedVersions"]
        .as_array()
        .unwrap()
        .contains(&json!("2026-07-28")));
    let modern_song: Value = post(
        json!({"jsonrpc":"2.0","id":6,"method":"tools/call","params":{
            "name":"get_song","arguments":{"id":song_id},"_meta":meta
        }}),
    )
    .header("Mcp-Method", "tools/call")
    .header("Mcp-Name", "get_song")
    .send()
    .await
    .unwrap()
    .error_for_status()
    .unwrap()
    .json()
    .await
    .unwrap();
    assert_eq!(
        modern_song["result"]["structuredContent"]["result"]["status"],
        "running"
    );
    let oversized = " ".repeat(MAX_REQUEST_BYTES + 1);
    assert_eq!(
        post(json!({}))
            .body(oversized)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::PAYLOAD_TOO_LARGE
    );
    println!("MCP HTTP integration: legacy initialize + modern discovery, {} tools, authenticated folder creation, shared running song, Origin/Host/token guards and 1 MiB limit passed.", tools.len());
    state.begin_shutdown();
    tokio::time::timeout(std::time::Duration::from_secs(3), server)
        .await
        .unwrap()
        .unwrap();
}
