use crate::error::Result;
use std::path::{Path, PathBuf};

/// Keep incomplete exports away from the selected file and clean them up on every exit.
pub(super) struct StagedExport {
    path: PathBuf,
    #[cfg(target_os = "macos")]
    directory: PathBuf,
}

impl StagedExport {
    pub(super) fn new(destination: &Path) -> Result<Self> {
        #[cfg(target_os = "macos")]
        {
            use crate::error::message;
            use objc2_foundation::{NSFileManager, NSSearchPathDirectory, NSSearchPathDomainMask};
            // A save panel grants only the destination. Foundation supplies a writable,
            // same-volume replacement directory without requesting its parent's access.
            let url = NSFileManager::defaultManager()
                .URLForDirectory_inDomain_appropriateForURL_create_error(
                    NSSearchPathDirectory::ItemReplacementDirectory,
                    NSSearchPathDomainMask::UserDomainMask,
                    Some(&file_url(destination)),
                    true,
                )
                .map_err(|e| message(e.to_string()))?;
            let directory = PathBuf::from(
                url.path()
                    .ok_or_else(|| message("Missing replacement directory path"))?
                    .to_string(),
            );
            Ok(Self {
                path: directory.join("export.part"),
                directory,
            })
        }
        #[cfg(not(target_os = "macos"))]
        Ok(Self {
            path: destination.with_extension(format!("{}.part", crate::types::id())),
        })
    }

    pub(super) fn path(&self) -> &Path {
        &self.path
    }

    pub(super) fn commit(&self, destination: &Path) -> Result<()> {
        #[cfg(target_os = "macos")]
        {
            use crate::error::message;
            use objc2_foundation::{NSFileManager, NSFileManagerItemReplacementOptions};
            let manager = NSFileManager::defaultManager();
            let source = file_url(&self.path);
            let target = file_url(destination);
            if destination.try_exists()? {
                manager
                    .replaceItemAtURL_withItemAtURL_backupItemName_options_resultingItemURL_error(
                        &target,
                        &source,
                        None,
                        NSFileManagerItemReplacementOptions::empty(),
                        None,
                    )
            } else {
                manager.moveItemAtURL_toURL_error(&source, &target)
            }
            .map_err(|e| message(e.to_string()))?;
        }
        #[cfg(not(target_os = "macos"))]
        std::fs::rename(&self.path, destination)?;
        Ok(())
    }
}

impl Drop for StagedExport {
    fn drop(&mut self) {
        #[cfg(target_os = "macos")]
        let _ = std::fs::remove_dir_all(&self.directory);
        #[cfg(not(target_os = "macos"))]
        let _ = std::fs::remove_file(&self.path);
    }
}

#[cfg(target_os = "macos")]
fn file_url(path: &Path) -> objc2::rc::Retained<objc2_foundation::NSURL> {
    objc2_foundation::NSURL::fileURLWithPath(&objc2_foundation::NSString::from_str(
        &path.to_string_lossy(),
    ))
}
