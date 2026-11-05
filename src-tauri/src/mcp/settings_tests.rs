use super::*;

#[test]
fn disabled_default_and_environment_override_validation() {
    let root = tempfile::tempdir().unwrap();
    let control = Control::new(root.path().into(), Environment::default());
    let status = control.status().unwrap();
    assert!(!status.enabled && !status.running && !status.managed_by_environment);
    assert_eq!(status.port, 32123);
    assert!(status.error.is_none());
    let settings = McpSettings {
        scope: McpScope::Local,
        enabled: true,
        port: 32123,
    };
    write_private(
        &root.path().join("mcp-settings.json"),
        &serde_json::to_vec(&settings).unwrap(),
    )
    .unwrap();
    let control = Control::new(root.path().into(), Environment::default());
    assert_eq!(control.current.lock().unwrap().settings, settings);
    let control = Control::new(
        root.path().into(),
        Environment {
            port: Some("0".into()),
            token: None,
        },
    );
    let status = control.status().unwrap();
    assert!(status.enabled && status.managed_by_environment);
    assert_eq!(status.port, 0);
    let control = Control::new(
        root.path().into(),
        Environment {
            port: Some("invalid".into()),
            token: None,
        },
    );
    let status = control.status().unwrap();
    assert!(status.managed_by_environment && !status.running && status.error.is_some());
}

#[test]
fn malformed_preferences_remain_disabled_with_visible_error() {
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("mcp-settings.json"), b"broken").unwrap();
    let control = Control::new(root.path().into(), Environment::default());
    let status = control.status().unwrap();
    assert!(!status.running && !status.enabled && status.error.is_some());
    assert!(serde_json::from_value::<McpSettings>(
        serde_json::json!({"enabled":true,"port":65536})
    )
    .is_err());
}

#[cfg(unix)]
fn fixture(root: &Path) -> (Arc<AppState>, tauri::App<tauri::test::MockRuntime>) {
    use tauri::test::{mock_builder, mock_context, noop_assets};
    let state = Arc::new(AppState::new(
        crate::db::Database::open(root).unwrap(),
        root.into(),
    ));
    let app = mock_builder().build(mock_context(noop_assets())).unwrap();
    (state, app)
}

#[cfg(unix)]
#[tokio::test]
async fn live_changes_preserve_generation_and_restart_from_saved_preferences() {
    let root = tempfile::tempdir().unwrap();
    let (state, app) = fixture(root.path());
    let control = Control::new(root.path().into(), Environment::default());
    let generation = state
        .runtime
        .try_begin(crate::runtime::OperationKind::Generation)
        .unwrap();
    let enabled = McpSettings {
        scope: McpScope::Local,
        enabled: true,
        port: 0,
    };
    control
        .apply(state.clone(), app.handle().clone(), enabled, true)
        .unwrap();
    let first = control.status().unwrap();
    assert!(first.enabled && first.running && first.url.is_some());
    let secret: ConnectionInfo =
        serde_json::from_slice(&std::fs::read(&first.config_path).unwrap()).unwrap();
    assert!(!serde_json::to_string(&first)
        .unwrap()
        .contains(&secret.token));
    assert!(
        !std::fs::read_to_string(root.path().join("mcp-settings.json"))
            .unwrap()
            .contains(&secret.token)
    );
    assert!(!first.client_config.contains("token"));
    let config: serde_json::Value = serde_json::from_str(&first.client_config).unwrap();
    assert_eq!(
        config["mcpServers"]["music-generator"]["args"][1],
        first.config_path
    );
    // Reapplying the same effective preference does not rotate credentials or reconnect clients.
    control
        .apply(state.clone(), app.handle().clone(), enabled, true)
        .unwrap();
    assert_eq!(control.status().unwrap().url, first.url);
    let server = control
        .apply(
            state.clone(),
            app.handle().clone(),
            McpSettings::default(),
            true,
        )
        .unwrap()
        .unwrap();
    server.wait_closed().await;
    assert!(!control.status().unwrap().running);
    assert!(!root.path().join("mcp.json").exists());
    assert!(!generation.cancellation().is_cancelled());
    assert!(!state.runtime.is_shutdown());
    drop(generation);
    assert!(state
        .runtime
        .try_begin(crate::runtime::OperationKind::Analysis)
        .is_ok());
    control
        .apply(state.clone(), app.handle().clone(), enabled, true)
        .unwrap();
    let server = control.current.lock().unwrap().server.clone().unwrap();
    server.stop();
    server.wait_closed().await;
    drop(control);
    drop(state);
    drop(app);
    let (fresh_state, fresh_app) = fixture(root.path());
    let restored = Control::new(root.path().into(), Environment::default());
    assert_eq!(restored.current.lock().unwrap().settings, enabled);
    restored
        .apply(fresh_state, fresh_app.handle().clone(), enabled, false)
        .unwrap();
    assert!(restored.status().unwrap().running);
    let restarted = restored
        .http_connection(restored.status().unwrap().url.as_deref().unwrap())
        .unwrap();
    assert_eq!(restarted.token, secret.token);
    let server = restored.current.lock().unwrap().server.clone().unwrap();
    server.stop();
    server.wait_closed().await;
}

