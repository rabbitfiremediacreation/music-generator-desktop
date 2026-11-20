use music_generator::{
    engine::{native::WavJob, process},
    error::Error,
};
use serde_json::json;
use std::{path::Path, time::Duration};
use tokio_util::sync::CancellationToken;

fn write_wav(path: &Path) {
    let mut audio = b"RIFF\x26\x00\x00\x00WAVEfmt \x10\x00\x00\x00".to_vec();
    audio.extend_from_slice(&1u16.to_le_bytes());
    audio.extend_from_slice(&1u16.to_le_bytes());
    audio.extend_from_slice(&48_000u32.to_le_bytes());
    audio.extend_from_slice(&96_000u32.to_le_bytes());
    audio.extend_from_slice(&2u16.to_le_bytes());
    audio.extend_from_slice(&16u16.to_le_bytes());
    audio.extend_from_slice(b"data\x02\x00\x00\x00\x10\x00");
    std::fs::write(path, audio).unwrap();
}

fn main() {
    if let Some(code) = process::supervise() {
        std::process::exit(code);
    }
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() == Some(std::ffi::OsStr::new("--native-wave-fixture")) {
        let output = args.next().unwrap();
        write_wav(Path::new(&output));
        if let Some(started) = args.next() {
            // Signal only once the real child has created its staged WAV.
            std::fs::write(started, b"started").unwrap();
            std::thread::sleep(Duration::from_secs(60));
        }
        return;
    }
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(verify_wav_job());
}

async fn verify_wav_job() {
    let root = tempfile::tempdir().unwrap();
    let executable = std::env::current_exe().unwrap();
    let job = WavJob {
        executable: &executable,
        model_folder: root.path(),
        data_root: root.path(),
        log_name: "fixture.log",
        backend: "cuda",
        timeout: Duration::from_secs(180),
    };
    let params = json!({"duration": 10, "seed": 123});
    let cancel = CancellationToken::new();
    let (audio, extension, meta) = job
        .run(
            &params,
            &cancel,
            |_| {},
            |output| {
                vec![
                    "--native-wave-fixture".into(),
                    output.to_string_lossy().into_owned(),
                ]
            },
        )
        .await
        .unwrap_or_else(|error| {
            let log =
                std::fs::read_to_string(root.path().join("logs/fixture.log")).unwrap_or_default();
            panic!("{error}\n{log}");
        });
    assert_eq!(extension, "wav");
    assert_eq!(&audio[..4], b"RIFF");
    assert_eq!(meta["duration"].as_f64(), Some(1.0 / 48_000.0));
    assert_eq!(meta["duration_warning"]["code"], "short_audio");
    assert_eq!(meta["requested_duration"], 10.0);
    assert!(meta["runtime_seconds"].as_f64().unwrap() > 0.0);

    let started = root.path().join("started");
    let cancelled = job
        .run(
            &params,
            &cancel,
            |_| {
                if started.is_file() {
                    cancel.cancel();
                }
            },
            |output| {
                vec![
                    "--native-wave-fixture".into(),
                    output.to_string_lossy().into_owned(),
                    started.to_string_lossy().into_owned(),
                ]
            },
        )
        .await;
    assert!(started.is_file());
    assert!(matches!(cancelled, Err(Error::Cancelled)));
    assert!(root.path().read_dir().unwrap().all(|entry| !entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with("music-job-")));
}
