use crate::error::{message, Result};
use std::{
    ffi::OsStr,
    io,
    path::{Path, PathBuf},
    sync::Arc,
};

/// Keep conversion files alive until both the caller and any detached copy finish.
pub(super) struct Staging(PathBuf);

impl Staging {
    pub(super) fn new(cache: &Path) -> Result<Arc<Self>> {
        let path = cache.join(format!("temporary-{}", crate::types::id()));
        std::fs::create_dir(&path)?;
        Ok(Arc::new(Self(path)))
    }

    pub(super) fn path(&self) -> &Path {
        &self.0
    }

    /// The blocking operation retains ownership even when its awaiting future is dropped.
    pub(super) async fn copy_source(self: &Arc<Self>, source: &Path) -> Result<()> {
        let staging = self.clone();
        let source = source.to_path_buf();
        tokio::task::spawn_blocking(move || {
            std::fs::copy(source, staging.path().join("source.wav"))
        })
        .await
        .map_err(|error| message(error.to_string()))??;
        Ok(())
    }
}

impl Drop for Staging {
    fn drop(&mut self) {
        remove(&self.0);
    }
}

/// Recover abandoned work only during startup, before any exports can be admitted.
pub(crate) fn cleanup_stale(root: &Path) {
    let cache = root.join("export");
    let entries = match std::fs::symlink_metadata(&cache).and_then(|metadata| {
        if metadata.file_type().is_dir() {
            std::fs::read_dir(&cache).map(Some)
        } else {
            Ok(None)
        }
    }) {
        Ok(Some(entries)) => entries,
        Ok(None) => return,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return,
        Err(error) => {
            tracing::warn!(path = %cache.display(), %error, "Could not inspect temporary export files");
            return;
        }
    };
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                tracing::warn!(path = %cache.display(), %error, "Could not inspect export entry");
                continue;
            }
        };
        if !temporary_name(&entry.file_name()) {
            continue;
        }
        match entry.file_type() {
            Ok(kind) if kind.is_dir() => remove(&entry.path()),
            Ok(_) => {}
            Err(error) => {
                tracing::warn!(path = %entry.path().display(), %error, "Could not inspect temporary export directory");
            }
        }
    }
}

fn temporary_name(name: &OsStr) -> bool {
    let Some(suffix) = name
        .to_str()
        .and_then(|name| name.strip_prefix("temporary-"))
    else {
        return false;
    };
    let Ok(id) = uuid::Uuid::parse_str(suffix) else {
        return false;
    };
    id.get_version() == Some(uuid::Version::Random)
        && id.get_variant() == uuid::Variant::RFC4122
        && suffix == id.simple().to_string()
}

fn remove(path: &Path) {
    let result = std::fs::remove_dir_all(path);
    #[cfg(windows)]
    let result = {
        let mut result = result;
        for _ in 0..2 {
            let code = result.as_ref().err().and_then(io::Error::raw_os_error);
            if !matches!(code, Some(5 | 32 | 33 | 145)) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
            result = std::fs::remove_dir_all(path);
        }
        result
    };
    if let Err(error) = result {
        if error.kind() != io::ErrorKind::NotFound {
            tracing::warn!(path = %path.display(), %error, "Could not remove temporary export files; retrying at next startup");
        }
    }
}