#[cfg(unix)]
#[tokio::test]
async fn fixed_port_disable_reenable_and_conflicts_preserve_working_connection() {
    let root = tempfile::tempdir().unwrap();
    let (state, app) = fixture(root.path());
    let control = Control::new(root.path().into(), Environment::default());
    let reservation = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let port = reservation.local_addr().unwrap().port();
    drop(reservation);
    let settings = McpSettings {
        scope: McpScope::Local,
        enabled: true,
        port,
    };
    control
        .apply(state.clone(), app.handle().clone(), settings, true)
        .unwrap();
    let before = std::fs::read(root.path().join("mcp.json")).unwrap();
    control
        .apply(state.clone(), app.handle().clone(), settings, true)
        .unwrap();
    assert_eq!(std::fs::read(root.path().join("mcp.json")).unwrap(), before);
    let busy = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    assert!(control
        .apply(
            state.clone(),
            app.handle().clone(),
            McpSettings {
                scope: McpScope::Local,
                enabled: true,
                port: busy.local_addr().unwrap().port()
            },
            true
        )
        .is_err());
    assert_eq!(std::fs::read(root.path().join("mcp.json")).unwrap(), before);
    assert_eq!(control.status().unwrap().port, port);
    assert!(control.status().unwrap().running);
    let previous = control
        .apply(
            state.clone(),
            app.handle().clone(),
            McpSettings {
                scope: McpScope::Local,
                enabled: false,
                port,
            },
            true,
        )
        .unwrap()
        .unwrap();
    previous.wait_closed().await;
    control
        .apply(state, app.handle().clone(), settings, true)
        .unwrap();
    assert!(control.status().unwrap().running);
    assert!(root.path().join("mcp.json").exists());
    let server = control.current.lock().unwrap().server.clone().unwrap();
    server.stop();
    server.wait_closed().await;
}

#[cfg(unix)]
#[tokio::test]
async fn persistence_failure_does_not_replace_server_or_credentials() {
    let root = tempfile::tempdir().unwrap();
    let (state, app) = fixture(root.path());
    let control = Control::new(root.path().into(), Environment::default());
    control
        .apply(
            state.clone(),
            app.handle().clone(),
            McpSettings {
                scope: McpScope::Local,
                enabled: true,
                port: 0,
            },
            true,
        )
        .unwrap();
    let before = std::fs::read(root.path().join("mcp.json")).unwrap();
    std::fs::remove_file(root.path().join("mcp-settings.json")).unwrap();
    std::fs::create_dir(root.path().join("mcp-settings.json")).unwrap();
    assert!(control
        .apply(state, app.handle().clone(), McpSettings::default(), true)
        .is_err());
    assert!(control.status().unwrap().running);
    assert_eq!(std::fs::read(root.path().join("mcp.json")).unwrap(), before);
    let server = control.current.lock().unwrap().server.clone().unwrap();
    server.stop();
    server.wait_closed().await;
}

#[cfg(unix)]
#[tokio::test]
async fn environment_control_rejects_writes_and_stopped_requests_are_denied() {
    let root = tempfile::tempdir().unwrap();
    let (state, app) = fixture(root.path());
    let control = Control::new(
        root.path().into(),
        Environment {
            port: Some("0".into()),
            token: None,
        },
    );
    let enabled = control.current.lock().unwrap().settings;
    control
        .apply(state.clone(), app.handle().clone(), enabled, false)
        .unwrap();
    assert!(control
        .apply(
            state.clone(),
            app.handle().clone(),
            McpSettings::default(),
            true
        )
        .is_err());
    assert!(!root.path().join("mcp-settings.json").exists());
    let server = control.current.lock().unwrap().server.clone().unwrap();
    let info: ConnectionInfo =
        serde_json::from_slice(&std::fs::read(root.path().join("mcp.json")).unwrap()).unwrap();
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let request = || {
        client.post(&info.url).bearer_auth(&info.token).header("Accept", "application/json, text/event-stream").json(&serde_json::json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"settings-test","version":"1"}}}))
    };
    assert!(request().send().await.unwrap().status().is_success());
    server.stop();
    let mutation = client.post(&info.url).bearer_auth(&info.token)
        .header("Accept", "application/json, text/event-stream")
        .header("Mcp-Protocol-Version", "2025-11-25")
        .json(&serde_json::json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"save_folder","arguments":{"name":"must-not-exist"}}}));
    if let Ok(response) = mutation.send().await {
        assert!(!response.status().is_success());
    }
    server.wait_closed().await;
    assert!(state.db.folders().unwrap()["folders"]
        .as_array()
        .unwrap()
        .is_empty());
}

