use crate::error::{message, Error, Result};
use std::{path::Path, time::Duration};
use tokio_util::sync::CancellationToken;

// Older engines use GGML_BACKEND; newer engines also require an explicit device flag.
pub async fn cpu_arguments(binary: &Path, cancel: &CancellationToken) -> Result<Vec<String>> {
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    let mut command = super::process::probe_command(binary)?;
    if let Some(folder) = binary.parent() {
        command.current_dir(folder);
    }
    command
        .arg("--help")
        .kill_on_drop(true)
        .env("GGML_BACKEND", "CPU");
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let output = tokio::select! {
        _ = cancel.cancelled() => return Err(Error::Cancelled),
        output = tokio::time::timeout(Duration::from_secs(5), command.output()) => output,
    };
    let output = output.map_err(|_| {
        message("Language model device detection timed out. Retry the hardware test.")
    })??;
    let supported = {
        let help = format!(
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        help.split_whitespace().any(|word| {
            let word = word.trim_matches(['[', ']', '(', ')', ',']);
            word == "--device" || word.starts_with("--device=")
        })
    };
    Ok(if supported {
        vec!["--device".into(), "CPU".into()]
    } else {
        Vec::new()
    })
}
