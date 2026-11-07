//! Public app shell only. Every library, audio and mutation request still goes
//! through the separate authenticated API router.
use super::Remote;
use axum::{
    body::Body,
    http::{header, StatusCode, Uri},
    response::{Redirect, Response},
    routing::get,
    Router,
};

struct Asset {
    path: &'static str,
    content_type: &'static str,
    bytes: &'static [u8],
    immutable: bool,
}

include!(concat!(env!("OUT_DIR"), "/mobile_assets.rs"));

pub(super) fn routes() -> Router<Remote> {
    Router::new()
        .route("/mobile", get(|| async { Redirect::permanent("/mobile/") }))
        .route("/mobile/", get(asset))
        .route("/mobile/{*path}", get(asset))
}

async fn asset(uri: Uri) -> Response {
    response(uri.path())
}

fn response(path: &str) -> Response {
    let Some(path) = path.strip_prefix("/mobile/") else {
        return missing();
    };
    let path = if path.is_empty() { "index.html" } else { path };
    // Encoded or normalized traversal is never resolved against the filesystem.
    if path.contains(['%', '\\'])
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return missing();
    }
    let Some(asset) = ASSETS.iter().find(|asset| asset.path == path) else {
        return missing();
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, asset.content_type)
        .header(header::CONTENT_LENGTH, asset.bytes.len())
        .header(
            header::CACHE_CONTROL,
            if asset.immutable { "public, max-age=31536000, immutable" } else { "no-store" },
        )
        .header(header::REFERRER_POLICY, "no-referrer")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CONTENT_SECURITY_POLICY, "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
        .body(Body::from(asset.bytes))
        .unwrap_or_default()
}

fn missing() -> Response {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::REFERRER_POLICY, "no-referrer")
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .body(Body::empty())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_embedded_mobile_assets_are_available() {
        assert_eq!(response("/mobile/").status(), StatusCode::OK);
        assert_eq!(response("/mobile/index.html").status(), StatusCode::OK);
        for path in [
            "/",
            "/mobile/../index.html",
            "/mobile/%2e%2e/index.html",
            "/mobile/%69ndex.html",
            "/mobile//index.html",
            "/mobile/./index.html",
            "/mobile/unknown",
            "/mobile/../../src-tauri/Cargo.toml",
            "/mobile/engine/ace-server",
            "/api/songs",
        ] {
            assert_eq!(response(path).status(), StatusCode::NOT_FOUND, "{path}");
        }
        assert!(ASSETS
            .iter()
            .all(|asset| !asset.path.contains("..") && !asset.path.starts_with('/')));
    }

    #[test]
    fn shell_manifest_worker_and_assets_have_safe_headers() {
        let shell = response("/mobile/");
        assert_eq!(
            shell.headers()[header::CONTENT_TYPE],
            "text/html; charset=utf-8"
        );
        assert_eq!(shell.headers()[header::CACHE_CONTROL], "no-store");
        assert_eq!(shell.headers()[header::REFERRER_POLICY], "no-referrer");
        assert_eq!(shell.headers()[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
        let csp = shell.headers()[header::CONTENT_SECURITY_POLICY]
            .to_str()
            .unwrap();
        assert!(csp.contains("script-src 'self'") && csp.contains("frame-ancestors 'none'"));
        assert!(!csp.contains("unsafe-inline"));
        let manifest = response("/mobile/manifest.webmanifest");
        assert_eq!(manifest.status(), StatusCode::OK);
        assert_eq!(
            manifest.headers()[header::CONTENT_TYPE],
            "application/manifest+json; charset=utf-8"
        );
        let worker = response("/mobile/sw.js");
        assert_eq!(worker.status(), StatusCode::OK);
        assert_eq!(worker.headers()[header::CACHE_CONTROL], "no-store");
        assert_eq!(
            worker.headers()[header::CONTENT_TYPE],
            "text/javascript; charset=utf-8"
        );
        let built = ASSETS
            .iter()
            .find(|asset| asset.path.starts_with("assets/"))
            .expect("mobile entry bundle");
        assert_eq!(
            response(&format!("/mobile/{}", built.path)).headers()[header::CACHE_CONTROL],
            "public, max-age=31536000, immutable"
        );
    }
}
