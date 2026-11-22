//! Stage agent exports and publish atomically, preserving existing files by default.
use crate::{
    error::{message, Result},
    state::AppState,
};
use std::path::{Path, PathBuf};

pub(super) struct Target {
    directory: PathBuf,
    staged: PathBuf,
    destination: PathBuf,
    overwrite: bool,
}

impl Target {
    pub fn new(
        state: &AppState,
        kind: &str,
        id: Option<&str>,
        destination: &Path,
        overwrite: bool,
    ) -> Result<Self> {
        let settings = state.db.settings()?;
        let original_extension;
        let expected = match kind {
            "audio" => match crate::audio_export::AudioFormat::parse(&settings.export_format)?
                .extension()
            {
                Some(extension) => extension,
                None => {
                    let song = state.db.song(id.ok_or_else(|| message("Missing song"))?)?;
                    original_extension = song
                        .audio_path()
                        .and_then(|path| Path::new(path).extension())
                        .and_then(|extension| extension.to_str())
                        .unwrap_or("wav")
                        .to_ascii_lowercase();
                    &original_extension
                }
            },
            "midi" => "mid",
            "lyrics" => "txt",
            "zip" => "zip",
            _ => return Err(message("Unknown export kind")),
        };
        if destination
            .extension()
            .and_then(|extension| extension.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref()
            != Some(expected)
        {
            return Err(message(format!(
                "Destination must have the .{expected} extension"
            )));
        }
        let parent = destination
            .parent()
            .ok_or_else(|| message("Missing export directory"))?
            .canonicalize()?;
        let filename = destination
            .file_name()
            .ok_or_else(|| message("Missing export filename"))?;
        let destination = parent.join(filename);
        ensure_unmanaged(state, &settings, &destination)?;
        Self::stage(destination, overwrite)
    }

    fn stage(destination: PathBuf, overwrite: bool) -> Result<Self> {
        if std::fs::symlink_metadata(&destination).is_ok() && !overwrite {
            return Err(message(
                "Export destination already exists; choose another filename or set overwrite=true",
            ));
        }
        if destination.is_dir() {
            return Err(message("Export destination is a directory"));
        }
        let directory = destination
            .parent()
            .ok_or_else(|| message("Missing export directory"))?
            .join(format!(".music-generator-export-{}", crate::types::id()));
        std::fs::create_dir(&directory)?;
        let staged = directory.join(
            destination
                .file_name()
                .ok_or_else(|| message("Missing filename"))?,
        );
        Ok(Self {
            directory,
            staged,
            destination,
            overwrite,
        })
    }

    pub fn path(&self) -> &Path {
        &self.staged
    }

    pub fn commit(&self) -> Result<()> {
        if self.overwrite {
            std::fs::rename(&self.staged, &self.destination)?;
        } else {
            // Native no-replace rename works on external FAT/exFAT drives as well as local disks.
            // The crate falls back to no-clobber linking on platforms without that primitive.
            tempfile::TempPath::try_from_path(self.staged.clone())?
                .persist_noclobber(&self.destination)
                .map_err(|error| error.error)?;
        }
        Ok(())
    }
}

pub(in crate::mcp::operations) fn preview_directory(
    state: &AppState,
    destination: &Path,
) -> Result<tempfile::TempDir> {
    let destination = destination.canonicalize()?;
    ensure_unmanaged(state, &state.db.settings()?, &destination)?;
    Ok(tempfile::Builder::new()
        .prefix("stem-repair-preview-")
        .tempdir_in(destination)?)
}

/// Protect the database, model weights and original library files from export writes.
fn ensure_unmanaged(
    state: &AppState,
    settings: &crate::types::Settings,
    destination: &Path,
) -> Result<()> {
    let resolved = destination.canonicalize().ok();
    for protected in [
        state.db.root.as_path(),
        Path::new(&settings.models_dir),
        Path::new(&settings.songs_dir),
    ] {
        if let Ok(protected) = protected.canonicalize() {
            if destination.starts_with(&protected)
                || resolved
                    .as_ref()
                    .is_some_and(|path| path.starts_with(&protected))
            {
                return Err(message("Choose an export destination outside the app data, model and song-library directories"));
            }
        }
    }
    Ok(())
}

impl Drop for Target {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn intervening_file_is_preserved_and_failed_staging_is_cleaned_up() {
        let root = tempfile::tempdir().unwrap();
        let destination = root.path().join("song.wav");
        let target = Target::stage(destination.clone(), false).unwrap();
        let staging = target.directory.clone();
        std::fs::write(target.path(), b"generated").unwrap();
        std::fs::write(&destination, b"existing").unwrap();
        assert!(target.commit().is_err());
        drop(target);
        assert_eq!(std::fs::read(&destination).unwrap(), b"existing");
        assert!(!staging.exists());
    }

    #[test]
    fn explicit_overwrite_replaces_only_after_successful_staging() {
        let root = tempfile::tempdir().unwrap();
        let destination = root.path().join("song.wav");
        std::fs::write(&destination, b"existing").unwrap();
        let target = Target::stage(destination.clone(), true).unwrap();
        assert_eq!(std::fs::read(&destination).unwrap(), b"existing");
        std::fs::write(target.path(), b"generated").unwrap();
        target.commit().unwrap();
        assert_eq!(std::fs::read(&destination).unwrap(), b"generated");
    }

    #[test]
    fn app_data_and_library_are_not_export_destinations() {
        let root = tempfile::tempdir().unwrap();
        let data = root.path().join("data");
        let state = AppState::new(
            crate::db::Database::open(&data).unwrap(),
            root.path().join("resources"),
        );
        assert!(Target::new(&state, "lyrics", None, &data.join("result.txt"), true).is_err());
        #[cfg(unix)]
        {
            let link = root.path().join("alias");
            std::os::unix::fs::symlink(&data, &link).unwrap();
            assert!(Target::new(&state, "lyrics", None, &link.join("result.txt"), true).is_err());
        }
    }
}
