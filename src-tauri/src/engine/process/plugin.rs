use std::{
    ffi::{c_char, CString, OsString},
    io::Read,
    os::unix::ffi::OsStrExt,
    path::{Path, PathBuf},
    process::Command,
};

pub(crate) const ACE_PLUGIN: &str = "libace-server-plugin.dylib";
const ENTRY: &[u8] = b"music_generator_engine_main_v1\0";
const RUN: &str = "--engine-plugin";
const SUPERVISE: &str = "--supervise-engine-plugin";

pub(super) fn is_plugin(path: &Path) -> bool {
    matches!(
        path.file_name().and_then(|name| name.to_str()),
        Some(
            ACE_PLUGIN
                | "audiocpp_cli"
                | "yue-plan"
                | "yue-synth"
                | "mimetic-synth"
                | "audiocraft-synth"
                | "mrt2-record"
                | "text2midi-runner"
                | "stem-runner"
        )
    )
}

pub(super) fn command(host: PathBuf, path: &Path, supervised: bool) -> Command {
    let mut command = Command::new(host);
    command
        .arg(if supervised { SUPERVISE } else { RUN })
        .arg(path);
    command
}

pub(super) fn cli() -> Option<i32> {
    let mut args = std::env::args_os().skip(1);
    let mode = args.next()?;
    if mode != RUN && mode != SUPERVISE {
        return None;
    }
    let Some(path) = args
        .next()
        .map(PathBuf::from)
        .filter(|path| path.is_absolute() && is_plugin(path))
    else {
        eprintln!("Invalid engine plug-in path");
        return Some(2);
    };
    if mode == SUPERVISE {
        // The model server lives in this process. Closing the control pipe must
        // stop it even when it is stuck in native code.
        std::thread::spawn(|| {
            let _ = std::io::stdin().read(&mut [0u8; 1]);
            unsafe { libc::_exit(0) }
        });
    }
    if let Err(error) = load(&path, args) {
        eprintln!("Engine plug-in {}: {error}", path.display());
    }
    Some(1)
}

fn load(
    path: &Path,
    args: impl Iterator<Item = OsString>,
) -> Result<(), Box<dyn std::error::Error>> {
    type Entry = unsafe extern "C" fn(libc::c_int, *mut *mut c_char) -> libc::c_int;
    let mut arguments: Vec<Vec<u8>> = std::iter::once(path.as_os_str().to_owned())
        .chain(args)
        .map(|value| CString::new(value.as_bytes()).map(CString::into_bytes_with_nul))
        .collect::<Result<_, _>>()?;
    let argc = libc::c_int::try_from(arguments.len())?;
    let mut argv: Vec<_> = arguments
        .iter_mut()
        .map(|value| value.as_mut_ptr().cast::<c_char>())
        .chain(std::iter::once(std::ptr::null_mut()))
        .collect();
    // The signed library exports the versioned C entry point. It runs once in
    // this helper and stays loaded through process shutdown.
    unsafe {
        let library = libloading::Library::new(path)?;
        let entry = library.get::<Entry>(ENTRY)?;
        std::process::exit(entry(argc, argv.as_mut_ptr()));
    }
}
