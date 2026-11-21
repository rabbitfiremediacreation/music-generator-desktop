//! Desktop-only access token, separate from settings exposed over IPC or remote APIs.
use crate::{
    error::{message, Result},
    paths::write_private,
};
use reqwest::{Client, RequestBuilder, Url};
use std::{fs, io::ErrorKind, path::Path};

const MAX_LENGTH: usize = 256;
const FILE: &str = "hugging-face-token";

fn valid(token: &str) -> bool {
    !token.is_empty()
        && token.len() <= MAX_LENGTH
        && token
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn load(root: &Path) -> Result<Option<String>> {
    match fs::read_to_string(root.join(FILE)) {
        Ok(token) if valid(&token) => Ok(Some(token)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        _ => Err(message("hf_token_read_failed")),
    }
}

pub(crate) fn configured(root: &Path) -> Result<bool> {
    Ok(load(root)?.is_some())
}

pub(crate) fn set(root: &Path, token: Option<&str>) -> Result<bool> {
    let path = root.join(FILE);
    if let Some(token) = token.map(str::trim) {
        if !valid(token) {
            return Err(message("hf_token_invalid"));
        }
        write_private(&path, token.as_bytes()).map_err(|_| message("hf_token_write_failed"))?;
        Ok(true)
    } else {
        match fs::remove_file(path) {
            Ok(()) => Ok(false),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
            Err(_) => Err(message("hf_token_write_failed")),
        }
    }
}

pub(crate) fn get(client: &Client, url: &str, root: &Path) -> Result<RequestBuilder> {
    let request = client.get(url);
    if !Url::parse(url).is_ok_and(|url| is_hub(&url)) {
        return Ok(request);
    }
    // Reqwest removes Authorization when a redirect changes host or port.
    Ok(match load(root)? {
        Some(token) => request.bearer_auth(token),
        None => request,
    })
}

pub(crate) fn is_hub(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some("huggingface.co")
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::AUTHORIZATION;

    #[test]
    fn stores_replaces_and_removes_the_token() {
        let root = tempfile::tempdir().unwrap();
        let root = root.path();
        assert!(!configured(root).unwrap());
        assert!(set(root, Some(" hf_first-example ")).unwrap());
        assert!(configured(root).unwrap());
        assert_eq!(load(root).unwrap().as_deref(), Some("hf_first-example"));
        assert!(set(root, Some("hf_invalid\r\nInjected")).is_err());
        assert_eq!(load(root).unwrap().as_deref(), Some("hf_first-example"));
        assert!(set(root, Some("hf_second-example")).unwrap());
        assert_eq!(load(root).unwrap().as_deref(), Some("hf_second-example"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(root.join(FILE)).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        assert!(!set(root, None).unwrap());
        assert!(!set(root, None).unwrap());
        assert!(!configured(root).unwrap());
    }

    #[test]
    fn authenticates_only_requests_to_the_https_hub_origin() {
        let root = tempfile::tempdir().unwrap();
        let client = Client::new();
        let url = "https://huggingface.co/owner/repo/resolve/rev/model.gguf";
        let request = |url| get(&client, url, root.path()).unwrap().build().unwrap();
        assert!(!request(url).headers().contains_key(AUTHORIZATION));
        set(root.path(), Some("hf_test-example")).unwrap();
        let trusted = request(url);
        let token = &trusted.headers()[AUTHORIZATION];
        assert_eq!(token, "Bearer hf_test-example");
        assert!(token.is_sensitive());
        for url in [
            "http://huggingface.co:443/owner/repo",
            "https://huggingface.co:444/owner/repo",
            "https://huggingface.co.example.com/owner/repo",
            "https://cdn-lfs.huggingface.co/model.gguf",
            "https://github.com/owner/repo/releases/download/rev/model.gguf",
        ] {
            assert!(!request(url).headers().contains_key(AUTHORIZATION), "{url}");
        }
        // Reqwest may send basic auth from URL userinfo; the saved bearer token must stay local.
        assert_ne!(
            request("https://huggingface.co@example.com/owner/repo")
                .headers()
                .get(AUTHORIZATION),
            Some(token)
        );
    }
}
