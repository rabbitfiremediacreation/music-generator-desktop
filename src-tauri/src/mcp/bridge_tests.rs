use super::*;

#[test]
fn connection_file_cannot_redirect_bearer_token_outside_the_local_server() {
    for url in [
        "https://example.com/mcp",
        "http://localhost:1234/mcp",
        "http://127.0.0.1:1234/other",
        "http://user@127.0.0.1:1234/mcp",
        "http://127.0.0.1:1234/mcp?token=secret",
    ] {
        assert!(validate_connection(&ConnectionInfo {
            url: url.into(),
            token: "a".repeat(64),
            pid: 1
        })
        .is_err());
    }
    assert!(validate_connection(&ConnectionInfo {
        url: "http://127.0.0.1:1234/mcp".into(),
        token: "a".repeat(64),
        pid: 1
    })
    .is_ok());
}

#[tokio::test]
async fn input_is_line_framed_bounded_and_handles_eof() {
    let mut input = BufReader::new(&b"one\ntwo"[..]);
    let mut pending = Vec::new();
    assert_eq!(
        read_line(&mut input, &mut pending).await.unwrap(),
        Some(b"one\n".to_vec())
    );
    assert_eq!(
        read_line(&mut input, &mut pending).await.unwrap(),
        Some(b"two".to_vec())
    );
    assert_eq!(read_line(&mut input, &mut pending).await.unwrap(), None);
    let large = vec![b'a'; MAX_REQUEST_BYTES + 1];
    assert!(
        read_line(&mut BufReader::new(large.as_slice()), &mut pending)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn partially_read_lines_survive_select_cancellation() {
    let (mut writer, reader) = tokio::io::duplex(128);
    let mut input = BufReader::new(reader);
    let mut pending = Vec::new();
    writer.write_all(b"{\"jsonrpc\"").await.unwrap();
    assert!(tokio::time::timeout(
        Duration::from_millis(5),
        read_line(&mut input, &mut pending)
    )
    .await
    .is_err());
    writer.write_all(b":\"2.0\"}\n").await.unwrap();
    assert_eq!(
        read_line(&mut input, &mut pending).await.unwrap(),
        Some(b"{\"jsonrpc\":\"2.0\"}\n".to_vec())
    );
}

#[test]
fn event_stream_preserves_notifications_and_response() {
    let events = b": ping\r\nevent: message\r\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\"}\r\n\r\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n\n";
    let messages = parse_events(events).unwrap();
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0]["method"], "notifications/progress");
    assert_eq!(messages[1]["id"], 1);
}
