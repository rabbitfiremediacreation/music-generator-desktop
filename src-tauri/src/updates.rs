#[cfg(target_os = "macos")]
pub mod macos;

use crate::{error::Result, types::UpdateStream};
use semver::Version;
use serde_json::{json, Value};

pub(crate) const RELEASE_REPOSITORY: &str = "rabbitfiremediacreation/music-generator-desktop";
const API_ROOT: &str = "https://api.github.com/repos";

impl UpdateStream {
    fn preview_source(self) -> Option<(&'static str, &'static str)> {
        match self {
            Self::Stable => None,
            Self::Daily => Some(("daily", "schedule")),
            Self::Develop => Some(("develop", "push")),
        }
    }
}

pub async fn check(stream: UpdateStream) -> Result<Value> {
    let client = reqwest::Client::builder()
        .user_agent("music-generator-desktop")
        .timeout(std::time::Duration::from_secs(20))
        .build()?;
    let current = Version::parse(env!("CARGO_PKG_VERSION")).unwrap();
    let installed_build = option_env!("MUSIC_GENERATOR_UPDATE_BUILD");
    let current_label = version_label(&current, installed_build);
    let empty = || json!({"available":false,"current":current_label});
    let (endpoint, preview_tag) = if let Some((channel, event)) = stream.preview_source() {
        let runs: Value = client
            .get(format!(
                "{API_ROOT}/{RELEASE_REPOSITORY}/actions/workflows/desktop.yml/runs"
            ))
            .query(&[
                ("branch", "main"),
                ("event", event),
                ("status", "success"),
                ("per_page", "1"),
            ])
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        let Some(run) = runs["workflow_runs"][0]["run_number"].as_u64() else {
            return Ok(empty());
        };
        let tag = format!("{channel}-{run}");
        (format!("releases/tags/{tag}"), Some(tag))
    } else {
        ("releases/latest".to_owned(), None)
    };
    let response = client
        .get(format!("{API_ROOT}/{RELEASE_REPOSITORY}/{endpoint}"))
        .send()
        .await?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(empty());
    }
    let release: Value = response.error_for_status()?.json().await?;
    let suffix = asset_suffix(
        std::env::consts::OS,
        std::env::consts::ARCH,
        env!("MUSIC_GENERATOR_LINUX_BACKEND"),
    );
    let Some((version, url)) = platform_release(&release, preview_tag.as_deref(), suffix) else {
        return Ok(empty());
    };
    let latest = version_label(&version, preview_tag.as_deref());
    let available = is_update(&current, installed_build, &version, preview_tag.as_deref());
    Ok(json!({
        "available": available, "current": current_label, "latest": latest,
        "url": url, "notes": release["body"]
    }))
}

fn version_label(version: &Version, build: Option<&str>) -> String {
    match build {
        Some(build) => format!("{version} ({build})"),
        None => version.to_string(),
    }
}

fn is_update(
    current: &Version,
    installed_build: Option<&str>,
    candidate: &Version,
    candidate_build: Option<&str>,
) -> bool {
    match candidate.cmp_precedence(current) {
        std::cmp::Ordering::Less => false,
        std::cmp::Ordering::Greater => true,
        std::cmp::Ordering::Equal => match (installed_build, candidate_build) {
            (None, None) => false,
            (Some(installed), Some(candidate)) => {
                match (build_number(installed), build_number(candidate)) {
                    (
                        Some((installed_stream, installed_run)),
                        Some((candidate_stream, candidate_run)),
                    ) => installed_stream != candidate_stream || candidate_run > installed_run,
                    _ => false,
                }
            }
            _ => true,
        },
    }
}

fn build_number(tag: &str) -> Option<(&str, u64)> {
    let (stream, run) = tag.split_once('-')?;
    Some((stream, run.parse().ok()?))
}

fn platform_release<'a>(
    release: &'a Value,
    preview_tag: Option<&str>,
    suffix: &str,
) -> Option<(Version, &'a str)> {
    if release["draft"].as_bool() != Some(false)
        || release["prerelease"].as_bool() != Some(preview_tag.is_some())
    {
        return None;
    }
    let tag = release["tag_name"].as_str()?;
    if preview_tag.is_some_and(|expected| expected != tag) {
        return None;
    }
    release["assets"].as_array()?.iter().find_map(|asset| {
        let name = asset["name"].as_str()?;
        let version = name
            .strip_prefix("Music-Generator-")?
            .strip_suffix(suffix)?
            .strip_suffix('-')?;
        if preview_tag.is_none() && tag.strip_prefix('v').unwrap_or(tag) != version {
            return None;
        }
        Some((Version::parse(version).ok()?, release_asset_url(asset)?))
    })
}

fn release_asset_url(asset: &Value) -> Option<&str> {
    asset["browser_download_url"].as_str().filter(|url| {
        url.starts_with(&format!(
            "https://github.com/{RELEASE_REPOSITORY}/releases/download/"
        ))
    })
}

