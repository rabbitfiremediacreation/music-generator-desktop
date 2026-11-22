use crate::{
    audio_import::MAX_AUDIO_BYTES,
    catalog::Selection,
    commands::analyze_audio,
    error::{message, Result},
    reference_audio::{stage_remix_upload, MAX_REMIX_BYTES},
    state::AppState,
};
use axum::extract::Query;
use serde::Deserialize;
use serde_json::Value;
use std::sync::Arc;
use tauri::{
    http::{header, HeaderValue, Method, Request, Response, StatusCode},
    Manager, UriSchemeContext, UriSchemeResponder,
};

#[derive(Deserialize)]
struct UploadMetadata {
    filename: String,
    selection: Option<String>,
}

fn allowed_origin(origin: &str, dev_url: Option<&tauri::Url>) -> bool {
    let app_origin = if cfg!(windows) {
        "http://tauri.localhost"
    } else {
        "tauri://localhost"
    };
    origin == app_origin
        || (cfg!(debug_assertions)
            && dev_url.is_some_and(|url| url.origin().ascii_serialization() == origin))
}

fn decode(request: Request<Vec<u8>>) -> Result<(UploadMetadata, Vec<u8>, Option<Selection>)> {
    let (limit, error) = match request.uri().path() {
        "/remix" => (MAX_REMIX_BYTES, "remix_source_size"),
        _ => (MAX_AUDIO_BYTES, "audio_size"),
    };
    if request.body().len() > limit {
        return Err(message(error));
    }
    let Query(metadata): Query<UploadMetadata> =
        Query::try_from_uri(request.uri()).map_err(|_| message("audio_read"))?;
    let selection = metadata
        .selection
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|_| message("audio_read"))?;
    Ok((metadata, request.into_body(), selection))
}

// A dedicated binary POST bypasses the invoke postMessage fallback, which JSON-encodes buffers.
pub(crate) fn handle(
    context: UriSchemeContext<'_, tauri::Wry>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = context.app_handle();
    let origin = request.headers().get(header::ORIGIN).filter(|origin| {
        origin
            .to_str()
            .is_ok_and(|origin| allowed_origin(origin, app.config().build.dev_url.as_ref()))
    });
    let Some(origin) = origin
        .cloned()
        .filter(|_| context.webview_label() == "main")
    else {
        responder.respond(
            Response::builder()
                .status(StatusCode::FORBIDDEN)
                .body(Vec::new())
                .unwrap(),
        );
        return;
    };
    if request.method() != Method::POST
        || !matches!(request.uri().path(), "/analyze" | "/remix" | "/stems")
    {
        respond(responder, origin, Err(message("audio_read")));
        return;
    }
    let state = app
        .try_state::<Arc<AppState>>()
        .map(|state| Arc::clone(&state));
    tauri::async_runtime::spawn(async move {
        let result = async {
            let route = request.uri().path().to_owned();
            let (metadata, data, selection) = decode(request)?;
            let state = state.ok_or_else(|| message("audio_read"))?;
            match route.as_str() {
                "/stems" => Ok(serde_json::to_value(
                    crate::stems::source::upload(&state, &metadata.filename, data).await?,
                )?),
                "/remix" => {
                    let reference = tauri::async_runtime::spawn_blocking(move || {
                        stage_remix_upload(&state.db.root, metadata.filename, &data)
                    })
                    .await
                    .map_err(|_| message("audio_read"))??;
                    Ok(serde_json::to_value(reference)?)
                }
                _ => analyze_audio(&state, data, metadata.filename, selection).await,
            }
        }
        .await;
        respond(responder, origin, result);
    });
}

fn respond(responder: UriSchemeResponder, origin: HeaderValue, result: Result<Value>) {
    let (status, body) = match result {
        Ok(value) => (StatusCode::OK, value.to_string()),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Value::String(error.to_string()).to_string(),
        ),
    };
    responder.respond(
        Response::builder()
            .status(status)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin)
            .header(header::CONTENT_TYPE, "application/json")
            .header(header::CACHE_CONTROL, "no-store")
            .body(body.into_bytes())
            .unwrap(),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_metadata_without_changing_the_audio_body() {
        let uri = "/analyze?filename=%E9%9B%A8+%26+Piano.wav&selection=%7B%22provider%22%3A%22local%22%2C%22synthesis%22%3A%22dit%22%2C%22language%22%3A%22lm%22%7D";
        let audio: Vec<u8> = (0..=255).cycle().take(8 * 1024 * 1024).collect();
        let request = Request::post(uri).body(audio.clone()).unwrap();
        let (metadata, bytes, selection) = decode(request).unwrap();
        assert_eq!(metadata.filename, "雨 & Piano.wav");
        assert_eq!(bytes, audio);
        let selection = selection.unwrap();
        assert_eq!(selection.provider, "local");
        assert_eq!(selection.synthesis, "dit");
        assert_eq!(selection.language, "lm");
    }

    #[test]
    fn enforces_the_size_limit_on_the_actual_request_body() {
        let request = Request::post("/analyze?filename=large.wav")
            .body(vec![0; MAX_AUDIO_BYTES + 1])
            .unwrap();
        assert_eq!(decode(request).err().unwrap().to_string(), "audio_size");
    }

    #[test]
    fn only_allows_the_desktop_origin_and_configured_dev_origin() {
        let dev_url = tauri::Url::parse("http://127.0.0.1:1420/index.html").unwrap();
        assert_eq!(
            allowed_origin("http://127.0.0.1:1420", Some(&dev_url)),
            cfg!(debug_assertions)
        );
        assert!(allowed_origin(
            if cfg!(windows) {
                "http://tauri.localhost"
            } else {
                "tauri://localhost"
            },
            None
        ));
        for origin in ["null", "https://example.com", "http://127.0.0.1:1421"] {
            assert!(!allowed_origin(origin, Some(&dev_url)));
        }
    }
}