#[cfg(unix)]
#[tokio::test]
async fn startup_removes_stale_credentials_and_reports_bind_failure_to_settings() {
    let root = tempfile::tempdir().unwrap();
    let (state, app) = fixture(root.path());
    std::fs::write(root.path().join("mcp.json"), b"stale credentials").unwrap();
    start_with_environment(state.clone(), app.handle().clone(), Environment::default()).unwrap();
    assert!(!root.path().join("mcp.json").exists());
    assert!(!app.state::<Arc<Control>>().status().unwrap().running);
    let busy = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let preferences = McpSettings {
        scope: McpScope::Local,
        enabled: true,
        port: busy.local_addr().unwrap().port(),
    };
    write_private(
        &root.path().join("mcp-settings.json"),
        &serde_json::to_vec(&preferences).unwrap(),
    )
    .unwrap();
    drop(app);
    drop(state);
    let (state, app) = fixture(root.path());
    assert!(
        start_with_environment(state.clone(), app.handle().clone(), Environment::default())
            .is_err()
    );
    let control = app.state::<Arc<Control>>();
    let status = control.status().unwrap();
    assert!(status.enabled && !status.running && status.error.is_some());
    control
        .apply(
            state.clone(),
            app.handle().clone(),
            McpSettings {
                scope: McpScope::Local,
                enabled: true,
                port: 0,
            },
            true,
        )
        .unwrap();
    assert!(control.status().unwrap().running && control.status().unwrap().error.is_none());
    let server = control.current.lock().unwrap().server.clone().unwrap();
    stop(app.handle());
    server.wait_closed().await;
    assert!(control
        .apply(
            state,
            app.handle().clone(),
            McpSettings {
                scope: McpScope::Local,
                enabled: true,
                port: 0
            },
            true
        )
        .is_err());
}

#[cfg(unix)]
#[tokio::test]
async fn disabling_mcp_rejects_an_authenticated_request_waiting_for_its_body() {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    let root = tempfile::tempdir().unwrap();
    let (state, app) = fixture(root.path());
    let control = Control::new(root.path().into(), Environment::default());
    control
        .apply(
            state.clone(),
            app.handle().clone(),
            McpSettings {
                scope: McpScope::Local,
                enabled: true,
                port: 0,
            },
            true,
        )
        .unwrap();
    let info: ConnectionInfo =
        serde_json::from_slice(&std::fs::read(root.path().join("mcp.json")).unwrap()).unwrap();
    let url = reqwest::Url::parse(&info.url).unwrap();
    let authority = format!("127.0.0.1:{}", url.port().unwrap());
    let body = serde_json::json!({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"save_folder","arguments":{"name":"must-not-be-created"}}}).to_string();
    let socket = tokio::net::TcpStream::connect(&authority).await.unwrap();
    let (reader, mut writer) = socket.into_split();
    let mut reader = BufReader::new(reader);
    writer.write_all(format!("POST /mcp HTTP/1.1\r\nHost: {authority}\r\nAuthorization: Bearer {}\r\nAccept: application/json, text/event-stream\r\nContent-Type: application/json\r\nMCP-Protocol-Version: 2025-11-25\r\nContent-Length: {}\r\nExpect: 100-continue\r\n\r\n", info.token, body.len()).as_bytes()).await.unwrap();
    // Hyper emits 100 Continue only after authentication admits the request and
    // the handler starts polling its body. This avoids a timing-dependent sleep.
    let mut interim = String::new();
    tokio::time::timeout(Duration::from_secs(3), reader.read_line(&mut interim))
        .await
        .unwrap()
        .unwrap();
    assert!(interim.contains("100 Continue"), "{interim}");
    let mut empty = String::new();
    reader.read_line(&mut empty).await.unwrap();
    assert_eq!(empty, "\r\n");
    let server = control.current.lock().unwrap().server.clone().unwrap();
    server.stop();
    let _ = writer.write_all(body.as_bytes()).await;
    let mut response = String::new();
    tokio::time::timeout(Duration::from_secs(3), reader.read_line(&mut response))
        .await
        .unwrap()
        .unwrap();
    assert!(response.contains("503 Service Unavailable"), "{response}");
    server.wait_closed().await;
    assert!(state.db.folders().unwrap()["folders"]
        .as_array()
        .unwrap()
        .is_empty());
}

