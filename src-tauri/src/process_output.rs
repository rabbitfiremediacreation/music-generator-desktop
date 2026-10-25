use std::{
    io::Read,
    process::{Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};

/// Bound probe runtime and output size, and reap timed-out children before returning.
pub fn output(command: &mut Command, timeout: Duration) -> Option<String> {
    let started = Instant::now();
    command.stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().ok()?;
    let stdout = child.stdout.take()?;
    let (send, receive) = mpsc::channel();
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = stdout
            .take(64 * 1024)
            .read_to_end(&mut bytes)
            .map(|_| bytes);
        let _ = send.send(result);
    });
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if started.elapsed() < timeout => {
                std::thread::sleep(Duration::from_millis(10))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                tracing::warn!(program = ?command.get_program(), "Startup probe failed or timed out");
                break None;
            }
        }
    }?;
    let bytes = receive
        .recv_timeout(Duration::from_millis(100))
        .ok()?
        .ok()?;
    status
        .success()
        .then(|| String::from_utf8_lossy(&bytes).trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(mode: &str) -> Command {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--ignored",
                "--exact",
                "process_output::tests::probe_fixture",
                "--nocapture",
            ])
            .env("MUSIC_STARTUP_PROBE_TEST", mode);
        command
    }

    #[test]
    #[ignore = "subprocess fixture for bounded startup probes"]
    fn probe_fixture() {
        match std::env::var("MUSIC_STARTUP_PROBE_TEST").as_deref() {
            Ok("slow") => std::thread::sleep(Duration::from_secs(10)),
            Ok("failure") => std::process::exit(1),
            _ => println!("startup-probe-ok"),
        }
    }

    #[test]
    fn captures_successful_output_and_rejects_failed_probes() {
        assert!(output(&mut fixture("success"), Duration::from_secs(3))
            .unwrap()
            .contains("startup-probe-ok"));
        assert!(output(&mut fixture("failure"), Duration::from_secs(3)).is_none());
    }

    #[test]
    fn kills_and_reaps_a_slow_probe() {
        let started = Instant::now();
        assert!(output(&mut fixture("slow"), Duration::from_millis(100)).is_none());
        assert!(started.elapsed() < Duration::from_secs(3));
    }
}
