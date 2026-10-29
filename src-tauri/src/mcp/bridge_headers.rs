//! SEP-2243 routing headers required by the modern HTTP protocol.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::Value;

pub(super) fn routing(
    mut builder: reqwest::RequestBuilder,
    request: &Value,
) -> reqwest::RequestBuilder {
    let Some(method) = request.get("method").and_then(Value::as_str) else {
        return builder;
    };
    builder = builder.header("Mcp-Method", method);
    let key = match method {
        "tools/call" | "prompts/get" => "name",
        "resources/read" | "resources/subscribe" | "resources/unsubscribe" => "uri",
        "tasks/get" | "tasks/update" | "tasks/cancel" => "taskId",
        _ => return builder,
    };
    if let Some(name) = request["params"].get(key).and_then(Value::as_str) {
        builder = builder.header("Mcp-Name", encode(name));
    }
    builder
}

fn encode(value: &str) -> String {
    if value.trim() != value
        || value.bytes().any(|byte| !(0x20..=0x7e).contains(&byte))
        || (value.starts_with("=?base64?") && value.ends_with("?="))
    {
        format!("=?base64?{}?=", STANDARD.encode(value))
    } else {
        value.into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn routes_tool_resource_and_discovery_requests() {
        for (method, params, name) in [
            ("server/discover", json!({}), None),
            ("tools/call", json!({"name":"get_song"}), Some("get_song")),
            (
                "resources/read",
                json!({"uri":"music-generator://queue"}),
                Some("music-generator://queue"),
            ),
        ] {
            let request = routing(
                reqwest::Client::new().post("http://127.0.0.1:1234/mcp"),
                &json!({"method":method,"params":params}),
            )
            .build()
            .unwrap();
            assert_eq!(request.headers()["Mcp-Method"], method);
            assert_eq!(
                request
                    .headers()
                    .get("Mcp-Name")
                    .map(|header| header.to_str().unwrap()),
                name
            );
        }
    }

    #[test]
    fn encodes_names_that_cannot_roundtrip_as_plain_http_headers() {
        for name in [" Grüße ", "line\nbreak", "=?base64?dGVzdA==?="] {
            let header = encode(name);
            let encoded = header
                .strip_prefix("=?base64?")
                .unwrap()
                .strip_suffix("?=")
                .unwrap();
            assert_eq!(STANDARD.decode(encoded).unwrap(), name.as_bytes());
        }
        assert_eq!(encode("get_song"), "get_song");
    }
}
