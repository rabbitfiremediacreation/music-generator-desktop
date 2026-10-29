//! Exercise the shipped console binary over real stdin/stdout and loopback HTTP.
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::post,
    Json, Router,
};
use serde_json::{json, Value};
use std::{
    process::Stdio,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

const TOKEN: &str = "integration-token-012345678901234567890123456789";

async fn endpoint(
    State(seen): State<Arc<Mutex<Vec<Value>>>>,
    headers: HeaderMap,
    Json(request): Json<Value>,
) -> std::result::Result<Json<Value>, StatusCode> {
    if headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        != Some(&format!("Bearer {TOKEN}"))
    {
        return Err(StatusCode::UNAUTHORIZED);
    }
    if let Some(version) = request
        .pointer("/params/_meta/io.modelcontextprotocol~1protocolVersion")
        .and_then(Value::as_str)
    {
        if headers
            .get("mcp-protocol-version")
            .and_then(|value| value.to_str().ok())
            != Some(version)
            || headers
                .get("mcp-method")
                .and_then(|value| value.to_str().ok())
                != request["method"].as_str()
        {
            return Err(StatusCode::BAD_REQUEST);
        }
        if request["method"] == "tools/call"
            && headers
                .get("mcp-name")
                .and_then(|value| value.to_str().ok())
                != Some("fixture_tool")
        {
            return Err(StatusCode::BAD_REQUEST);
        }
    }
    seen.lock().unwrap().push(request.clone());
    let result = match request["method"].as_str().unwrap_or("") {
        "initialize" => {
            json!({"protocolVersion":"2025-11-25","capabilities":{"tools":{}},"serverInfo":{"name":"bridge-test-fixture","version":"1"}})
        }
        "tools/list" => json!({"tools":[{"name":"fixture_tool","inputSchema":{"type":"object"}}]}),
        _ => json!({}),
    };
    Ok(Json(
        json!({"jsonrpc":"2.0","id":request["id"],"result":result}),
    ))
}

#[tokio::test]
async fn console_binary_forwards_jsonrpc_without_starting_the_desktop() {
    let root = tempfile::tempdir().unwrap();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let router = Router::new()
        .route("/mcp", post(endpoint))
        .with_state(seen.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    let config = root.path().join("mcp.json");
    std::fs::write(
        &config,
        json!({"url":format!("http://{address}/mcp"),"token":TOKEN,"pid":std::process::id()})
            .to_string(),
    )
    .unwrap();
    let mut child = tokio::process::Command::new(env!("CARGO_BIN_EXE_music-generator-mcp"))
        .arg("--mcp-stdio")
        .arg(config)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap()).lines();
    for (method, id) in [
        ("initialize", 1),
        ("tools/list", 2),
        ("server/discover", 3),
        ("tools/call", 4),
    ] {
        let params = if id < 3 {
            json!({})
        } else {
            json!({"name":"fixture_tool","arguments":{},"_meta":{
                "io.modelcontextprotocol/protocolVersion":"2026-07-28",
                "io.modelcontextprotocol/clientCapabilities":{}
            }})
        };
        stdin
            .write_all(
                format!(
                    "{}\n",
                    json!({"jsonrpc":"2.0","id":id,"method":method,"params":params})
                )
                .as_bytes(),
            )
            .await
            .unwrap();
        stdin.flush().await.unwrap();
        let line = tokio::time::timeout(Duration::from_secs(30), stdout.next_line())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let response: Value = serde_json::from_str(&line).expect("stdout contains only JSON-RPC");
        assert_eq!(response["id"], id);
        assert!(response.get("result").is_some(), "{response}");
        assert!(!line.contains(TOKEN));
    }
    stdin.write_all(b"not-json\n").await.unwrap();
    stdin.flush().await.unwrap();
    let line = tokio::time::timeout(Duration::from_secs(3), stdout.next_line())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&line).unwrap()["error"]["code"],
        -32700
    );
    drop(stdin);
    assert!(tokio::time::timeout(Duration::from_secs(3), child.wait())
        .await
        .unwrap()
        .unwrap()
        .success());
    assert_eq!(seen.lock().unwrap().len(), 4);
    assert!(!root.path().join("music.db").exists());
    server.abort();
}