#[cfg(unix)]
#[tokio::test]
async fn successful_port_change_preserves_new_credentials_after_old_server_finishes() {
    let root = tempfile::tempdir().unwrap();
    let (state, app) = fixture(root.path());
    let control = Control::new(root.path().into(), Environment::default());
    control
        .apply(
            state.clone(),
            app.handle().clone(),
            McpSettings {
                scope: McpScope::Local,
                enabled: true,
                port: 0,
            },
            true,
        )
        .unwrap();
    let old_url = control.status().unwrap().url.unwrap();
    let reservation = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let port = reservation.local_addr().unwrap().port();
    drop(reservation);
    let previous = control
        .apply(
            state,
            app.handle().clone(),
            McpSettings {
                scope: McpScope::Local,
                enabled: true,
                port,
            },
            true,
        )
        .unwrap()
        .unwrap();
    previous.wait_closed().await;
    let status = control.status().unwrap();
    let info: ConnectionInfo =
        serde_json::from_slice(&std::fs::read(root.path().join("mcp.json")).unwrap()).unwrap();
    assert_eq!(status.url.as_deref(), Some(info.url.as_str()));
    assert_ne!(info.url, old_url);
    assert_eq!(status.port, port);
    assert!(control.http_connection(&old_url).is_err());
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let response = client.post(&info.url).bearer_auth(&info.token)
        .header("Accept", "application/json, text/event-stream")
        .json(&serde_json::json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"port-change-test","version":"1"}}}))
        .send().await.unwrap();
    assert!(response.status().is_success());
    let server = control.current.lock().unwrap().server.clone().unwrap();
    server.stop();
    server.wait_closed().await;
}

#[test]
fn legacy_preferences_stay_local_and_generated_token_is_private_and_stable() {
    let legacy: McpSettings = serde_json::from_str(r#"{"enabled":true,"port":0}"#).unwrap();
    assert_eq!(legacy.scope, McpScope::Local);
    assert_eq!(legacy.port, 0);
    let root = tempfile::tempdir().unwrap();
    let token = Environment::default().token(root.path()).unwrap();
    assert_eq!(Environment::default().token(root.path()).unwrap(), token);
    let override_token = "override-012345678901234567890123456789";
    assert_eq!(
        Environment {
            port: None,
            token: Some(override_token.into())
        }
        .token(root.path())
        .unwrap(),
        override_token
    );
    assert_eq!(
        std::fs::read_to_string(root.path().join("mcp-token")).unwrap(),
        token
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(root.path().join("mcp-token"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
}

#[cfg(unix)]
fn lan_address() -> Option<Ipv4Addr> {
    authorities(McpScope::Network, 1)
        .into_iter()
        .find_map(|authority| {
            let address: std::net::SocketAddrV4 = authority.parse().ok()?;
            (!address.ip().is_loopback()).then_some(*address.ip())
        })
}

#[cfg(unix)]
fn initialize_request(client: &reqwest::Client, url: &str, token: &str) -> reqwest::RequestBuilder {
    client.post(url).bearer_auth(token).header("Accept", "application/json, text/event-stream")
        .json(&serde_json::json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"lan-test","version":"1"}}}))
}

