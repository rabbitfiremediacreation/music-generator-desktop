use crate::error::{message, Result};
use std::{
    io::Write,
    path::{Path, PathBuf},
};
use tauri::Manager;

pub(crate) fn write_private(path: &Path, bytes: &[u8]) -> Result<()> {
    // NamedTempFile is private on Unix and atomically replaces existing files on Windows too.
    let mut temporary = tempfile::NamedTempFile::new_in(
        path.parent()
            .ok_or_else(|| message("Missing private file directory"))?,
    )?;
    temporary.write_all(bytes)?;
    temporary.as_file().sync_all()?;
    temporary.persist(path).map_err(|error| error.error)?;
    Ok(())
}

/// Validate existing ancestors and access before setup creates folders or downloads models.
pub fn setup_folders(models: &str, songs: &str) -> Result<(PathBuf, PathBuf)> {
    let models = PathBuf::from(models.trim());
    let songs = PathBuf::from(songs.trim());
    for path in [&models, &songs] {
        if !path.is_absolute() {
            return Err(message("path_absolute"));
        }
        let ancestor = folder_ancestor(path)?;
        std::fs::read_dir(&ancestor).map_err(|_| message("path_access"))?;
        let probe = ancestor.join(format!(".music-generator-check-{}", crate::types::id()));
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&probe)
            .map_err(|_| message("path_access"))?;
        drop(file);
        std::fs::remove_file(probe).map_err(|_| message("path_access"))?;
    }
    Ok((models, songs))
}

pub fn folder_ancestor(path: &Path) -> Result<PathBuf> {
    for ancestor in path.ancestors() {
        match std::fs::metadata(ancestor) {
            Ok(metadata) if metadata.is_dir() => return Ok(ancestor.into()),
            Ok(_) => return Err(message("path_not_directory")),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotADirectory => {
                return Err(message("path_not_directory"))
            }
            Err(_) => return Err(message("path_access")),
        }
    }
    Err(message("path_unavailable"))
}

/// Dialog history is a location hint, never a filesystem authorization.
pub fn dialog_start(current: Option<&Path>, remembered: Option<&Path>, fallback: &Path) -> PathBuf {
    current
        .filter(|path| path.is_absolute())
        .and_then(|path| directory_hint(path, true))
        .or_else(|| {
            remembered
                .filter(|path| path.is_absolute())
                .and_then(|path| directory_hint(path, false))
        })
        .unwrap_or_else(|| fallback.into())
}

fn directory_hint(path: &Path, allow_ancestor: bool) -> Option<PathBuf> {
    for candidate in path.ancestors() {
        match std::fs::metadata(candidate) {
            Ok(metadata) if metadata.is_dir() => return Some(candidate.into()),
            // Let the native dialog reacquire a sandbox grant for this location.
            Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
                return Some(candidate.into())
            }
            _ if !allow_ancestor => return None,
            _ => {}
        }
    }
    None
}

#[tauri::command]
pub fn dialog_directory(
    app: tauri::AppHandle,
    current: Option<String>,
    remembered: Option<String>,
    exporting: bool,
) -> crate::error::Result<String> {
    let home = app
        .path()
        .home_dir()
        .map_err(|_| crate::error::message("path_unavailable"))?;
    let fallback = if exporting {
        app.path()
            .download_dir()
            .ok()
            .filter(|path| path.is_dir())
            .unwrap_or(home)
    } else {
        home
    };
    Ok(dialog_start(
        current.as_deref().map(Path::new),
        remembered.as_deref().map(Path::new),
        &fallback,
    )
    .to_string_lossy()
    .into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn directory_start_keeps_purposes_separate_and_resolves_new_input() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join("home");
        let models = root.path().join("models");
        std::fs::create_dir(&home).unwrap();
        std::fs::create_dir(&models).unwrap();
        assert_eq!(dialog_start(None, None, &home), home);
        assert_eq!(dialog_start(None, Some(&models), &home), models);
        assert_eq!(
            dialog_start(Some(&models.join("new/nested")), None, &home),
            models
        );
        assert_eq!(
            dialog_start(None, Some(&root.path().join("deleted")), &home),
            home
        );
        assert_eq!(
            dialog_start(Some(Path::new("relative")), Some(&models), &home),
            models
        );
    }

    #[test]
    fn setup_checks_both_folders_without_creating_them() {
        let root = tempfile::tempdir().unwrap();
        let models = root.path().join("new models/音楽");
        let songs = root.path().join("new songs");
        let checked = setup_folders(
            &format!("  {}  ", models.display()),
            songs.to_str().unwrap(),
        )
        .unwrap();
        assert_eq!(checked, (models.clone(), songs.clone()));
        assert!(!models.exists());
        assert!(!songs.exists());
        let file = root.path().join("file");
        std::fs::write(&file, "data").unwrap();
        assert_eq!(
            setup_folders(models.to_str().unwrap(), file.to_str().unwrap())
                .unwrap_err()
                .to_string(),
            "path_not_directory"
        );
        for invalid in ["", "relative", "~/models"] {
            assert_eq!(
                setup_folders(invalid, songs.to_str().unwrap())
                    .unwrap_err()
                    .to_string(),
                "path_absolute"
            );
            assert_eq!(
                setup_folders(models.to_str().unwrap(), invalid)
                    .unwrap_err()
                    .to_string(),
                "path_absolute"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn denied_folder_requires_authorization_but_remains_a_native_dialog_hint() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let denied = root.path().join("denied");
        std::fs::create_dir(&denied).unwrap();
        std::fs::set_permissions(&denied, std::fs::Permissions::from_mode(0o000)).unwrap();
        let result = setup_folders(denied.to_str().unwrap(), root.path().to_str().unwrap());
        let hint = dialog_start(Some(&denied.join("models")), None, root.path());
        std::fs::set_permissions(&denied, std::fs::Permissions::from_mode(0o700)).unwrap();
        assert_eq!(result.unwrap_err().to_string(), "path_access");
        assert_eq!(hint, denied.join("models"));
    }
}
