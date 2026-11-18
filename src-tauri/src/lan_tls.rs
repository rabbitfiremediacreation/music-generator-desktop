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

pub(crate) struct Identity {
    pub config: Arc<rustls::ServerConfig>,
    pub fingerprint: String,
    pub certificate: Vec<u8>,
}

fn invalid(error: impl std::fmt::Display) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, error.to_string())
}

pub(crate) fn fingerprint(bytes: &[u8]) -> String {
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

fn authority(folder: &Path) -> io::Result<(Authority, KeyPair, Vec<u8>)> {
    std::fs::create_dir_all(folder)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(folder, std::fs::Permissions::from_mode(0o700))?;
    }
    let paths = [
        folder.join(IDENTITY),
        folder.join(KEY),
        certificate_path(folder),
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
pub(crate) fn certificate_path(folder: &Path) -> std::path::PathBuf {
    folder.join(CERTIFICATE)
}

/// Keep the CA stable, while issuing a fresh leaf for the current advertised hosts.
pub(crate) fn prepare(
    folder: &Path,
    hosts: impl IntoIterator<Item = String>,
) -> io::Result<Identity> {
    let (authority, authority_key, ca_der) = authority(folder)?;
    let ca = parameters(&authority)?
        .self_signed(&authority_key)
        .map_err(invalid)?;
    let mut names: Vec<_> = hosts.into_iter().collect();
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
        certificate: ca_der,
    })
}

type Handshake = BoxFuture<'static, io::Result<(TlsStream<TcpStream>, SocketAddr)>>;

/// Handshakes progress concurrently; dropping the listener cancels every pending handshake.
pub(crate) struct Listener {
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