fn asset_suffix(os: &str, arch: &str, linux_backend: &str) -> &'static str {
    if os == "macos" {
        if arch == "x86_64" {
            "macos-x64.zip"
        } else {
            "macos-arm64.zip"
        }
    } else if os == "windows" {
        "windows-x64.zip"
    } else if linux_backend == "cuda" {
        "linux-x64-cuda.AppImage"
    } else {
        "linux-x64.AppImage"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_comparison_handles_same_version_builds_and_stream_switches() {
        let current = Version::parse("0.3.0").unwrap();
        for (installed, candidate, available) in [
            (None, None, false),
            (None, Some("daily-10"), true),
            (Some("daily-10"), None, true),
            (Some("develop-9"), Some("develop-10"), true),
            (Some("develop-10"), Some("develop-10"), false),
            (Some("develop-10"), Some("develop-9"), false),
            (Some("develop-10"), Some("daily-9"), true),
        ] {
            assert_eq!(
                is_update(&current, installed, &current, candidate),
                available
            );
        }
        let earlier = Version::parse("0.2.0").unwrap();
        assert!(!is_update(&current, Some("develop-10"), &earlier, None));
        assert!(is_update(
            &earlier,
            Some("daily-999"),
            &current,
            Some("daily-10")
        ));
    }

    #[test]
    fn platform_downloads_require_a_published_release_from_the_requested_stream() {
        let url = "https://github.com/rabbitfiremediacreation/music-generator-desktop/releases/download/daily-10/Music-Generator-0.3.0-linux-x64-cuda.AppImage";
        let mut release = json!({
            "tag_name": "daily-10", "draft": false, "prerelease": true,
            "assets": [{"name": "Music-Generator-0.3.0-linux-x64-cuda.AppImage", "browser_download_url": url}],
        });
        let cuda = asset_suffix("linux", "x86_64", "cuda");
        let vulkan = asset_suffix("linux", "x86_64", "vulkan");
        assert_eq!(
            platform_release(&release, Some("daily-10"), cuda),
            Some((Version::parse("0.3.0").unwrap(), url))
        );
        assert!(platform_release(&release, Some("daily-10"), vulkan).is_none());
        assert!(platform_release(&release, Some("develop-10"), cuda).is_none());
        assert!(platform_release(&release, None, cuda).is_none());
        release["draft"] = json!(true);
        assert!(platform_release(&release, Some("daily-10"), cuda).is_none());
    }

    #[test]
    fn update_links_are_limited_to_the_desktop_release_repository() {
        for (url, accepted) in [
            ("https://github.com/rabbitfiremediacreation/music-generator-desktop/releases/download/v0.3.0/Music-Generator-0.3.0-macos-arm64.zip", true),
            ("https://github.com/frankhildebrandt/music-generator/releases/download/v0.3.0/app.zip", false),
            ("https://github.com/rabbitfiremediacreation/music-generator/releases/download/v0.3.0/app.zip", false),
            ("https://github.com/rabbitfiremediacreation/music-generator-desktop-fake/releases/download/v0.3.0/app.zip", false),
            ("http://github.com/rabbitfiremediacreation/music-generator-desktop/releases/download/v0.3.0/app.zip", false),
        ] {
            let asset = serde_json::json!({ "browser_download_url": url });
            assert_eq!(super::release_asset_url(&asset).is_some(), accepted, "{url}");
        }
        assert!(super::release_asset_url(&serde_json::json!({})).is_none());
    }

    #[test]
    fn updates_select_the_correct_architecture() {
        assert_eq!(
            super::asset_suffix("macos", "x86_64", "vulkan"),
            "macos-x64.zip"
        );
        assert_eq!(
            super::asset_suffix("macos", "aarch64", "cuda"),
            "macos-arm64.zip"
        );
        assert_eq!(
            super::asset_suffix("windows", "x86_64", "cuda"),
            "windows-x64.zip"
        );
        assert_eq!(
            super::asset_suffix("linux", "x86_64", "vulkan"),
            "linux-x64.AppImage"
        );
    }

    #[test]
    fn preview_updater_ignores_separate_engine_zip_assets() {
        let url = "https://github.com/rabbitfiremediacreation/music-generator-desktop/releases/download/daily-10/Music-Generator-0.3.0-macos-arm64.zip";
        let release = json!({
            "tag_name": "daily-10", "draft": false, "prerelease": true,
            "assets": [
                {"name":"Music-Generator-Engine-ace-step-0.3.0-macos-arm64.zip", "browser_download_url":format!("{url}.engine")},
                {"name":"Music-Generator-0.3.0-macos-arm64.zip", "browser_download_url":url}
            ],
        });
        assert_eq!(
            platform_release(&release, Some("daily-10"), "macos-arm64.zip"),
            Some((Version::parse("0.3.0").unwrap(), url)),
        );
    }

    #[test]
    fn linux_updates_keep_the_installed_backend_when_both_assets_exist() {
        let names = [
            "Music-Generator-0.3.0-linux-x64.AppImage",
            "Music-Generator-0.3.0-linux-x64-cuda.AppImage",
        ];
        for backend in ["vulkan", "cuda"] {
            let suffix = super::asset_suffix("linux", "x86_64", backend);
            let matching: Vec<_> = names.iter().filter(|name| name.ends_with(suffix)).collect();
            assert_eq!(matching.len(), 1);
            assert_eq!(matching[0].contains("-cuda.AppImage"), backend == "cuda");
        }
    }
}