#[cfg(unix)]
#[tokio::test]
async fn network_scope_rebinds_fixed_port_and_authenticates_real_lan_requests() {
    let Some(lan) = lan_address() else {
        eprintln!("No non-loopback IPv4 interface on this runner");
        return;
    };
    let root = tempfile::tempdir().unwrap();
    let (state, app) = fixture(root.path());
    let control = Arc::new(Control::new(root.path().into(), Environment::default()));
    let local = McpSettings {
        enabled: true,
        port: 0,
        scope: McpScope::Local,
    };
    let status = control
        .configure(state.clone(), app.handle().clone(), local)
        .await
        .unwrap();
    let local_url = status.url.unwrap();
    let port = reqwest::Url::parse(&local_url).unwrap().port().unwrap();
    let lan_url = format!("http://{lan}:{port}/mcp");
    let connection = control.http_connection(&local_url).unwrap();
    let token = connection.token.clone();
    let config: serde_json::Value = serde_json::from_str(&connection.client_config).unwrap();
    assert_eq!(config["mcpServers"]["music-generator"]["url"], local_url);
    assert!(config["mcpServers"]["music-generator"]
        .get("command")
        .is_none());
    assert!(control.http_connection(&lan_url).is_err());
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(2))
        .build()
        .unwrap();
    assert!(initialize_request(&client, &lan_url, &token)
        .send()
        .await
        .is_err());
    assert!(initialize_request(&client, &local_url, &token)
        .send()
        .await
        .unwrap()
        .status()
        .is_success());
    let network = McpSettings {
        enabled: true,
        port,
        scope: McpScope::Network,
    };
    let status = control
        .configure(state.clone(), app.handle().clone(), network)
        .await
        .unwrap();
    assert_eq!(status.scope, McpScope::Network);
    assert_eq!(
        Control::new(root.path().into(), Environment::default())
            .current
            .lock()
            .unwrap()
            .settings,
        network
    );
    assert!(status.urls.contains(&lan_url));
    assert!(status.urls.iter().all(|url| !url.contains("0.0.0.0")));
    assert!(!serde_json::to_string(&status).unwrap().contains(&token));
    let connection = control.http_connection(&lan_url).unwrap();
    assert_eq!(connection.token, token);
    assert!(initialize_request(&client, &lan_url, &token)
        .send()
        .await
        .unwrap()
        .status()
        .is_success());
    assert_eq!(
        initialize_request(&client, &lan_url, "wrong")
            .send()
            .await
            .unwrap()
            .status(),
        reqwest::StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        initialize_request(&client, &lan_url, &token)
            .header("Host", "foreign.invalid")
            .send()
            .await
            .unwrap()
            .status(),
        reqwest::StatusCode::FORBIDDEN
    );
    assert_eq!(
        initialize_request(&client, &lan_url, &token)
            .header("Origin", "http://untrusted.invalid")
            .send()
            .await
            .unwrap()
            .status(),
        reqwest::StatusCode::FORBIDDEN
    );
    let status = control
        .configure(
            state.clone(),
            app.handle().clone(),
            McpSettings {
                scope: McpScope::Local,
                ..network
            },
        )
        .await
        .unwrap();
    assert_eq!(status.urls, vec![local_url.clone()]);
    assert!(control.http_connection(&lan_url).is_err());
    assert!(initialize_request(&client, &lan_url, &token)
        .send()
        .await
        .is_err());
    assert!(initialize_request(&client, &local_url, &token)
        .send()
        .await
        .unwrap()
        .status()
        .is_success());
    control
        .configure(state, app.handle().clone(), McpSettings::default())
        .await
        .unwrap();
    assert!(control.http_connection(&local_url).is_err());
    assert!(initialize_request(&client, &local_url, &token)
        .send()
        .await
        .is_err());
    assert!(!root.path().join("mcp.json").exists());
}

#[cfg(unix)]
#[tokio::test]
async fn failed_scope_widening_restores_previous_listener_settings_and_token() {
    let Some(lan) = lan_address() else {
        eprintln!("No non-loopback IPv4 interface on this runner");
        return;
    };
    let root = tempfile::tempdir().unwrap();
    let (state, app) = fixture(root.path());
    let control = Arc::new(Control::new(root.path().into(), Environment::default()));
    let local = McpSettings {
        enabled: true,
        port: 0,
        scope: McpScope::Local,
    };
    let status = control
        .configure(state.clone(), app.handle().clone(), local)
        .await
        .unwrap();
    let url = status.url.unwrap();
    let connection = control.http_connection(&url).unwrap();
    let port = reqwest::Url::parse(&url).unwrap().port().unwrap();
    // Another service on this interface allows local operation but prevents a wildcard bind.
    let _busy = TcpListener::bind((lan, port)).unwrap();
    let saved = std::fs::read(root.path().join("mcp-settings.json")).unwrap();
    assert!(control
        .configure(
            state.clone(),
            app.handle().clone(),
            McpSettings {
                enabled: true,
                port,
                scope: McpScope::Network
            }
        )
        .await
        .is_err());
    let status = control.status().unwrap();
    assert!(status.running);
    assert_eq!(status.scope, McpScope::Local);
    assert_eq!(status.port, 0);
    assert_eq!(status.url.as_deref(), Some(url.as_str()));
    assert_eq!(
        std::fs::read(root.path().join("mcp-settings.json")).unwrap(),
        saved
    );
    assert_eq!(
        control.http_connection(&url).unwrap().token,
        connection.token
    );
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    assert!(initialize_request(&client, &url, &connection.token)
        .send()
        .await
        .unwrap()
        .status()
        .is_success());
    control
        .configure(state, app.handle().clone(), McpSettings::default())
        .await
        .unwrap();
}
