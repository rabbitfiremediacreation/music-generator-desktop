use crate::error::{message, Result};
use std::{
    io::Read,
    path::Path,
    process::{Child, Command, Stdio},
    time::Duration,
};

pub struct OwnedProcess {
    child: Child,
}

impl OwnedProcess {
    pub fn spawn(engine: &Path, args: &[String], cpu: bool, log: &Path) -> Result<Self> {
        let stdout = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(log)?;
        let executable = std::env::current_exe()?;
        #[cfg(target_os = "macos")]
        let executable = {
            let helper = executable.with_file_name("music-engine-supervisor");
            if helper.is_file() {
                helper
            } else {
                executable
            }
        };
        let mut command = Command::new(executable);
        // All owned engines log under the app data root's logs/ directory.
        if let Some(root) = log.parent().and_then(Path::parent) {
            crate::cuda_runtime::configure_command(&mut command, root);
        }
        #[cfg(target_os = "macos")]
        if let Some(index) = args.iter().position(|a| a == "--models" || a == "--model") {
            if let Some(models) = args.get(index + 1) {
                command.env(
                    "MUSIC_MODEL_BOOKMARK",
                    crate::sandbox::transfer(Path::new(models))?,
                );
            }
        }
        command
            .arg("--engine-supervisor")
            .arg(engine)
            .args(args)
            .current_dir(
                engine
                    .parent()
                    .ok_or_else(|| message("Invalid engine location"))?,
            )
            .stdin(Stdio::piped())
            .stdout(stdout.try_clone()?)
            .stderr(stdout);
        if cpu {
            command.env("GGML_BACKEND", "CPU");
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        Ok(Self {
            child: command.spawn()?,
        })
    }
    pub fn alive(&mut self) -> Result<bool> {
        Ok(self.child.try_wait()?.is_none())
    }
    pub fn status(&mut self) -> Result<Option<std::process::ExitStatus>> {
        Ok(self.child.try_wait()?)
    }
}

impl Drop for OwnedProcess {
    fn drop(&mut self) {
        // Closing the control pipe also stops the engine when the GUI crashes.
        drop(self.child.stdin.take());
        for _ in 0..60 {
            if self.child.try_wait().ok().flatten().is_some() {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub fn supervise() -> Option<i32> {
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--engine-supervisor")) {
        return None;
    }
    let Some(engine) = args.next() else {
        return Some(2);
    };
    let mut command = Command::new(engine);
    command.args(args).stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(e) => {
            eprintln!("Engine launch: {e}");
            return Some(1);
        }
    };
    let (send, receive) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = std::io::stdin().read(&mut [0u8; 1]);
        let _ = send.send(());
    });
    loop {
        if let Ok(Some(status)) = child.try_wait() {
            return Some(status.code().unwrap_or(1));
        }
        if receive.recv_timeout(Duration::from_millis(100)).is_ok() {
            let _ = child.kill();
            let _ = child.wait();
            return Some(0);
        }
    }
}
