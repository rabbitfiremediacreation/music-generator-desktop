//! Per-install local HTTPS identity and a bounded, cancellation-safe TLS listener.
use futures_util::{future::BoxFuture, stream::FuturesUnordered, FutureExt, StreamExt};
use rcgen::{
    BasicConstraints, CertificateParams, DnType, ExtendedKeyUsagePurpose, IsCa, KeyPair,
    KeyUsagePurpose,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{io, net::SocketAddr, path::Path, sync::Arc, time::Duration};
use time::OffsetDateTime;
use tokio::net::{TcpListener, TcpStream};
use tokio_rustls::{rustls, server::TlsStream, TlsAcceptor};

const FOLDER: &str = "phone-access-tls";
const CERTIFICATE: &str = "certificate.crt";
const KEY: &str = "authority-key.pem";
const IDENTITY: &str = "authority.json";
const MAX_HANDSHAKES: usize = 32;

#[derive(Deserialize, Serialize)]
struct Authority {
    name: String,
    serial: Vec<u8>,
    not_before: i64,
    not_after: i64,
    public_key_sha256: String,
    certificate_sha256: String,
}

pub(super) struct Identity {
    pub config: Arc<rustls::ServerConfig>,
    pub fingerprint: String,
}

fn invalid(error: impl std::fmt::Display) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, error.to_string())
}

fn fingerprint(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(":")
}

fn parameters(authority: &Authority) -> io::Result<CertificateParams> {
    let mut params = CertificateParams::default();
    params.distinguished_name = rcgen::DistinguishedName::new();
    params
        .distinguished_name
        .push(DnType::CommonName, &authority.name);
    params.is_ca = IsCa::Ca(BasicConstraints::Constrained(0));
    params.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign];
    params.serial_number = Some(authority.serial.clone().into());
    params.not_before =
        OffsetDateTime::from_unix_timestamp(authority.not_before).map_err(invalid)?;
    params.not_after = OffsetDateTime::from_unix_timestamp(authority.not_after).map_err(invalid)?;
    Ok(params)
}

fn private_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    use std::io::Write;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

fn authority(root: &Path) -> io::Result<(Authority, KeyPair, Vec<u8>)> {
    let folder = root.join(FOLDER);
    std::fs::create_dir_all(&folder)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&folder, std::fs::Permissions::from_mode(0o700))?;
    }
    let paths = [
        folder.join(IDENTITY),
        folder.join(KEY),
        folder.join(CERTIFICATE),
    ];
    if paths.iter().any(|path| path.exists()) {
        // Never silently replace a trusted CA when files are incomplete or corrupt.
        let authority: Authority =
            serde_json::from_slice(&std::fs::read(&paths[0])?).map_err(invalid)?;
        let key = KeyPair::from_pem(&std::fs::read_to_string(&paths[1])?).map_err(invalid)?;
        let certificate = std::fs::read(&paths[2])?;
        if fingerprint(&key.public_key_der()) != authority.public_key_sha256
            || fingerprint(&certificate) != authority.certificate_sha256
        {
            return Err(invalid("Local HTTPS certificate identity is inconsistent"));
        }
        if OffsetDateTime::now_utc().unix_timestamp() >= authority.not_after {
            return Err(invalid("Local HTTPS certificate authority has expired"));
        }
        return Ok((authority, key, certificate));
    }
    let key = KeyPair::generate().map_err(invalid)?;
    let now = OffsetDateTime::now_utc();
    let mut authority = Authority {
        name: format!(
            "Music Generator Local {}",
            &uuid::Uuid::new_v4().simple().to_string()[..8]
        ),
        serial: uuid::Uuid::new_v4().as_bytes().to_vec(),
        not_before: (now - time::Duration::days(1)).unix_timestamp(),
        not_after: (now + time::Duration::days(3650)).unix_timestamp(),
        public_key_sha256: fingerprint(&key.public_key_der()),
        certificate_sha256: String::new(),
    };
    let certificate = parameters(&authority)?.self_signed(&key).map_err(invalid)?;
    let der = certificate.der().to_vec();
    authority.certificate_sha256 = fingerprint(&der);
    private_write(&paths[0], &serde_json::to_vec(&authority).map_err(invalid)?)?;
    private_write(&paths[1], key.serialize_pem().as_bytes())?;
    private_write(&paths[2], &der)?;
    Ok((authority, key, der))
}

/// The downloadable trust certificate contains no key or connection token.
pub(super) fn certificate(root: &Path) -> io::Result<Vec<u8>> {
    std::fs::read(root.join(FOLDER).join(CERTIFICATE))
}

