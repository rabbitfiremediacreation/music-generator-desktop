use crate::{
    download::DownloadProgress,
    error::{message, Error, Result},
    state::AppState,
};
use serde_json::Value;
use std::{
    ffi::{OsStr, OsString},
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio_util::sync::CancellationToken;

const RUNNER: &[u8] = include_bytes!("../../../scripts/desktop/stems-runtime/runner.py");
const PACKAGES: &[&str] = &["demucs==4.0.1", "safetensors==0.6.2", "soundfile==0.13.1"];

pub fn supported() -> bool {
    cfg!(any(
        all(target_os = "macos", target_arch = "aarch64"),
        all(
            any(target_os = "linux", target_os = "windows"),
            target_arch = "x86_64"
        )
    ))
}

fn directory(root: &Path) -> PathBuf {
    root.join("stem-runtime").join("demucs-4.0.1")
}

fn python(env: &Path) -> PathBuf {
    env.join(if cfg!(windows) {
        "Scripts/python.exe"
    } else {
        "bin/python"
    })
}

const BUNDLED_ENTRY: &str = "engine/pytorch/stem-runner";

fn bundled_runner(state: &AppState) -> Option<PathBuf> {
    if !cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        return None;
    }
    let resources = crate::engine_packages::resources_for(
        &state.resources,
        &state.db.root,
        Path::new(BUNDLED_ENTRY),
    );
    let executable = resources.join(BUNDLED_ENTRY);
    (executable.is_file()
        && std::fs::read(executable.with_file_name("stem_runner.py"))
            .is_ok_and(|bytes| bytes == RUNNER))
    .then_some(executable)
}

pub fn external_python_required(state: &AppState) -> bool {
    !(cfg!(all(target_os = "macos", target_arch = "aarch64"))
        && (bundled_runner(state).is_some() || crate::engine_packages::contains("pytorch")))
}

pub fn installed(state: &AppState) -> bool {
    if !external_python_required(state) {
        return bundled_runner(state).is_some();
    }
    runtime_installed(&state.db.root)
}

fn runtime_installed(root: &Path) -> bool {
    let dir = directory(root);
    supported()
        && python(&dir).is_file()
        && std::fs::read(dir.join("runner.py")).is_ok_and(|bytes| bytes == RUNNER)
        && dir.join("ready").is_file()
        && {
            let lib = if cfg!(windows) {
                dir.join("Lib/site-packages")
            } else {
                dir.join("lib/python3.12/site-packages")
            };
            [
                "demucs/__init__.py",
                "torch/__init__.py",
                "soundfile.py",
                "safetensors/__init__.py",
            ]
            .iter()
            .all(|module| lib.join(module).is_file())
        }
}

fn command(program: impl AsRef<OsStr>, args: &[OsString]) -> tokio::process::Command {
    let mut child = tokio::process::Command::new(program);
    child
        .args(args)
        .kill_on_drop(true)
        .env_remove("PYTHONPATH")
        .env_remove("PYTHONHOME")
        .env_remove("HF_TOKEN")
        .env_remove("HUGGING_FACE_HUB_TOKEN");
    #[cfg(windows)]
    child.creation_flags(0x08000000);
    child
}

async fn run(
    root: &Path,
    mut command: tokio::process::Command,
    cancel: &CancellationToken,
    timeout: Duration,
    event: impl Fn(Value),
    error: &'static str,
) -> Result<()> {
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    let logs = root.join("logs");
    std::fs::create_dir_all(&logs)?;
    let log = std::fs::OpenOptions::new()
        .append(true)
        .create(true)
        .open(logs.join("stem-separation.log"))?;
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(log)
        .spawn()
        .map_err(|_| message(error))?;
    let mut lines = BufReader::new(child.stdout.take().expect("captured stdout")).lines();
    let wait = async {
        while let Some(line) = lines.next_line().await? {
            if let Ok(value) = serde_json::from_str(&line) {
                event(value);
            }
        }
        child.wait().await
    };
    tokio::select! {
        _ = cancel.cancelled() => { let _ = child.kill().await; Err(Error::Cancelled) },
        result = tokio::time::timeout(timeout, wait) => match result {
            Ok(Ok(status)) if status.success() => Ok(()),
            Err(_) => { let _ = child.kill().await; Err(message("stem_engine_timeout")) },
            _ => Err(message(error)),
        },
    }
}

