use super::{validate_png, SIDE};
use crate::error::{message, Error, Result};
use std::{
    path::Path,
    process::{Output, Stdio},
    time::Duration,
};
use tokio::{io::AsyncReadExt, process::Command};
use tokio_util::sync::CancellationToken;

pub(super) const MAX_PNG_BYTES: u64 = 4 * 1024 * 1024;

pub(super) async fn device(
    executable: &Path,
    root: &Path,
    prefix: &str,
    cancel: &CancellationToken,
) -> Result<String> {
    let mut command = command(executable, root);
    command.arg("--list-devices");
    let output = run(&mut command, Duration::from_secs(15), cancel).await?;
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.split_once('\t'))
        .map(|(name, _)| name.trim())
        .find(|name| name.to_ascii_lowercase().starts_with(prefix))
        .map(|name| {
            if prefix == "cpu" {
                "cpu".into()
            } else {
                name.to_owned()
            }
        })
        .ok_or_else(|| message(format!("Cover engine did not detect a {prefix} device")))
}

pub(super) async fn render(
    root: &Path,
    executable: &Path,
    model: &Path,
    backend: &str,
    prompt: &str,
    seed: i64,
    cancel: &CancellationToken,
) -> Result<Vec<u8>> {
    let staging = tempfile::Builder::new()
        .prefix("render-")
        .tempdir_in(root)?;
    let image = staging.path().join("cover.png");
    let side = SIDE.to_string();
    let mut command = command(executable, root);
    command
        .arg("-m")
        .arg(
            model
                .file_name()
                .ok_or_else(|| message("Missing cover model name"))?,
        )
        .args([
            "-p",
            prompt,
            "--width",
            &side,
            "--height",
            &side,
            "--steps",
            "1",
            "--cfg-scale",
            "1",
            "--sampling-method",
            "euler_a",
            "--scheduler",
            "discrete",
            "--seed",
            &seed.to_string(),
            "--backend",
            backend,
            "-o",
        ])
        .arg(
            image
                .strip_prefix(root)
                .map_err(|error| message(error.to_string()))?,
        );
    if backend == "cpu" {
        command.args(["--auto-fit", "off"]);
    }
    run(&mut command, Duration::from_secs(180), cancel).await?;
    let mut bytes = Vec::new();
    tokio::fs::File::open(image)
        .await?
        .take(MAX_PNG_BYTES + 1)
        .read_to_end(&mut bytes)
        .await?;
    if bytes.len() as u64 > MAX_PNG_BYTES {
        return Err(message("Cover engine returned an oversized PNG"));
    }
    validate_png(&bytes)?;
    Ok(bytes)
}

fn command(executable: &Path, root: &Path) -> Command {
    let mut command = Command::new(executable);
    command
        .current_dir(root)
        .kill_on_drop(true)
        .stdin(Stdio::null());
    #[cfg(target_os = "linux")]
    if let Some(parent) = executable.parent() {
        command.env("LD_LIBRARY_PATH", parent);
    }
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    command
}

async fn run(
    command: &mut Command,
    timeout: Duration,
    cancel: &CancellationToken,
) -> Result<Output> {
    let output = tokio::select! {
        biased;
        _ = cancel.cancelled() => return Err(Error::Cancelled),
        result = tokio::time::timeout(timeout, command.output()) =>
            result.map_err(|_| message("Cover engine timed out"))?.map_err(|error| {
                if error.kind() == std::io::ErrorKind::PermissionDenied {
                    message("cover_art_engine_denied")
                } else {
                    Error::Io(error)
                }
            })?,
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail: String = stderr
            .lines()
            .last()
            .unwrap_or_default()
            .chars()
            .take(300)
            .collect();
        return Err(message(format!(
            "Cover engine exited with {}. {tail}",
            output.status
        )));
    }
    Ok(output)
}
