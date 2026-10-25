use super::ImportPreview;
use crate::db::safe_song_path;
use std::path::Path;

const SPACE_RESERVE: u64 = 64 * 1024 * 1024;

/// Share destination checks between import and the existing-library move assistant.
pub(super) fn target<'a>(
    preview: &mut ImportPreview,
    target: &Path,
    source: &Path,
    files: impl Iterator<Item = &'a str>,
) {
    if !target.is_absolute() {
        preview.issue("invalid_path", target);
        return;
    }
    if let (Ok(a), Ok(b)) = (source.canonicalize(), target.canonicalize()) {
        if a == b {
            preview.issue("same_folder", target);
            return;
        }
    }
    let ancestor = target.ancestors().find(|p| p.is_dir());
    let Some(ancestor) = ancestor else {
        preview.issue("target_access", target);
        return;
    };
    // A disposable write probe checks both filesystem permissions and the current sandbox grant.
    let probe = ancestor.join(format!(".music-generator-check-{}", crate::types::id()));
    match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
    {
        Ok(file) => {
            drop(file);
            let _ = std::fs::remove_file(probe);
        }
        Err(_) => preview.issue("target_access", target),
    }
    if target.exists() && !target.is_dir() {
        preview.issue("target_access", target);
    }
    preview.free_bytes = fs2::available_space(ancestor).ok();
    if preview
        .free_bytes
        .is_some_and(|free| free < preview.bytes.saturating_add(SPACE_RESERVE))
    {
        preview.issue("space", target);
    } else if preview.free_bytes.is_none() {
        preview.issue("target_access", target);
    }
    for name in files {
        match safe_song_path(target, name) {
            Ok(path) => match std::fs::symlink_metadata(&path) {
                Ok(_) => preview.issue("collision", path),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => preview.issue("target_access", path),
            },
            Err(_) => preview.issue("invalid_data", target),
        }
    }
}
