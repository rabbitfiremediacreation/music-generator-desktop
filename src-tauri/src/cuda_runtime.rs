//! Optional Windows CUDA libraries. Never install a driver or modify the bundled engine.
use crate::{
    download::DownloadProgress,
    error::{message, Error, Result},
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};
use tokio_util::sync::CancellationToken;

#[derive(Deserialize)]
struct Pin {
    version: String,
    base_url: String,
    engine_revision: String,
    archive_sha256: String,
    components: Vec<Component>,
}
#[derive(Deserialize)]
struct Component {
    name: String,
    path: String,
    sha256: String,
    bytes: u64,
    // Sum of the selected DLLs and LICENSE, from the pinned ZIP's central directory.
    installed_bytes: u64,
    files: Vec<String>,
}

const SPACE_RESERVE: u64 = 64 * 1024 * 1024;

fn archive_name(p: &Pin, component: &Component) -> String {
    format!("{}-{}.zip", component.name, p.version)
}

fn required_space(cache: &Path, p: &Pin) -> u64 {
    p.components.iter().fold(SPACE_RESERVE, |total, component| {
        let name = archive_name(p, component);
        // Completed archives are verified by download_model before use. A .part
        // only saves space if the server accepts resuming; download_model checks
        // space again if it needs to restart instead.
        let missing = if cache.join(&name).is_file() {
            0
        } else {
            let partial = fs::metadata(cache.join(format!("{name}.part")))
                .map(|m| m.len())
                .unwrap_or(0);
            component.bytes.saturating_sub(partial)
        };
        total
            .saturating_add(missing)
            .saturating_add(component.installed_bytes)
    })
}
fn pin() -> Pin {
    serde_json::from_str(include_str!("../../models/cuda-windows.json")).expect("CUDA pin")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Status {
    pub state: String,
    pub download_bytes: u64,
    pub details: Option<String>,
}
impl Status {
    fn new(state: &str, details: Option<String>) -> Self {
        Self {
            state: state.into(),
            details,
            download_bytes: pin().components.iter().map(|c| c.bytes).sum(),
        }
    }
}

fn supported_engine() -> bool {
    let p = pin();
    let engine = &crate::manifest::manifest().engines["windows"];
    engine["revision"].as_str() == Some(&p.engine_revision)
        && engine["sha256"].as_str() == Some(&p.archive_sha256)
}

/// Only fully published installations can enter a child process's DLL search path.
pub fn installed(root: &Path) -> Option<PathBuf> {
    let base = root.join("cuda");
    let directory: String =
        serde_json::from_slice(&fs::read(base.join("active.json")).ok()?).ok()?;
    if directory.is_empty()
        || directory.contains(['/', '\\', ':'])
        || directory == "."
        || directory == ".."
    {
        return None;
    }
    let folder = base.join(directory);
    let p = pin();
    let stamp: String =
        serde_json::from_slice(&fs::read(folder.join("complete.json")).ok()?).ok()?;
    (stamp == p.version
        && p.components
            .iter()
            .flat_map(|c| &c.files)
            .all(|file| folder.join(file).is_file()))
    .then_some(folder)
}

pub fn configure_command(command: &mut Command, root: &Path) {
    if !cfg!(windows) || !supported_engine() {
        return;
    }
    if let Some(folder) = installed(root) {
        let mut paths = vec![folder];
        paths.extend(std::env::split_paths(
            &std::env::var_os("PATH").unwrap_or_default(),
        ));
        if let Ok(paths) = std::env::join_paths(paths) {
            command.env("PATH", paths);
        }
    }
}

pub fn inspect(root: &Path, resources: &Path) -> Status {
    if !cfg!(windows) {
        return Status::new("not_applicable", None);
    }
    if !supported_engine() {
        return Status::new("unsupported_build", None);
    }
    let hw = crate::hardware::inspect();
    if !hw.gpu.to_ascii_lowercase().contains("nvidia") {
        return Status::new("not_applicable", None);
    }
    if hw
        .cuda
        .as_ref()
        .is_some_and(|c| c.architecture_supported == Some(false))
    {
        return Status::new("unsupported_gpu", None);
    }
    let Some(exe) = std::env::current_exe().ok() else {
        return Status::new("check_failed", None);
    };
    let engine = resources.join("engine");
    let mut command = Command::new(exe);
    command
        .arg("--cuda-runtime-check")
        .arg(&engine)
        .current_dir(&engine);
    configure_command(&mut command, root);
    crate::process_output::output(&mut command, Duration::from_secs(10))
        .and_then(|text| {
            text.lines()
                .rev()
                .find_map(|line| serde_json::from_str(line).ok())
        })
        .unwrap_or_else(|| Status::new("check_failed", None))
}

/// Called before GUI initialization, only in a disposable child process.
pub fn cli() -> Option<i32> {
    if std::env::args_os().nth(1).as_deref() != Some(std::ffi::OsStr::new("--cuda-runtime-check")) {
        return None;
    }
    #[cfg(windows)]
    let result = std::env::args_os()
        .nth(2)
        .map(|folder| unsafe { check(Path::new(&folder)) })
        .unwrap_or_else(|| Status::new("check_failed", None));
    #[cfg(not(windows))]
    let result = Status::new("not_applicable", None);
    println!("{}", serde_json::to_string(&result).unwrap());
    Some(0)
}

#[cfg(any(windows, test))]
unsafe fn check(engine: &Path) -> Status {
    // Keep handles alive until enumeration ends. NVIDIA code never loads in the GUI.
    let driver = match libloading::Library::new("nvcuda.dll") {
        Ok(driver) => driver,
        Err(e) => return Status::new("driver_error", Some(e.to_string())),
    };
    let init = match driver.get::<unsafe extern "system" fn(u32) -> i32>(b"cuInit\0") {
        Ok(init) => init,
        Err(e) => return Status::new("driver_error", Some(e.to_string())),
    };
    let code = init(0);
    if code != 0 {
        return Status::new("driver_error", Some(format!("cuInit: {code}")));
    }
    let mut libraries = Vec::new();
    // cuBLAS depends on cuBLASLt, so load it first.
    for name in ["cudart64_13.dll", "cublasLt64_13.dll", "cublas64_13.dll"] {
        let local = engine.join(name);
        let file = if local.is_file() {
            local
        } else {
            PathBuf::from(name)
        };
        match libloading::Library::new(&file) {
            Ok(library) => libraries.push(library),
            Err(e) => return Status::new("runtime_missing", Some(format!("{name}: {e}"))),
        }
    }
    match crate::synthesis_policy::check_cuda(engine) {
        Ok(()) => Status::new("ready", None),
        Err(e) => Status::new("cuda_failed", Some(e)),
    }
}

pub async fn install(
    root: PathBuf,
    cancel: CancellationToken,
    progress: impl Fn(DownloadProgress) + Send + Sync,
    stage: impl Fn(&str),
) -> Result<()> {
    if !cfg!(windows) || !supported_engine() {
        return Err(message("CUDA download is unavailable for this app build"));
    }
    let p = pin();
    let base = root.join("cuda");
    let cache = base.join("downloads");
    fs::create_dir_all(&cache)?;
    crate::download::ensure_space(&cache, required_space(&cache, &p))?;
    let client = reqwest::Client::builder()
        .https_only(true)
        .connect_timeout(Duration::from_secs(30))
        .read_timeout(Duration::from_secs(60))
        .build()?;
    let mut verifier = crate::verification::ModelVerifier::open(&cache);
    let mut archives = Vec::new();
    for c in &p.components {
        let model = crate::manifest::Model {
            file: archive_name(&p, c),
            estimated_bytes: c.bytes,
            sha256: c.sha256.clone(),
            kind: "cuda".into(),
        };
        let archive = crate::download::download_model(
            &client,
            &format!("{}{}", p.base_url, c.path),
            &cache,
            &model,
            &mut verifier,
            &cancel,
            &progress,
        )
        .await?;
        archives.push(archive);
    }
    stage("installing");
    tokio::task::spawn_blocking(move || publish(&base, &p, &archives, &cancel))
        .await
        .map_err(|e| message(e.to_string()))??;
    // Successful installations need no compressed cache; failures retain resumable downloads.
    let _ = fs::remove_dir_all(cache);
    Ok(())
}

fn installation_space(p: &Pin, archives: &[PathBuf]) -> Result<u64> {
    if p.components.len() != archives.len() {
        return Err(message("Incomplete CUDA download"));
    }
    let mut required = SPACE_RESERVE;
    for (component, archive) in p.components.iter().zip(archives) {
        let mut zip =
            zip::ZipArchive::new(fs::File::open(archive)?).map_err(|e| message(e.to_string()))?;
        for (index, _) in selected_entries(&mut zip, component)? {
            let entry = zip.by_index(index).map_err(|e| message(e.to_string()))?;
            required = required.saturating_add(entry.size());
        }
    }
    Ok(required)
}

fn publish(base: &Path, p: &Pin, archives: &[PathBuf], cancel: &CancellationToken) -> Result<()> {
    // Downloads may take long enough for another process to consume disk space.
    // Use actual selected entry sizes here, independently of cache/resume credits.
    crate::download::ensure_space(base, installation_space(p, archives)?)?;
    let name = format!("{}-{}", p.version, uuid::Uuid::new_v4());
    let staging = base.join(&name);
    fs::create_dir(&staging)?;
    let result = (|| {
        for (component, archive) in p.components.iter().zip(archives) {
            extract(archive, &staging, component, cancel)?;
        }
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        fs::write(
            staging.join("complete.json"),
            serde_json::to_vec(&p.version)?,
        )?;
        let temporary = base.join("active.json.tmp");
        fs::write(&temporary, serde_json::to_vec(&name)?)?;
        fs::rename(temporary, base.join("active.json"))?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(staging);
    }
    result
}

fn selected_entries(
    zip: &mut zip::ZipArchive<fs::File>,
    component: &Component,
) -> Result<Vec<(usize, String)>> {
    let wanted = component
        .files
        .iter()
        .map(|file| (file.as_str(), file.clone()))
        .chain(std::iter::once((
            "LICENSE",
            format!("LICENSE-{}.txt", component.name),
        )));
    let mut selected = Vec::new();
    for (name, target) in wanted {
        let matches: Vec<_> = (0..zip.len())
            .filter(|&i| {
                zip.by_index(i).ok().is_some_and(|entry| {
                    entry
                        .enclosed_name()
                        .and_then(|p| p.file_name().map(|n| n == name))
                        .unwrap_or(false)
                        && !entry.is_dir()
                })
            })
            .collect();
        if matches.len() != 1 {
            return Err(message(format!(
                "CUDA archive must contain exactly one {name}"
            )));
        }
        let entry = zip
            .by_index(matches[0])
            .map_err(|e| message(e.to_string()))?;
        if entry.size() > 1024 * 1024 * 1024 {
            return Err(message("CUDA archive entry is too large"));
        }
        selected.push((matches[0], target));
    }
    Ok(selected)
}

fn extract(
    archive: &Path,
    destination: &Path,
    component: &Component,
    cancel: &CancellationToken,
) -> Result<()> {
    let mut zip =
        zip::ZipArchive::new(fs::File::open(archive)?).map_err(|e| message(e.to_string()))?;
    for (index, target) in selected_entries(&mut zip, component)? {
        let mut entry = zip.by_index(index).map_err(|e| message(e.to_string()))?;
        let mut file = fs::File::create(destination.join(target))?;
        let mut buffer = vec![0; 1024 * 1024];
        loop {
            if cancel.is_cancelled() {
                return Err(Error::Cancelled);
            }
            let size = entry.read(&mut buffer)?;
            if size == 0 {
                break;
            }
            file.write_all(&buffer[..size])?;
        }
        file.sync_all()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use zip::write::SimpleFileOptions;

    fn fixture(path: &Path, files: &[(&str, &[u8])]) {
        let mut archive = zip::ZipWriter::new(fs::File::create(path).unwrap());
        for (name, contents) in files {
            archive
                .start_file(*name, SimpleFileOptions::default())
                .unwrap();
            archive.write_all(contents).unwrap();
        }
        archive.finish().unwrap();
    }

    fn component() -> Component {
        Component {
            name: "runtime".into(),
            path: String::new(),
            sha256: String::new(),
            bytes: 0,
            installed_bytes: 0,
            files: vec!["cudart64_13.dll".into()],
        }
    }

    fn test_pin() -> Pin {
        let mut component = component();
        component.bytes = 100;
        component.installed_bytes = 200;
        Pin {
            version: "test".into(),
            base_url: String::new(),
            engine_revision: String::new(),
            archive_sha256: String::new(),
            components: vec![component],
        }
    }

    #[test]
    fn preflight_accounts_for_fresh_resumed_and_cached_downloads() {
        let dir = tempfile::tempdir().unwrap();
        let p = test_pin();
        let archive = dir.path().join("runtime-test.zip");
        let partial = dir.path().join("runtime-test.zip.part");
        assert_eq!(required_space(dir.path(), &p), SPACE_RESERVE + 300);
        fs::write(&partial, [0; 40]).unwrap();
        assert_eq!(required_space(dir.path(), &p), SPACE_RESERVE + 260);
        fs::write(&archive, [0; 100]).unwrap();
        assert_eq!(required_space(dir.path(), &p), SPACE_RESERVE + 200);
        fs::remove_file(archive).unwrap();
        fs::write(&partial, [0; 120]).unwrap();
        assert_eq!(required_space(dir.path(), &p), SPACE_RESERVE + 200);
        fs::rename(partial, dir.path().join("runtime-previous.zip.part")).unwrap();
        fs::write(dir.path().join("runtime-previous.zip"), [0; 100]).unwrap();
        assert_eq!(required_space(dir.path(), &p), SPACE_RESERVE + 300);
    }

    #[test]
    fn fresh_pinned_installation_fits_below_one_gib_including_reserve() {
        let dir = tempfile::tempdir().unwrap();
        let required = required_space(dir.path(), &pin());
        assert_eq!(required, 998_583_053);
        assert!(required < 1024 * 1024 * 1024);
    }

    #[test]
    fn installation_space_uses_actual_selected_entries_including_licenses() {
        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("runtime.zip");
        fixture(
            &archive,
            &[
                ("archive/bin/cudart64_13.dll", b"dll"),
                ("archive/LICENSE", b"license"),
                ("archive/unused.lib", &[0; 1024]),
            ],
        );
        let p = test_pin();
        assert_eq!(
            installation_space(&p, std::slice::from_ref(&archive)).unwrap(),
            SPACE_RESERVE + 10
        );
        assert!(installation_space(&p, &[]).is_err());
        fixture(&archive, &[("archive/bin/cudart64_13.dll", b"dll")]);
        assert!(installation_space(&p, &[archive]).is_err());
    }

    #[test]
    fn extraction_copies_only_required_files_and_license() {
        let dir = tempfile::tempdir().unwrap();
        let zip = dir.path().join("runtime.zip");
        fixture(
            &zip,
            &[
                ("archive/bin/x64/cudart64_13.dll", b"dll"),
                ("archive/LICENSE", b"license"),
                ("archive/bin/nvcc.exe", b"compiler"),
            ],
        );
        extract(&zip, dir.path(), &component(), &CancellationToken::new()).unwrap();
        assert_eq!(
            fs::read(dir.path().join("cudart64_13.dll")).unwrap(),
            b"dll"
        );
        assert_eq!(
            fs::read(dir.path().join("LICENSE-runtime.txt")).unwrap(),
            b"license"
        );
        assert!(!dir.path().join("nvcc.exe").exists());
    }

    #[test]
    fn partial_failed_and_cancelled_installations_never_replace_active_runtime() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("active.json"), b"\"previous\"").unwrap();
        let zip = dir.path().join("runtime.zip");
        fixture(&zip, &[("archive/cudart64_13.dll", b"dll")]);
        let p = Pin {
            version: "test".into(),
            base_url: String::new(),
            engine_revision: String::new(),
            archive_sha256: String::new(),
            components: vec![component()],
        };
        assert!(publish(
            dir.path(),
            &p,
            std::slice::from_ref(&zip),
            &CancellationToken::new()
        )
        .is_err());
        assert_eq!(
            fs::read(dir.path().join("active.json")).unwrap(),
            b"\"previous\""
        );
        fixture(
            &zip,
            &[
                ("archive/cudart64_13.dll", b"dll"),
                ("archive/LICENSE", b"license"),
            ],
        );
        let cancel = CancellationToken::new();
        cancel.cancel();
        assert!(matches!(
            publish(dir.path(), &p, std::slice::from_ref(&zip), &cancel),
            Err(Error::Cancelled)
        ));
        assert_eq!(
            fs::read(dir.path().join("active.json")).unwrap(),
            b"\"previous\""
        );
        publish(dir.path(), &p, &[zip], &CancellationToken::new()).unwrap();
        let active: String =
            serde_json::from_slice(&fs::read(dir.path().join("active.json")).unwrap()).unwrap();
        assert!(dir.path().join(active).join("complete.json").is_file());
    }

    #[test]
    fn duplicate_and_traversing_entries_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let zip = dir.path().join("runtime.zip");
        for entries in [
            vec![("../cudart64_13.dll", b"dll".as_slice())],
            vec![
                ("a/cudart64_13.dll", b"dll".as_slice()),
                ("b/cudart64_13.dll", b"dll".as_slice()),
            ],
        ] {
            fixture(&zip, &entries);
            assert!(extract(&zip, dir.path(), &component(), &CancellationToken::new()).is_err());
        }
    }

    #[test]
    fn activation_requires_a_complete_matching_installation_and_a_local_path() {
        let _windows_check: unsafe fn(&Path) -> Status = check;
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().join("cuda");
        fs::create_dir(&base).unwrap();
        for name in ["../outside", "C:\\outside", ".", ""] {
            fs::write(base.join("active.json"), serde_json::to_vec(name).unwrap()).unwrap();
            assert!(installed(dir.path()).is_none());
        }
        let folder = base.join("valid");
        fs::create_dir(&folder).unwrap();
        fs::write(base.join("active.json"), b"\"valid\"").unwrap();
        assert!(installed(dir.path()).is_none());
        fs::write(
            folder.join("complete.json"),
            serde_json::to_vec(&pin().version).unwrap(),
        )
        .unwrap();
        for file in pin().components.iter().flat_map(|c| &c.files) {
            fs::write(folder.join(file), b"dll").unwrap();
        }
        assert_eq!(installed(dir.path()), Some(folder));
        assert!(supported_engine());
    }

    #[cfg(windows)]
    #[test]
    fn managed_runtime_is_added_only_to_child_environment() {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join("cuda/13.0.0-test");
        fs::create_dir_all(&folder).unwrap();
        fs::write(root.path().join("cuda/active.json"), b"\"13.0.0-test\"").unwrap();
        fs::write(
            folder.join("complete.json"),
            serde_json::to_vec(&pin().version).unwrap(),
        )
        .unwrap();
        for file in pin().components.iter().flat_map(|c| &c.files) {
            fs::write(folder.join(file), b"dll").unwrap();
        }
        let original = std::env::var_os("PATH");
        let mut command = Command::new("ace-server.exe");
        configure_command(&mut command, root.path());
        let path = command
            .get_envs()
            .find(|(key, _)| *key == "PATH")
            .unwrap()
            .1
            .unwrap();
        assert_eq!(std::env::split_paths(path).next(), Some(folder));
        assert_eq!(std::env::var_os("PATH"), original);
    }
}
