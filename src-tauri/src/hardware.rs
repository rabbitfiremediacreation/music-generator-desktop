use serde::Serialize;
use std::{process::Command, sync::OnceLock};
use sysinfo::{MemoryRefreshKind, System};

#[derive(Debug, Clone, Serialize)]
pub struct Hardware {
    pub ram_bytes: u64,
    pub gpu: String,
    pub vram_bytes: Option<u64>,
    pub recommended_lm: String,
    pub vae_chunk: Option<u32>,
    pub platform: &'static str,
    pub cpu_only: bool,
}

pub fn cpu_only_target(os: &str, arch: &str) -> bool {
    os == "macos" && arch == "x86_64"
}

pub fn cpu_only() -> bool {
    cpu_only_target(std::env::consts::OS, std::env::consts::ARCH)
}

pub fn recommend(ram: u64, vram: Option<u64>) -> (&'static str, Option<u32>) {
    let gb = 1024 * 1024 * 1024;
    let ram_gb = ram / gb;
    let ram_size = if ram_gb < 12 {
        0
    } else if ram_gb < 24 {
        1
    } else {
        2
    };
    let gpu_size = vram
        .map(|v| {
            if v / gb < 6 {
                0
            } else if v / gb < 8 {
                1
            } else {
                2
            }
        })
        .unwrap_or(2);
    let size = ["0.6B", "1.7B", "4B"][ram_size.min(gpu_size)];
    let chunk = if cfg!(target_os = "macos") {
        if ram_gb < 12 {
            Some(256)
        } else if ram_gb < 16 {
            Some(512)
        } else {
            None
        }
    } else if let Some(v) = vram {
        if v / gb < 8 {
            Some(128)
        } else if v / gb < 12 {
            Some(256)
        } else if v / gb < 16 {
            Some(512)
        } else {
            None
        }
    } else {
        Some(256)
    };
    (size, chunk)
}

/// Hardware capacity is stable for an app session; ordinary commands reuse this snapshot.
pub fn inspect() -> &'static Hardware {
    static SNAPSHOT: OnceLock<Hardware> = OnceLock::new();
    SNAPSHOT.get_or_init(detect)
}

fn detect() -> Hardware {
    let mut sys = System::new();
    sys.refresh_memory_specifics(MemoryRefreshKind::nothing().with_ram());
    let ram = sys.total_memory();
    let (gpu, vram) = adapter();
    let (lm, chunk) = recommend(ram, vram);
    Hardware {
        ram_bytes: ram,
        gpu,
        vram_bytes: vram,
        recommended_lm: lm.into(),
        vae_chunk: chunk,
        platform: std::env::consts::OS,
        cpu_only: cpu_only(),
    }
}

fn output(program: &str, args: &[&str]) -> Option<String> {
    crate::process_output::output(
        Command::new(program).args(args),
        std::time::Duration::from_secs(3),
    )
}

fn adapter() -> (String, Option<u64>) {
    if cfg!(target_os = "macos") {
        let chip = output("/usr/sbin/sysctl", &["-n", "machdep.cpu.brand_string"])
            .unwrap_or_else(|| std::env::consts::ARCH.into());
        return (
            format!(
                "{chip} · {}",
                if cpu_only() { "CPU" } else { "Metal / CPU" }
            ),
            None,
        );
    }
    if let Some(text) = output(
        "nvidia-smi",
        &[
            "--query-gpu=name,memory.total",
            "--format=csv,noheader,nounits",
        ],
    ) {
        if let Some((name, memory)) = text.lines().next().and_then(|l| l.rsplit_once(',')) {
            return (
                format!("{} · CUDA / Vulkan / CPU", name.trim()),
                memory.trim().parse::<u64>().ok().map(|m| m * 1024 * 1024),
            );
        }
    }
    #[cfg(windows)]
    {
        if let Some(name) = output(
            "powershell.exe",
            &[
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "(Get-CimInstance Win32_VideoController).Name -join ', '",
            ],
        ) {
            return (format!("{name} · Vulkan / CPU"), None);
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(entries) = std::fs::read_dir("/sys/class/drm") {
            for entry in entries.flatten() {
                if let Ok(bytes) =
                    std::fs::read_to_string(entry.path().join("device/mem_info_vram_total"))
                {
                    return ("AMD · Vulkan / CPU".into(), bytes.trim().parse().ok());
                }
            }
        }
    }
    ("Vulkan if available; CPU fallback".into(), None)
}

#[cfg(test)]
mod tests {
    #[test]
    fn settings_and_admission_share_one_immutable_hardware_snapshot() {
        let snapshot = super::inspect();
        assert!(std::ptr::eq(snapshot, super::inspect()));
        assert!(
            std::thread::spawn(move || std::ptr::eq(snapshot, super::inspect()))
                .join()
                .unwrap()
        );
    }
}