async fn bootstrap(root: &Path, env: &Path, cancel: &CancellationToken) -> Result<()> {
    let candidates: &[(&str, &[&str])] = if cfg!(windows) {
        &[("py", &["-3.12"]), ("python3.12", &[])]
    } else if cfg!(target_os = "macos") {
        &[
            ("/opt/homebrew/bin/python3.12", &[]),
            ("/usr/local/bin/python3.12", &[]),
            ("python3.12", &[]),
        ]
    } else {
        &[("python3.12", &[])]
    };
    for (program, flags) in candidates {
        let args: Vec<OsString> = flags
            .iter()
            .map(OsString::from)
            .chain(["-I", "-m", "venv", "--copies"].map(OsString::from))
            .chain([env.as_os_str().to_owned()])
            .collect();
        match run(
            root,
            command(program, &args),
            cancel,
            Duration::from_secs(90),
            |_| {},
            "stem_python_missing",
        )
        .await
        {
            Ok(()) => return Ok(()),
            Err(Error::Cancelled) => return Err(Error::Cancelled),
            Err(_) => {}
        }
    }
    Err(message("stem_python_missing"))
}

async fn pip(
    root: &Path,
    env: &Path,
    index: &str,
    packages: &[&str],
    cancel: &CancellationToken,
) -> Result<()> {
    let args: Vec<OsString> = [
        "-I",
        "-m",
        "pip",
        "--isolated",
        "--disable-pip-version-check",
        "--no-input",
        "--no-cache-dir",
        "install",
        "--index-url",
        index,
    ]
    .into_iter()
    .chain(packages.iter().copied())
    .map(OsString::from)
    .collect();
    let mut child = command(python(env), &args);
    child.env(
        "PIP_CONFIG_FILE",
        if cfg!(windows) { "NUL" } else { "/dev/null" },
    );
    run(
        root,
        child,
        cancel,
        Duration::from_secs(1200),
        |_| {},
        "stem_engine_install_failed",
    )
    .await
}

pub async fn install(
    state: &AppState,
    cancel: &CancellationToken,
    progress: impl Fn(DownloadProgress) + Send + Sync,
) -> Result<()> {
    if installed(state) {
        return Ok(());
    }
    if !external_python_required(state) {
        let transfer = state.runtime.transfer("engines", "pytorch")?;
        crate::engine_packages::install_background(state, "pytorch", cancel, progress).await?;
        drop(transfer);
        if bundled_runner(state).is_none() {
            return Err(message("stem_engine_install_failed"));
        }
        return Ok(());
    }
    let root = &state.db.root;
    crate::download::queue::external(
        "Demucs · Python",
        &directory(root),
        cancel,
        async |cancel| install_python(root, cancel).await,
    )
    .await
}

