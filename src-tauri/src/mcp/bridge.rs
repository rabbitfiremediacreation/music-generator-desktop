//! Stdio adapter for clients without Streamable HTTP support; never opens the library.
use super::transport::{validate_token, ConnectionInfo, MAX_REQUEST_BYTES};
use crate::error::{message, Result};
use serde_json::{json, Value};
use std::{path::Path, sync::Arc, time::Duration};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{Mutex, Semaphore};

#[path = "bridge_headers.rs"]
mod headers;

const MAX_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
type Output = Arc<Mutex<tokio::io::Stdout>>;

/// Handle the adapter before GUI startup so it cannot create a second application runtime.
pub fn cli() -> Option<i32> {
    let arguments: Vec<_> = std::env::args_os().collect();
    if arguments.get(1).and_then(|value| value.to_str()) != Some("--mcp-stdio") {
        return None;
    }
    let result = (|| -> Result<()> {
        if arguments.len() != 3 {
            return Err(message(
                "Usage: music-generator --mcp-stdio /absolute/path/to/mcp.json",
            ));
        }
        let path = Path::new(&arguments[2]);
        if !path.is_absolute() {
            return Err(message("The MCP connection file path must be absolute"));
        }
        let info = read_connection(path)?;
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()?
            .block_on(run(info))
    })();
    match result {
        Ok(()) => Some(0),
        Err(error) => {
            eprintln!("Music Generator MCP: {error}");
            Some(1)
        }
    }
}

fn read_connection(path: &Path) -> Result<ConnectionInfo> {
    use std::io::Read;
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .map_err(|_| message("Cannot read MCP connection file. Start the desktop app with MUSIC_GENERATOR_MCP_PORT=0 first."))?
        .take(64 * 1024 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > 64 * 1024 {
        return Err(message("MCP connection file is too large"));
    }
    let info: ConnectionInfo = serde_json::from_slice(&bytes)?;
    validate_connection(&info)?;
    Ok(info)
}

fn validate_connection(info: &ConnectionInfo) -> Result<()> {
    let url = reqwest::Url::parse(&info.url).map_err(|_| message("Invalid MCP endpoint"))?;
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port_or_known_default().is_none_or(|port| port == 0)
        || url.path() != "/mcp"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(message(
            "MCP connection must target http://127.0.0.1:PORT/mcp",
        ));
    }
    validate_token(&info.token)
}

async fn run(info: ConnectionInfo) -> Result<()> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(600))
        .build()?;
    let output: Output = Arc::new(Mutex::new(tokio::io::stdout()));
    let mut input = BufReader::new(tokio::io::stdin());
    let mut pending = Vec::new();
    let mut tasks = tokio::task::JoinSet::new();
    let permits = Arc::new(Semaphore::new(32));
    let version = Arc::new(Mutex::new(String::from("2025-03-26")));
    loop {
        let line = tokio::select! {
            line = read_line(&mut input, &mut pending) => line?,
            finished = tasks.join_next(), if !tasks.is_empty() => {
                finished.unwrap().map_err(|error| message(error.to_string()))??;
                continue;
            }
        };
        let Some(line) = line else { break };
        if line.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        let request: Value = match serde_json::from_slice(&line) {
            Ok(value) => value,
            Err(_) => {
                write_message(&output, &json!({"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error"}})).await?;
                continue;
            }
        };
        let initialization = request["method"] == "initialize";
        let client = client.clone();
        let info = info.clone();
        let output = output.clone();
        let version = version.clone();
        let permit = permits
            .clone()
            .acquire_owned()
            .await
            .map_err(|error| message(error.to_string()))?;
        let task = async move {
            let _permit = permit;
            let protocol = request
                .pointer("/params/_meta/io.modelcontextprotocol~1protocolVersion")
                .or_else(|| request.pointer("/_meta/io.modelcontextprotocol~1protocolVersion"))
                .and_then(Value::as_str)
                .map(str::to_owned)
                .unwrap_or(version.lock().await.clone());
            match forward(&client, &info, &request, &protocol).await {
                Ok(messages) => {
                    for response in messages {
                        if initialization {
                            if let Some(negotiated) = response
                                .pointer("/result/protocolVersion")
                                .and_then(Value::as_str)
                            {
                                *version.lock().await = negotiated.to_owned();
                            }
                        }
                        write_message(&output, &response).await?;
                    }
                }
                Err(error) => {
                    if let Some(id) = request.get("id") {
                        write_message(&output, &json!({"jsonrpc":"2.0","id":id,"error":{"code":-32000,"message":format!("{error}. Inspect application state before retrying a mutation.")}})).await?;
                    } else {
                        eprintln!("Music Generator MCP notification failed: {error}");
                    }
                }
            }
            Ok::<_, crate::error::Error>(())
        };
        if initialization {
            task.await?;
        } else {
            tasks.spawn(task);
        }
    }
    // EOF ends this connection, not the desktop or its already accepted durable jobs.
    tasks.abort_all();
    Ok(())
}

