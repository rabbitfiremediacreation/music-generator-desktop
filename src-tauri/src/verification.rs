use crate::error::{message, Error, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Instant, UNIX_EPOCH},
};
use tokio::io::AsyncReadExt;
use tokio_util::sync::CancellationToken;

#[derive(Debug, PartialEq, Eq)]
pub enum Verification {
    Cached,
    Hashed,
    Invalid,
}

#[derive(Serialize, Deserialize, Default)]
struct Entries {
    entries: HashMap<String, (String, u64, u128)>,
}

static CACHE_WRITES: Mutex<()> = Mutex::new(());

fn read_entries(file: &Path) -> Entries {
    std::fs::read(file)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub struct ModelVerifier {
    file: PathBuf,
    cache: Entries,
}

fn stamp(path: &Path) -> Result<(u64, u128)> {
    let metadata = path.metadata()?;
    if !metadata.is_file() {
        return Err(message("Model is not a regular file"));
    }
    Ok((
        metadata.len(),
        metadata
            .modified()?
            .duration_since(UNIX_EPOCH)
            .map_err(|e| message(e.to_string()))?
            .as_nanos(),
    ))
}

impl ModelVerifier {
    /// Read the existing proof without hashing large files when opening the picker.
    pub fn is_verified(&self, path: &Path, expected: &str) -> bool {
        let Ok(path) = path.canonicalize() else {
            return false;
        };
        let Ok((length, modified)) = stamp(&path) else {
            return false;
        };
        self.cache.entries.get(path.to_string_lossy().as_ref())
            == Some(&(expected.to_owned(), length, modified))
    }

    pub fn open(root: &Path) -> Self {
        let file = root.join("verified-models.json");
        let cache = read_entries(&file);
        Self { file, cache }
    }

    pub(crate) fn forget(&mut self, paths: &[PathBuf]) -> Result<()> {
        self.update(|entries| {
            let before = entries.len();
            for path in paths {
                entries.remove(path.to_string_lossy().as_ref());
            }
            Ok(entries.len() != before)
        })
    }

    // Persist each successful check, so retries and subsequent launches reuse completed work.
    pub async fn verify(
        &mut self,
        path: &Path,
        expected: &str,
        cancel: &CancellationToken,
        progress: impl Fn(u64, u64),
    ) -> Result<Verification> {
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        let path = path.canonicalize()?;
        let (length, modified) = stamp(&path)?;
        let key = path.to_string_lossy().into_owned();
        let entry = (expected.to_owned(), length, modified);
        if self.cache.entries.get(&key) == Some(&entry) {
            return Ok(Verification::Cached);
        }
        self.cache = read_entries(&self.file);
        if self.cache.entries.get(&key) == Some(&entry) {
            return Ok(Verification::Cached);
        }
        let valid = hash_file_with_progress(&path, cancel, progress).await? == expected;
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        if stamp(&path)? != (length, modified) {
            return Err(message("Model changed during verification; retry"));
        }
        if !valid {
            self.update(|entries| Ok(entries.remove(&key).is_some()))?;
            return Ok(Verification::Invalid);
        }
        self.update(|entries| {
            entries.insert(key, entry);
            Ok(true)
        })?;
        Ok(Verification::Hashed)
    }

    // Preserve the checksum proof when a verified partial download becomes a model file.
    pub(crate) fn promote(&mut self, partial: &Path, target: &Path) -> Result<()> {
        let key = partial.canonicalize()?.to_string_lossy().into_owned();
        let entry = self
            .cache
            .entries
            .get(&key)
            .cloned()
            .ok_or_else(|| message("Download has not been verified"))?;
        if stamp(partial)? != (entry.1, entry.2) {
            return Err(message("Download changed after verification"));
        }
        self.update(|entries| {
            std::fs::rename(partial, target)?;
            entries.remove(&key);
            entries.insert(target.canonicalize()?.to_string_lossy().into_owned(), entry);
            Ok(true)
        })
    }

    /// Merge the latest proofs so independent verifiers cannot overwrite each other's entries.
    fn update(
        &mut self,
        update: impl FnOnce(&mut HashMap<String, (String, u64, u128)>) -> Result<bool>,
    ) -> Result<()> {
        let _lock = CACHE_WRITES.lock().unwrap();
        let mut cache = read_entries(&self.file);
        if update(&mut cache.entries)? {
            let temporary = self.file.with_extension("json.tmp");
            std::fs::write(&temporary, serde_json::to_vec(&cache)?)?;
            std::fs::rename(temporary, &self.file)?;
        }
        self.cache = cache;
        Ok(())
    }
}

pub(crate) async fn hash_file_with_progress(
    path: &Path,
    cancel: &CancellationToken,
    progress: impl Fn(u64, u64),
) -> Result<String> {
    let mut file = tokio::fs::File::open(path).await?;
    let total = file.metadata().await?.len();
    let mut buffer = vec![0; 4 * 1024 * 1024];
    let mut hash = Sha256::new();
    let mut read = 0;
    let mut last = Instant::now();
    progress(0, total);
    loop {
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        let size = file.read(&mut buffer).await?;
        if size == 0 {
            break;
        }
        hash.update(&buffer[..size]);
        read += size as u64;
        if last.elapsed().as_millis() >= 200 {
            progress(read, total);
            last = Instant::now();
        }
    }
    progress(read, total);
    Ok(format!("{:x}", hash.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn independent_verifiers_preserve_each_others_new_proofs() {
        let root = tempfile::tempdir().unwrap();
        let first = root.path().join("first.gguf");
        let second = root.path().join("second.gguf");
        std::fs::write(&first, b"first model").unwrap();
        std::fs::write(&second, b"second model").unwrap();
        let first_hash = format!("{:x}", Sha256::digest(b"first model"));
        let second_hash = format!("{:x}", Sha256::digest(b"second model"));
        let cancel = CancellationToken::new();
        let mut first_verifier = ModelVerifier::open(root.path());
        let mut second_verifier = ModelVerifier::open(root.path());
        let (left, right) = tokio::join!(
            first_verifier.verify(&first, &first_hash, &cancel, |_, _| {}),
            second_verifier.verify(&second, &second_hash, &cancel, |_, _| {}),
        );
        assert_eq!(left.unwrap(), Verification::Hashed);
        assert_eq!(right.unwrap(), Verification::Hashed);
        let verifier = ModelVerifier::open(root.path());
        assert!(verifier.is_verified(&first, &first_hash));
        assert!(verifier.is_verified(&second, &second_hash));
    }
}