async fn install_python(root: &Path, cancel: &CancellationToken) -> Result<()> {
    if !supported() {
        return Err(message("stem_platform_unsupported"));
    }
    if runtime_installed(root) {
        return Ok(());
    }
    let target = directory(root);
    let home = target.parent().expect("runtime directory");
    std::fs::create_dir_all(home)?;
    if python(&target).is_file() && target.join("ready").is_file() {
        // App updates can replace the adapter while retaining its versioned Python dependencies.
        crate::paths::write_private(&target.join("runner.py"), RUNNER)?;
        let result = run(
            root,
            adapter_command(&target, "probe", &[]),
            cancel,
            Duration::from_secs(30),
            |_| {},
            "stem_engine_install_failed",
        )
        .await;
        if result.is_err() {
            let _ = std::fs::remove_file(target.join("ready"));
        }
        return result;
    }
    crate::download::ensure_space(home, 2 * 1024 * 1024 * 1024)?;
    let staging = tempfile::Builder::new()
        .prefix(".install-")
        .tempdir_in(home)?;
    let env = staging.path().join("runtime");
    bootstrap(root, &env, cancel).await?;
    let index = if cfg!(target_os = "macos") {
        "https://pypi.org/simple/"
    } else {
        "https://download.pytorch.org/whl/cpu"
    };
    pip(
        root,
        &env,
        index,
        &["torch==2.8.0", "torchaudio==2.8.0"],
        cancel,
    )
    .await?;
    pip(root, &env, "https://pypi.org/simple/", PACKAGES, cancel).await?;
    std::fs::write(env.join("runner.py"), RUNNER)?;
    run(
        root,
        adapter_command(&env, "probe", &[]),
        cancel,
        Duration::from_secs(30),
        |_| {},
        "stem_engine_install_failed",
    )
    .await?;
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    std::fs::write(env.join("ready"), b"demucs 4.0.1")?;
    if target.exists() {
        std::fs::remove_dir_all(&target)?;
    }
    std::fs::rename(&env, target)?;
    Ok(())
}

fn adapter_command(env: &Path, action: &str, args: &[OsString]) -> tokio::process::Command {
    let args: Vec<_> = [
        OsString::from("-I"),
        env.join("runner.py").into_os_string(),
        action.into(),
    ]
    .into_iter()
    .chain(args.iter().cloned())
    .collect();
    let mut child = command(python(env), &args);
    child.env("MUSIC_STEM_LIFELINE", "1");
    child
}

pub async fn execute(
    state: &AppState,
    action: &str,
    args: &[OsString],
    cancel: &CancellationToken,
    timeout: Duration,
    event: impl Fn(Value),
    error: &'static str,
) -> Result<()> {
    if !installed(state) {
        return Err(message("stem_engine_missing"));
    }
    let root = &state.db.root;
    #[cfg(target_os = "macos")]
    if let Some(executable) = bundled_runner(state) {
        let mut child = crate::engine::process::plugin_command(&executable)?;
        child.arg(action).args(args).kill_on_drop(true);
        return run(root, child, cancel, timeout, event, error).await;
    }
    run(
        root,
        adapter_command(&directory(root), action, args),
        cancel,
        timeout,
        event,
        error,
    )
    .await
}

pub async fn check_weights(
    state: &AppState,
    weights: &Path,
    roles: &[&str],
    cancel: &CancellationToken,
) -> Result<()> {
    let local = if external_python_required(state) {
        None
    } else {
        let folder = tempfile::tempdir_in(&state.db.root)?;
        let path = folder.path().join("weights.safetensors");
        crate::download::ensure_space(folder.path(), weights.metadata()?.len())?;
        tokio::select! {
            _ = cancel.cancelled() => return Err(Error::Cancelled),
            copied = tokio::fs::copy(weights, &path) => { copied?; }
        }
        Some((folder, path))
    };
    let weights = local.as_ref().map_or(weights, |(_, path)| path.as_path());
    let args: Vec<_> = std::iter::once(weights.as_os_str().to_owned())
        .chain(roles.iter().map(OsString::from))
        .collect();
    execute(
        state,
        "check",
        &args,
        cancel,
        Duration::from_secs(120),
        |_| {},
        "stem_model_incompatible",
    )
    .await
}

#[cfg(all(test, unix))]
pub(super) fn test_runtime(root: &Path, prepared: &Path) -> Result<()> {
    let dir = directory(root);
    std::fs::create_dir_all(&dir)?;
    for entry in std::fs::read_dir(prepared)? {
        let entry = entry?;
        if !matches!(entry.file_name().to_str(), Some("runner.py" | "ready")) {
            std::os::unix::fs::symlink(entry.path(), dir.join(entry.file_name()))?;
        }
    }
    std::fs::write(dir.join("runner.py"), RUNNER)?;
    std::fs::write(dir.join("ready"), b"demucs 4.0.1")?;
    Ok(())
}
