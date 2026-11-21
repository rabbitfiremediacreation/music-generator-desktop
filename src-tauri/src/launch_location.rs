#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "macos")]
pub(crate) use macos::inside_app_bundle;

#[cfg(any(target_os = "macos", all(test, unix)))]
use std::path::{Path, PathBuf};

#[cfg(any(target_os = "macos", all(test, unix)))]
struct Mount {
    path: PathBuf,
    source: String,
    filesystem: String,
    read_only: bool,
}

/// Resolve the containing volume, including nullfs mirrors used by App Translocation.
#[cfg(any(target_os = "macos", all(test, unix)))]
fn classify(
    path: &Path,
    mounts: &[Mount],
    disk_image: impl Fn(&str) -> Option<bool>,
) -> Option<bool> {
    let mut path = path.to_path_buf();
    for _ in 0..=mounts.len() {
        let mount = mounts
            .iter()
            .filter(|mount| path.starts_with(&mount.path))
            .max_by_key(|mount| mount.path.components().count())?;
        if mount.filesystem == "nullfs" {
            if !Path::new(&mount.source).is_absolute() {
                return None;
            }
            path = PathBuf::from(&mount.source);
        } else {
            return if mount.read_only {
                disk_image(&mount.source)
            } else {
                Some(false)
            };
        }
    }
    None
}

/// Only a positively identified read-only disk image prevents normal startup.
pub fn installation_required() -> bool {
    #[cfg(target_os = "macos")]
    match macos::inspect() {
        Some(required) => required,
        None => {
            eprintln!("Startup location could not be determined; allowing startup.");
            false
        }
    }
    #[cfg(not(target_os = "macos"))]
    false
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    fn mount(path: &str, source: &str, filesystem: &str, read_only: bool) -> Mount {
        Mount {
            path: path.into(),
            source: source.into(),
            filesystem: filesystem.into(),
            read_only,
        }
    }

    #[test]
    fn blocks_images_independently_of_volume_name_or_mount_directory() {
        for path in ["/Volumes/Renamed Installer", "/private/tmp/custom mount"] {
            let mounts = [
                mount("/", "/dev/disk1", "apfs", false),
                mount(path, "/dev/disk9s1", "hfs", true),
            ];
            assert_eq!(
                classify(
                    &std::path::Path::new(path).join("Music Generator.app"),
                    &mounts,
                    |_| Some(true)
                ),
                Some(true)
            );
        }
    }

    #[test]
    fn allows_regular_installations_and_writable_images() {
        let mounts = [
            mount("/", "/dev/disk1", "apfs", true),
            mount("/Volumes/External", "/dev/disk2", "apfs", true),
            mount("/Volumes/Writable", "/dev/disk3", "apfs", false),
        ];
        for path in [
            "/Applications/Music Generator.app",
            "/Users/test/Apps/Music Generator.app",
            "/Volumes/External/Music Generator.app",
        ] {
            assert_eq!(
                classify(std::path::Path::new(path), &mounts, |_| Some(false)),
                Some(false)
            );
        }
        assert_eq!(
            classify(
                std::path::Path::new("/Volumes/Writable/Music Generator.app"),
                &mounts,
                |_| Some(true)
            ),
            Some(false)
        );
    }

    #[test]
    fn follows_translocation_to_the_original_volume_without_blocking_copied_apps() {
        for (original, expected) in [
            ("/Volumes/Installer/Music Generator.app", true),
            ("/Users/test/Downloads/Music Generator.app", false),
        ] {
            let mounts = [
                mount("/", "/dev/disk1", "apfs", false),
                mount("/Volumes/Installer", "/dev/disk9", "hfs", true),
                mount("/private/tmp/AppTranslocation/id", original, "nullfs", true),
            ];
            assert_eq!(
                classify(
                    std::path::Path::new("/private/tmp/AppTranslocation/id/d/Music Generator.app"),
                    &mounts,
                    |device| Some(device == "/dev/disk9")
                ),
                Some(expected)
            );
        }
    }

    #[test]
    fn does_not_guess_when_metadata_is_missing_or_cyclic() {
        let mounts = [mount("/", "/dev/disk1", "apfs", true)];
        assert_eq!(
            classify(
                std::path::Path::new("/Applications/Music Generator.app"),
                &mounts,
                |_| None
            ),
            None
        );
        let cyclic = [mount("/loop", "/loop/App.app", "nullfs", true)];
        assert_eq!(
            classify(std::path::Path::new("/loop/App.app"), &cyclic, |_| Some(
                true
            )),
            None
        );
    }
}
