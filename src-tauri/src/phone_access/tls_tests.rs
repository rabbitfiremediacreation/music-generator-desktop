use super::*;
use crate::{db::Database, phone_access, state::AppState};
use std::time::Duration;
use tokio::net::{TcpListener, TcpStream};

fn state(root: &Path) -> Arc<AppState> {
    Arc::new(AppState::new(
        Database::open(root).unwrap(),
        root.join("resources"),
    ))
}

pub(super) fn trusted_client(state: &AppState) -> reqwest::Client {
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(2))
        .tls_built_in_root_certs(false)
        .add_root_certificate(
            reqwest::Certificate::from_der(&phone_access::certificate(state).unwrap()).unwrap(),
        )
        .build()
        .unwrap()
}

#[tokio::test]
async fn https_requires_trust_and_the_current_key_and_stops_with_http() {
    let root = tempfile::tempdir().unwrap();
    let state = state(root.path());
    let status = phone_access::set(&state, Arc::new(|| {}), Some(true), false, 0)
        .await
        .unwrap();
    assert!(status.enabled);
    assert_ne!(status.web_port, status.port);
    assert!(status
        .web_addresses
        .iter()
        .all(|address| address.starts_with("https://") && address.ends_with("/mobile/")));
    let url = format!("https://localhost:{}/api/queue", status.web_port);
    let untrusted = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(2))
        .build()
        .unwrap();
    assert!(
        untrusted.get(&url).send().await.is_err(),
        "untrusted local CA must not be silently accepted"
    );
    let http_url = format!("http://127.0.0.1:{}/api/queue", status.port);
    assert_eq!(untrusted.get(&http_url).send().await.unwrap().status(), 404);
    let wrong_host = reqwest::Client::builder()
        .no_proxy()
        .resolve(
            "other.invalid",
            format!("127.0.0.1:{}", status.web_port).parse().unwrap(),
        )
        .tls_built_in_root_certs(false)
        .add_root_certificate(
            reqwest::Certificate::from_der(&certificate(&state).unwrap()).unwrap(),
        )
        .build()
        .unwrap();
    assert!(wrong_host
        .get(format!(
            "https://other.invalid:{}/api/queue",
            status.web_port
        ))
        .send()
        .await
        .is_err());
    let trusted = trusted_client(&state);
    assert_eq!(trusted.get(&url).send().await.unwrap().status(), 401);
    assert_eq!(
        trusted
            .get(&url)
            .bearer_auth("wrong")
            .send()
            .await
            .unwrap()
            .status(),
        401
    );
    assert_eq!(
        trusted
            .get(&url)
            .bearer_auth(&status.token)
            .send()
            .await
            .unwrap()
            .status(),
        200
    );

    // One client never sends a TLS ClientHello; other clients must still connect.
    let mut stalled = TcpStream::connect(("127.0.0.1", status.web_port))
        .await
        .unwrap();
    assert_eq!(
        trusted
            .get(&url)
            .bearer_auth(&status.token)
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    let off = tokio::time::timeout(
        Duration::from_secs(2),
        phone_access::set(&state, Arc::new(|| {}), Some(false), false, 0),
    )
    .await
    .expect("a stalled handshake must not delay switching off")
    .unwrap();
    assert!(!off.enabled);
    assert!(trusted
        .get(&url)
        .bearer_auth(&status.token)
        .send()
        .await
        .is_err());
    assert!(TcpStream::connect(("127.0.0.1", status.port))
        .await
        .is_err());
    let mut byte = [0];
    let closed = tokio::time::timeout(Duration::from_secs(2), stalled.read(&mut byte))
        .await
        .unwrap();
    assert!(matches!(closed, Ok(0) | Err(_)));
}

#[tokio::test]
async fn ca_and_fingerprint_persist_across_enabling_and_leaf_refresh() {
    let root = tempfile::tempdir().unwrap();
    let state = state(root.path());
    let first = phone_access::set(&state, Arc::new(|| {}), Some(true), false, 0)
        .await
        .unwrap();
    let certificate = phone_access::certificate(&state).unwrap();
    assert_eq!(
        first.certificate_fingerprint.as_deref(),
        Some(lan_tls::fingerprint(&certificate).as_str())
    );
    state.phone_access.stop().await;
    let refreshed = lan_tls::prepare(
        &root.path().join(TLS_FOLDER),
        ["studio-renamed.local".into(), "192.168.2.10".into()],
    )
    .unwrap();
    assert_eq!(Some(refreshed.fingerprint), first.certificate_fingerprint);
    assert_eq!(phone_access::certificate(&state).unwrap(), certificate);
    let second = phone_access::set(&state, Arc::new(|| {}), Some(true), false, 0)
        .await
        .unwrap();
    let url = format!("https://localhost:{}/api/queue", second.web_port);
    assert_eq!(
        trusted_client(&state)
            .get(url)
            .bearer_auth(second.token)
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    state.phone_access.stop().await;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(root.path().join(TLS_FOLDER).join("authority-key.pem"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        assert_eq!(
            std::fs::metadata(root.path().join(TLS_FOLDER))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
    }
}

#[tokio::test]
async fn occupied_https_port_does_not_leave_http_access_enabled() {
    let root = tempfile::tempdir().unwrap();
    let state = state(root.path());
    let reserved = std::net::TcpListener::bind(("0.0.0.0", 0)).unwrap();
    let http_port = reserved.local_addr().unwrap().port();
    drop(reserved);
    let occupied = TcpListener::bind(("0.0.0.0", 0)).await.unwrap();
    let error = state
        .phone_access
        .start_with_ports(
            state.clone(),
            Arc::new(|| {}),
            http_port,
            occupied.local_addr().unwrap().port(),
        )
        .await
        .unwrap_err();
    assert_eq!(error.to_string(), "phone_access_https_port_busy");
    assert_eq!(state.phone_access.port().await, None);
    assert!(!phone_access::enabled(&state).unwrap());
    assert!(TcpListener::bind(("0.0.0.0", http_port)).await.is_ok());
}

#[test]
fn corrupt_ca_is_reported_without_replacing_the_installed_identity() {
    let root = tempfile::tempdir().unwrap();
    let folder = root.path().join(TLS_FOLDER);
    lan_tls::prepare(&folder, ["localhost".into()]).unwrap();
    let original = std::fs::read(lan_tls::certificate_path(&folder)).unwrap();
    std::fs::write(
        root.path().join(TLS_FOLDER).join("authority-key.pem"),
        "broken key",
    )
    .unwrap();
    assert!(lan_tls::prepare(&folder, ["localhost".into()]).is_err());
    assert_eq!(
        std::fs::read(lan_tls::certificate_path(&folder)).unwrap(),
        original
    );
}
