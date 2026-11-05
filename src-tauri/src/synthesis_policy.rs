//! Model-free device detection, isolated from the GUI because GPU drivers can crash or hang.
use crate::engine::backend_status::Backend as BackendKind;
use crate::{catalog::Selection, form_preferences::GenerationFormPreferences};
use serde::{Deserialize, Serialize};
use std::{path::Path, process::Command, sync::Mutex, time::Duration};

mod ggml;
#[cfg(target_os = "macos")]
mod macos;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Backend {
    Cpu,
    Gpu,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct Detection {
    backend: Backend,
    kind: BackendKind,
}

impl Detection {
    fn new(kind: BackendKind) -> Self {
        Self {
            backend: match kind {
                BackendKind::Cpu => Backend::Cpu,
                BackendKind::Cuda | BackendKind::Vulkan | BackendKind::Metal => Backend::Gpu,
                BackendKind::Unknown => Backend::Unknown,
            },
            kind,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct Policy {
    pub backend: Backend,
    pub probed_backend: Backend,
    /// Independently probed availability, never an unconfirmed inference observation.
    pub detected_backend: BackendKind,
    pub lm_device: String,
    pub backend_status: crate::engine::backend_status::BackendStatus,
    pub cpu_iteration_behavior: crate::types::CpuIterationBehavior,
    pub legacy_inference_steps: u32,
    pub recommended_steps: u32,
    pub defaults: GenerationFormPreferences,
}

pub fn policy(backend: Backend, selection: &Selection) -> Policy {
    let steps = crate::catalog::catalog()
        .models
        .iter()
        .find(|m| {
            m.provider == selection.provider
                && m.file == selection.synthesis
                && m.role == "synthesis"
        })
        .and_then(|m| m.recommended_steps)
        .unwrap_or(80);
    let recommended_steps = recommended_steps(backend, steps);
    Policy {
        backend,
        probed_backend: backend,
        detected_backend: if backend == Backend::Cpu {
            BackendKind::Cpu
        } else {
            BackendKind::Unknown
        },
        lm_device: "auto".into(),
        backend_status: crate::engine::backend_status::BackendStatus::inactive(false),
        cpu_iteration_behavior: Default::default(),
        legacy_inference_steps: crate::generation_limits::effective_steps(
            None,
            &selection.synthesis,
        ),
        recommended_steps,
        defaults: GenerationFormPreferences {
            inference_steps: recommended_steps,
            ..Default::default()
        },
    }
}

pub fn session_policy(
    probed: Backend,
    selection: &Selection,
    status: &crate::engine::backend_status::BackendStatus,
) -> Policy {
    let mut result = policy(observed_backend(status).unwrap_or(probed), selection);
    result.probed_backend = probed;
    result.backend_status = status.clone();
    result
}

/// Only current synthesis execution can override device availability; LM placement is independent.
fn observed_backend(status: &crate::engine::backend_status::BackendStatus) -> Option<Backend> {
    use crate::engine::backend_status::{Backend as Observed, EngineState, ObservationState};
    if status.state != EngineState::Running || status.synthesis.state != ObservationState::Confirmed
    {
        return None;
    }
    match status.synthesis.backend {
        Observed::Cuda | Observed::Vulkan | Observed::Metal => Some(Backend::Gpu),
        Observed::Cpu => Some(Backend::Cpu),
        Observed::Unknown => None,
    }
}

pub fn recommended_steps(backend: Backend, steps: u32) -> u32 {
    if backend == Backend::Gpu {
        steps
    } else {
        steps.min(30)
    }
}

#[derive(Default)]
pub struct Probe(Mutex<Option<Detection>>, Option<std::path::PathBuf>);

impl Probe {
    pub fn with_data_root(root: std::path::PathBuf) -> Self {
        Self(Mutex::new(None), Some(root))
    }
    pub fn session_policy(
        &self,
        resources: &Path,
        selection: &Selection,
        refresh: bool,
        status: impl Fn() -> crate::engine::backend_status::BackendStatus,
    ) -> Policy {
        let probed = if observed_backend(&status()).is_some() {
            self.cached()
        } else {
            self.inspect(resources, refresh)
        };
        let mut policy = session_policy(probed, selection, &status());
        policy.detected_backend = self.cached_detection().kind;
        policy
    }

    pub fn cached(&self) -> Backend {
        self.cached_detection().backend
    }

    fn cached_detection(&self) -> Detection {
        if crate::hardware::cpu_only() {
            Detection::new(BackendKind::Cpu)
        } else {
            self.0
                .try_lock()
                .ok()
                .and_then(|value| *value)
                .unwrap_or(Detection::new(BackendKind::Unknown))
        }
    }

    pub fn inspect(&self, resources: &Path, refresh: bool) -> Backend {
        if crate::hardware::cpu_only() {
            return Backend::Cpu;
        }
        let mut cached = self.0.lock().unwrap();
        if !refresh {
            if let Some(backend) = *cached {
                return backend.backend;
            }
        }
        let backend = self
            .run(resources)
            .unwrap_or(Detection::new(BackendKind::Unknown));
        *cached = Some(backend);
        backend.backend
    }

    fn run(&self, resources: &Path) -> Option<Detection> {
        let executable = std::env::current_exe().ok()?;
        #[cfg(target_os = "macos")]
        let executable = {
            let helper = executable.with_file_name("music-engine-supervisor");
            if helper.is_file() {
                helper
            } else {
                executable
            }
        };
        let engine = resources.join("engine");
        let mut command = Command::new(executable);
        command
            .arg("--synthesis-backend-probe")
            .arg(&engine)
            .arg("--details")
            .current_dir(&engine);
        if let Some(root) = &self.1 {
            crate::cuda_runtime::configure_command(&mut command, root);
        }
        let output = crate::process_output::output(&mut command, Duration::from_secs(5))?;
        output
            .lines()
            .rev()
            .find_map(|line| serde_json::from_str(line).ok())
    }
}

#[cfg(any(windows, test))]
pub(crate) unsafe fn check_cuda(folder: &Path) -> std::result::Result<(), String> {
    ggml::detect_device(folder, false, true)
        .map_err(|e| e.to_string())
        .and_then(|d| {
            if d.kind == BackendKind::Cuda {
                Ok(())
            } else {
                Err("CUDA device could not be initialized".into())
            }
        })
}

/// Run before Tauri/single-instance initialization, also in the sandboxed supervisor.
pub fn cli() -> Option<i32> {
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--synthesis-backend-probe")) {
        return None;
    }
    let folder = args.next();
    let options: Vec<_> = args.collect();
    let details = options.iter().any(|option| option == "--details");
    let result = folder.and_then(|folder| {
        let cpu = options.iter().any(|option| option == "--cpu");
        // SAFETY: only the pinned engine's GGML C ABI is loaded, in this disposable child.
        unsafe { ggml::detect(Path::new(&folder), cpu).ok() }
    });
    match result {
        Some(backend) => {
            let result = if details {
                serde_json::to_string(&backend)
            } else {
                serde_json::to_string(&backend.backend)
            };
            println!("{}", result.unwrap());
            Some(0)
        }
        None => Some(1),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn model_recommendations_are_capped_only_for_cpu_or_unknown() {
        let mut selection = Selection::from_settings(&Default::default());
        for backend in [Backend::Cpu, Backend::Unknown, Backend::Gpu] {
            assert_eq!(
                policy(backend, &selection).recommended_steps,
                if backend == Backend::Gpu { 80 } else { 30 }
            );
        }
        selection.synthesis = "acestep-v15-turbo-shift3-Q6_K.gguf".into();
        for backend in [Backend::Cpu, Backend::Unknown, Backend::Gpu] {
            assert_eq!(policy(backend, &selection).defaults.inference_steps, 8);
        }
    }
    #[test]
    fn missing_runtime_is_unknown_and_never_assumed_gpu() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(Probe::default().run(dir.path()), None);
    }
}
