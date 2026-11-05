use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::{
    fs::File,
    io::{self, Write},
    path::{Path, PathBuf},
    time::Duration,
};

#[derive(Deserialize, Serialize)]
struct CodecRequest {
    mode: String,
    started: PathBuf,
    lock: PathBuf,
}

pub struct Fixture {
    pub root: tempfile::TempDir,
    pub resources: PathBuf,
    pub source: PathBuf,
}

impl Fixture {
    /// Use this test executable as a portable, supervised codec fixture.
    pub fn new(mode: &str) -> Self {
        let root = tempfile::tempdir().unwrap();
        let resources = root.path().join("resources");
        let codec = music_generator::audio_export::codec_path(&resources);
        std::fs::create_dir_all(codec.parent().unwrap()).unwrap();
        std::fs::copy(std::env::current_exe().unwrap(), codec).unwrap();
        let source = source_file(root.path(), "original", mode);
        Self {
            root,
            resources,
            source,
        }
    }

    pub fn add_source(&self, name: &str, mode: &str) -> PathBuf {
        source_file(self.root.path(), name, mode)
    }
}

fn source_file(root: &Path, name: &str, mode: &str) -> PathBuf {
    let source = root.join(format!("{name}.wav"));
    let request = CodecRequest {
        mode: mode.into(),
        started: root.join(format!("{name}-started")),
        lock: root.join(format!("{name}.lock")),
    };
    std::fs::write(&source, serde_json::to_vec(&request).unwrap()).unwrap();
    source
}

/// Dispatch only copies named mp3-codec; the normal executable runs the tests.
pub fn codec() -> Option<i32> {
    let executable = std::env::current_exe().ok()?;
    if executable.file_stem()?.to_str()? != "mp3-codec" {
        return None;
    }
    Some(run_codec().unwrap_or_else(|error| {
        eprintln!("Fixture codec: {error}");
        2
    }))
}

fn run_codec() -> io::Result<i32> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let argument = |flag: &str| {
        args.windows(2)
            .find(|pair| pair[0] == flag)
            .map(|pair| PathBuf::from(&pair[1]))
            .ok_or_else(|| io::Error::other(format!("Missing {flag}")))
    };
    let input = File::open(argument("-i")?)?;
    let request: CodecRequest = serde_json::from_reader(&input)?;
    let mut output = File::create(argument("-o")?)?;
    match request.mode.as_str() {
        "success" => {
            output.write_all(&[b'M'; 2048])?;
            Ok(0)
        }
        "fail" => {
            output.write_all(b"incomplete conversion")?;
            Ok(1)
        }
        "block" => {
            let lock = File::create(&request.lock)?;
            lock.lock_exclusive()?;
            output.write_all(b"incomplete conversion")?;
            std::fs::write(&request.started, b"ready")?;
            std::thread::sleep(Duration::from_secs(15));
            Ok(3)
        }
        _ => Err(io::Error::other("Unknown fixture codec mode")),
    }
}

pub fn temporary_directories(root: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(root.join("export"))
        .unwrap()
        .map(|entry| entry.unwrap())
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("temporary-")
                && entry.file_type().unwrap().is_dir()
        })
        .map(|entry| entry.path())
        .collect()
}
