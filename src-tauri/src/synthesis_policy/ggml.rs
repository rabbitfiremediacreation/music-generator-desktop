use super::{BackendKind, Detection};
use std::path::Path;

pub(super) unsafe fn detect(
    folder: &Path,
    force_cpu: bool,
) -> std::result::Result<Detection, Box<dyn std::error::Error>> {
    detect_device(folder, force_cpu, false)
}

pub(super) unsafe fn detect_device(
    folder: &Path,
    force_cpu: bool,
    force_cuda: bool,
) -> std::result::Result<Detection, Box<dyn std::error::Error>> {
    use std::ffi::{c_char, c_void, CStr, CString};
    type Handle = *mut c_void;
    let force_cpu = force_cpu || crate::hardware::cpu_only();
    let forced = if force_cpu {
        Some("CPU".to_owned())
    } else if force_cuda {
        Some("CUDA0".to_owned())
    } else if cfg!(windows) {
        None
    } else {
        std::env::var("GGML_BACKEND").ok()
    };
    // Exact exported signatures are shared by both GGML revisions in models/manifest.json.
    let library = libloading::Library::new(folder.join(if cfg!(windows) {
        "ggml.dll"
    } else if cfg!(target_os = "macos") {
        "libggml.dylib"
    } else {
        "libggml.so"
    }))?;
    // Windows GetProcAddress does not search dependency DLLs. Backend handles live
    // in ggml-base, while the registry/device-selection functions live in ggml.
    let base = libloading::Library::new(folder.join(if cfg!(windows) {
        "ggml-base.dll"
    } else if cfg!(target_os = "macos") {
        "libggml-base.dylib"
    } else {
        "libggml-base.so"
    }))?;
    // GGML's Metal registration compiles embedded shaders even for device enumeration.
    // Check the actual native device and bundled plugin without registering it.
    #[cfg(target_os = "macos")]
    if forced.is_none() {
        return super::macos::detect(folder);
    }
    let load =
        library.get::<unsafe extern "C" fn(*const c_char)>(b"ggml_backend_load_all_from_path\0")?;
    let best = library.get::<unsafe extern "C" fn() -> Handle>(b"ggml_backend_init_best\0")?;
    let named = library.get::<unsafe extern "C" fn(*const c_char, *const c_char) -> Handle>(
        b"ggml_backend_init_by_name\0",
    )?;
    let name = base.get::<unsafe extern "C" fn(Handle) -> *const c_char>(b"ggml_backend_name\0")?;
    let free = base.get::<unsafe extern "C" fn(Handle)>(b"ggml_backend_free\0")?;
    let path = CString::new(folder.to_string_lossy().as_bytes())?;
    if forced.as_deref() == Some("CPU") {
        load_cpu_backend(folder, &library)?;
    } else {
        load(path.as_ptr());
    }
    // Older Unix engines honor GGML_BACKEND; the pinned Windows engine uses --device.
    let forced = forced.map(CString::new).transpose()?;
    let backend = match forced {
        Some(device) => named(device.as_ptr(), std::ptr::null()),
        None => best(),
    };
    if backend.is_null() {
        return Err("No synthesis backend initialized".into());
    }
    let label = name(backend);
    let result = if label.is_null() {
        BackendKind::Unknown
    } else {
        let label = CStr::from_ptr(label).to_string_lossy();
        if label == "CPU" {
            BackendKind::Cpu
        } else if label.starts_with("CUDA") {
            BackendKind::Cuda
        } else if label.starts_with("Vulkan") {
            BackendKind::Vulkan
        } else if label.starts_with("Metal") || label.starts_with("MTL") {
            BackendKind::Metal
        } else {
            BackendKind::Unknown
        }
    };
    free(backend);
    Ok(Detection::new(result))
}

/// Match GGML's CPU-variant scoring without initializing unrelated GPU drivers.
/// Used only by the explicit --cpu package check; automatic selection loads all backends.
unsafe fn load_cpu_backend(
    folder: &Path,
    registry: &libloading::Library,
) -> std::result::Result<(), Box<dyn std::error::Error>> {
    use std::ffi::{c_char, c_void, CString};
    let prefix = if cfg!(windows) {
        "ggml-cpu"
    } else {
        "libggml-cpu"
    };
    // GGML backend modules use .so even on macOS.
    let extension = if cfg!(windows) { "dll" } else { "so" };
    let mut best = None;
    let mut best_score = 0;
    let mut fallback = None;
    for entry in std::fs::read_dir(folder)? {
        let path = entry?.path();
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if path.extension().and_then(|s| s.to_str()) != Some(extension) {
            continue;
        }
        if stem == prefix {
            fallback = Some(path);
            continue;
        }
        if !stem.starts_with(&format!("{prefix}-")) {
            continue;
        }
        // These are the pinned runtime's CPU variants, scored just as load_best does.
        if let Ok(candidate) = libloading::Library::new(&path) {
            if let Ok(score) =
                candidate.get::<unsafe extern "C" fn() -> i32>(b"ggml_backend_score\0")
            {
                let score = score();
                if score > best_score {
                    best_score = score;
                    best = Some(path);
                }
            }
        }
    }
    let path = best
        .or(fallback)
        .ok_or("No compatible CPU backend module")?;
    let path = CString::new(path.to_string_lossy().as_bytes())?;
    let load = registry
        .get::<unsafe extern "C" fn(*const c_char) -> *mut c_void>(b"ggml_backend_load\0")?;
    if load(path.as_ptr()).is_null() {
        return Err("CPU backend module could not be loaded".into());
    }
    Ok(())
}