/// Keep the CA stable, while issuing a fresh leaf for the machine's current LAN addresses.
pub(super) fn prepare(root: &Path, addresses: &[String]) -> io::Result<Identity> {
    let (authority, authority_key, ca_der) = authority(root)?;
    let ca = parameters(&authority)?
        .self_signed(&authority_key)
        .map_err(invalid)?;
    let mut names = vec!["localhost".to_string(), "127.0.0.1".to_string()];
    names.extend(addresses.iter().filter_map(|address| {
        address
            .strip_prefix("http://")?
            .rsplit_once(':')
            .map(|(host, _)| host.to_string())
    }));
    names.sort();
    names.dedup();
    let mut params = CertificateParams::new(names).map_err(invalid)?;
    params.distinguished_name = rcgen::DistinguishedName::new();
    params
        .distinguished_name
        .push(DnType::CommonName, "Music Generator");
    let now = OffsetDateTime::now_utc();
    params.not_before = now - time::Duration::days(1);
    params.not_after = (now + time::Duration::days(365))
        .min(OffsetDateTime::from_unix_timestamp(authority.not_after).map_err(invalid)?);
    params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
    params.key_usages = vec![KeyUsagePurpose::DigitalSignature];
    params.use_authority_key_identifier_extension = true;
    let key = KeyPair::generate().map_err(invalid)?;
    let leaf = params
        .signed_by(&key, &ca, &authority_key)
        .map_err(invalid)?;
    let mut config = rustls::ServerConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .map_err(invalid)?
    .with_no_client_auth()
    .with_single_cert(
        vec![
            leaf.der().clone(),
            rustls::pki_types::CertificateDer::from(ca_der.clone()),
        ],
        rustls::pki_types::PrivatePkcs8KeyDer::from(key.serialize_der()).into(),
    )
    .map_err(invalid)?;
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    Ok(Identity {
        config: Arc::new(config),
        fingerprint: fingerprint(&ca_der),
    })
}

type Handshake = BoxFuture<'static, io::Result<(TlsStream<TcpStream>, SocketAddr)>>;

/// Handshakes progress concurrently; dropping the listener cancels every pending handshake.
pub(super) struct Listener {
    tcp: TcpListener,
    acceptor: TlsAcceptor,
    pending: FuturesUnordered<Handshake>,
}

impl Listener {
    pub fn new(tcp: TcpListener, config: Arc<rustls::ServerConfig>) -> Self {
        Self {
            tcp,
            acceptor: TlsAcceptor::from(config),
            pending: FuturesUnordered::new(),
        }
    }
}

impl axum::serve::Listener for Listener {
    type Io = TlsStream<TcpStream>;
    type Addr = SocketAddr;

    async fn accept(&mut self) -> (Self::Io, Self::Addr) {
        loop {
            tokio::select! {
                accepted = self.tcp.accept(), if self.pending.len() < MAX_HANDSHAKES => {
                    match accepted {
                        Ok((tcp, address)) => {
                            let acceptor = self.acceptor.clone();
                            self.pending.push(async move {
                                let stream = tokio::time::timeout(Duration::from_secs(5), acceptor.accept(tcp))
                                    .await.map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "TLS handshake timed out"))??;
                                Ok((stream, address))
                            }.boxed());
                        }
                        Err(error) => {
                            tracing::debug!("HTTPS accept failed: {error}");
                            tokio::time::sleep(Duration::from_millis(100)).await;
                        }
                    }
                }
                completed = self.pending.next(), if !self.pending.is_empty() => {
                    if let Some(Ok(connection)) = completed { return connection; }
                }
            }
        }
    }

    fn local_addr(&self) -> io::Result<Self::Addr> {
        self.tcp.local_addr()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{db::Database, phone_access, state::AppState};
    use tokio::io::AsyncReadExt;

    fn state(root: &Path) -> Arc<AppState> {
        Arc::new(AppState::new(
            Database::open(root).unwrap(),
            root.join("resources"),
        ))
    }

    fn trusted_client(state: &AppState) -> reqwest::Client {
        reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(2))
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
            Some(fingerprint(&certificate).as_str())
        );
        state.phone_access.stop().await;
        let refreshed = prepare(
            root.path(),
            &[
                "http://studio-renamed.local:8767".into(),
                "http://192.168.2.10:8767".into(),
            ],
        )
        .unwrap();
        assert_eq!(
            refreshed.fingerprint,
            first.certificate_fingerprint.unwrap()
        );
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
                std::fs::metadata(root.path().join(FOLDER).join(KEY))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
            assert_eq!(
                std::fs::metadata(root.path().join(FOLDER))
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
        prepare(root.path(), &[]).unwrap();
        let original = certificate(root.path()).unwrap();
        std::fs::write(root.path().join(FOLDER).join(KEY), "broken key").unwrap();
        assert!(prepare(root.path(), &[]).is_err());
        assert_eq!(certificate(root.path()).unwrap(), original);
    }
}
