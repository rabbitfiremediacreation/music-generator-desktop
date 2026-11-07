fn main() {
    embed_mobile_assets();
    println!("cargo:rerun-if-env-changed=GITHUB_SHA");
    let revision = std::env::var("GITHUB_SHA").unwrap_or_else(|_| "local".into());
    println!("cargo:rustc-env=MUSIC_GENERATOR_BUILD_REVISION={revision}");
    println!("cargo:rerun-if-env-changed=MUSIC_GENERATOR_LINUX_BACKEND");
    let linux_backend =
        std::env::var("MUSIC_GENERATOR_LINUX_BACKEND").unwrap_or_else(|_| "vulkan".to_owned());
    assert!(
        matches!(linux_backend.as_str(), "vulkan" | "cuda"),
        "MUSIC_GENERATOR_LINUX_BACKEND must be vulkan or cuda"
    );
    println!("cargo:rustc-env=MUSIC_GENERATOR_LINUX_BACKEND={linux_backend}");
    if std::env::var("PROFILE").as_deref() == Ok("release") {
        use sha2::{Digest, Sha256};
        let root = std::path::Path::new("resources/engine");
        let metadata: serde_json::Value = serde_json::from_slice(
            &std::fs::read(root.join("VERSION.desktop.json"))
                .expect("Engine missing: run npm run engine:prepare"),
        )
        .expect("Invalid engine provenance");
        let platform = match std::env::var("CARGO_CFG_TARGET_OS").unwrap().as_str() {
            "macos" => "macos",
            "windows" => "windows",
            "linux" => "linux",
            _ => panic!("Unsupported desktop platform"),
        };
        assert_eq!(
            metadata["platform"], platform,
            "Engine platform does not match build target"
        );
        if platform == "linux" {
            assert_eq!(
                metadata["backend"], linux_backend,
                "Wrong Linux engine backend"
            );
        }
        let arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap();
        assert_eq!(
            metadata["arch"],
            if arch == "aarch64" { "arm64" } else { "x64" },
            "Engine architecture does not match build target"
        );
        let manifest: serde_json::Value =
            serde_json::from_str(include_str!("../models/manifest.json"))
                .expect("Invalid model manifest");
        assert_eq!(
            metadata["revision"], manifest["engines"][platform]["revision"],
            "Engine revision does not match the pinned manifest"
        );
        let executable = if platform == "windows" {
            "ace-server.exe"
        } else {
            "ace-server"
        };
        let files = metadata["files"]
            .as_object()
            .expect("Engine file checksums missing");
        assert!(
            files.keys().all(|file| !file.starts_with("heartmula/")),
            "Retired provider resources must not be bundled"
        );
        assert!(
            files.contains_key(executable),
            "Engine executable missing from manifest"
        );
        assert!(
            files.contains_key(if platform == "windows" {
                "mp3-codec.exe"
            } else {
                "mp3-codec"
            }),
            "Required MP3 codec missing from resources"
        );
        let title: serde_json::Value = serde_json::from_slice(
            &std::fs::read(root.join("title/TITLE_RUNTIME.json"))
                .expect("Title runtime missing: run npm run engine:prepare"),
        )
        .expect("Invalid title runtime provenance");
        let pin: serde_json::Value =
            serde_json::from_str(include_str!("../models/title-model.json"))
                .expect("Invalid title model pin");
        assert_eq!(title["revision"], pin["engine"]["revision"]);
        assert_eq!(title["platform"], metadata["platform"]);
        assert_eq!(title["arch"], metadata["arch"]);
        assert!(
            files.contains_key(if platform == "windows" {
                "title/music-title.exe"
            } else {
                "title/music-title"
            }),
            "Title executable missing from resources"
        );
        println!("cargo:rerun-if-changed=../models/title-model.json");
        for (name, checksum) in files {
            assert!(
                !name.split('/').any(|p| p == "..") && !std::path::Path::new(name).is_absolute(),
                "Invalid resource path"
            );
            let file = root.join(name);
            println!("cargo:rerun-if-changed={}", file.display());
            let digest = format!(
                "{:x}",
                Sha256::digest(std::fs::read(&file).expect("Missing engine resource"))
            );
            assert_eq!(
                Some(digest.as_str()),
                checksum.as_str(),
                "Engine resource was modified: {name}"
            );
        }
        println!("cargo:rerun-if-changed=resources/engine/VERSION.desktop.json");
    }
    tauri_build::build();
}

/// Only the separately built remote UI is exposed by the phone server. Embedding the
/// allowlist also makes development and installed bundles use the exact same files.
fn embed_mobile_assets() {
    use std::{fmt::Write, path::Path};
    let folder = Path::new("../dist-mobile");
    println!("cargo:rerun-if-changed={}", folder.display());
    assert!(
        folder.join("index.html").is_file(),
        "Mobile web app missing: run npm run build before building the desktop app"
    );
    let mut files = Vec::new();
    mobile_files(folder, &mut files);
    files.sort();
    let mut source = String::from("static ASSETS: &[Asset] = &[\n");
    for file in files {
        let relative = file
            .strip_prefix(folder)
            .unwrap()
            .to_str()
            .unwrap()
            .replace('\\', "/");
        let content_type = match file.extension().and_then(|value| value.to_str()) {
            Some("html") => "text/html; charset=utf-8",
            Some("js") => "text/javascript; charset=utf-8",
            Some("css") => "text/css; charset=utf-8",
            Some("txt") => "text/plain; charset=utf-8",
            Some("json") => "application/json; charset=utf-8",
            Some("webmanifest") => "application/manifest+json; charset=utf-8",
            Some("png") => "image/png",
            Some("svg") => "image/svg+xml",
            Some("ico") => "image/x-icon",
            Some("jpg" | "jpeg") => "image/jpeg",
            Some("webp") => "image/webp",
            Some("woff2") => "font/woff2",
            _ => panic!("Unexpected mobile asset: {relative}"),
        };
        let absolute = file.canonicalize().unwrap();
        let immutable = relative.starts_with("assets/");
        writeln!(source, "Asset {{ path: {relative:?}, content_type: {content_type:?}, bytes: include_bytes!({:?}), immutable: {immutable} }},", absolute.to_str().unwrap()).unwrap();
    }
    source.push_str("];");
    let generated = Path::new(&std::env::var_os("OUT_DIR").unwrap()).join("mobile_assets.rs");
    std::fs::write(generated, source).expect("Could not embed mobile web app");
}

fn mobile_files(folder: &std::path::Path, files: &mut Vec<std::path::PathBuf>) {
    for entry in std::fs::read_dir(folder).expect("Could not read mobile web app") {
        let entry = entry.expect("Could not read mobile web app entry");
        let kind = entry.file_type().unwrap();
        assert!(
            !kind.is_symlink(),
            "Mobile assets must not contain symlinks"
        );
        if kind.is_dir() {
            mobile_files(&entry.path(), files);
        } else if kind.is_file() {
            files.push(entry.path());
        }
    }
}