async fn read_line<R: AsyncBufRead + Unpin>(
    input: &mut R,
    line: &mut Vec<u8>,
) -> Result<Option<Vec<u8>>> {
    loop {
        let available = input.fill_buf().await?;
        if available.is_empty() {
            return Ok((!line.is_empty()).then(|| std::mem::take(line)));
        }
        let length = available
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(available.len(), |index| index + 1);
        if line.len() + length > MAX_REQUEST_BYTES {
            return Err(message("MCP input exceeds the 1 MiB request limit"));
        }
        let complete = available[length - 1] == b'\n';
        line.extend_from_slice(&available[..length]);
        input.consume(length);
        if complete {
            return Ok(Some(std::mem::take(line)));
        }
    }
}

async fn write_message(output: &Output, value: &Value) -> Result<()> {
    let mut bytes = serde_json::to_vec(value)?;
    bytes.push(b'\n');
    let mut output = output.lock().await;
    output.write_all(&bytes).await?;
    output.flush().await?;
    Ok(())
}

async fn forward(
    client: &reqwest::Client,
    info: &ConnectionInfo,
    request: &Value,
    version: &str,
) -> Result<Vec<Value>> {
    let builder = client
        .post(&info.url)
        .bearer_auth(&info.token)
        .header(
            reqwest::header::ACCEPT,
            "application/json, text/event-stream",
        )
        .header("MCP-Protocol-Version", version);
    let mut response = headers::routing(builder, request)
        .json(request)
        .send()
        .await?;
    if response.status() == reqwest::StatusCode::ACCEPTED
        || response.status() == reqwest::StatusCode::NO_CONTENT
    {
        return Ok(Vec::new());
    }
    let status = response.status();
    let sse = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.starts_with("text/event-stream"));
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if bytes.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err(message(
                "MCP response exceeds 16 MiB; request a smaller page",
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    if !status.is_success() {
        if let Ok(error) = serde_json::from_slice::<Value>(&bytes) {
            if error.get("error").is_some() {
                return Ok(vec![error]);
            }
        }
        return Err(message(format!("MCP endpoint returned HTTP {}. Check that the desktop is running and the connection file is current", status.as_u16())));
    }
    if sse {
        parse_events(&bytes)
    } else {
        Ok(vec![serde_json::from_slice(&bytes)?])
    }
}

fn parse_events(bytes: &[u8]) -> Result<Vec<Value>> {
    let text = std::str::from_utf8(bytes).map_err(|_| message("Invalid MCP response text"))?;
    let mut messages = Vec::new();
    let mut data = String::new();
    for line in text.lines().chain(std::iter::once("")) {
        if line.is_empty() && !data.is_empty() {
            messages.push(serde_json::from_str(&data)?);
            data.clear();
        } else if let Some(value) = line.strip_prefix("data:") {
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(value.strip_prefix(' ').unwrap_or(value));
        }
    }
    Ok(messages)
}

#[cfg(test)]
#[path = "bridge_tests.rs"]
mod tests;
