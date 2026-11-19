use super::*;
use crate::{admission, catalog, db::Database, types::GenerateRequest};
use std::{path::Path, time::Duration};

#[tokio::test]
#[ignore = "requires the official Magenta bundle, native recorder and macOS supervisor"]
async fn magenta_offline_queue() {
    let resources = required_folder("MUSIC_MAGENTA_QA_RESOURCES");
    let models = required_folder("MUSIC_MAGENTA_QA_MODELS");
    let root = tempfile::Builder::new()
        .prefix("magenta-queue-")
        .tempdir()
        .unwrap()
        .keep();
    eprintln!("Magenta queue data: {}", root.display());
    let state = Arc::new(AppState::new(Database::open(&root).unwrap(), resources));
    let mut settings = state.db.settings().unwrap();
    settings.setup_complete = true;
    settings.models_dir = models.to_str().unwrap().into();
    state.db.save_settings(&settings).unwrap();
    state.restore_setup().unwrap();

    let selection = catalog::Selection {
        provider: "magenta-realtime-2".into(),
        synthesis: "mrt2_small".into(),
        language: String::new(),
    };
    let operation = state.runtime.try_begin(OperationKind::Models).unwrap();
    catalog::ensure_runtime(&selection, &state.resources).unwrap();
    catalog::install_profile(
        &catalog::catalog(),
        &state.db,
        &selection,
        &operation.cancellation(),
        |update| {
            assert_eq!(update.phase, "verifying", "local import must only verify");
        },
    )
    .await
    .unwrap();
    drop(operation);

    let app = tauri::test::mock_app();
    let worker = tokio::spawn(worker(state.clone(), app.handle().clone()));
    let enqueue = |prompt: &str, duration: f64, seed: i64| {
        admission::generate(
            &state,
            GenerateRequest {
                prompt: prompt.into(),
                duration,
                seed,
                ..Default::default()
            },
        )
        .unwrap()
        .remove(0)
    };
    let first = enqueue(
        "Intimate jazz trio, upright bass, brushes and mellow piano",
        10.0,
        12,
    );
    let stopped = enqueue("Bright surf rock, organ and lively drums", 60.0, 21);
    let next = enqueue("Ambient analog pads and delicate bell arpeggios", 12.4, 32);
    wait_for_capture(&state, &stopped).await;
    assert!(state
        .runtime
        .cancel_song(&stopped, || state.db.cancel_song(&stopped))
        .unwrap());

    wait_for_song(&state, &next).await;
    let first_audio = check_song(&state, &first, 10.0);
    let next_audio = check_song(&state, &next, 12.4);
    assert_ne!(&first_audio[..44], &next_audio[..44]);
    assert!(first_audio[44..] != next_audio[44..first_audio.len()]);
    let stopped = state.db.song(&stopped).unwrap();
    assert_eq!(stopped.status, "cancelled");
    assert!(stopped.file.is_none());
    assert_eq!(std::fs::read_dir(root.join("songs")).unwrap().count(), 2);
    assert!(!root.read_dir().unwrap().flatten().any(|entry| entry
        .file_name()
        .to_string_lossy()
        .starts_with("music-job-")));
    state.begin_shutdown();
    worker.await.unwrap();
}

fn required_folder(name: &str) -> PathBuf {
    let path = PathBuf::from(std::env::var_os(name).unwrap_or_else(|| panic!("Set {name}")));
    assert!(
        path.is_absolute() && path.is_dir(),
        "Invalid folder for {name}"
    );
    path
}

async fn wait_for_capture(state: &AppState, id: &str) {
    tokio::time::timeout(Duration::from_secs(120), async {
        loop {
            let song = state.db.song(id).unwrap();
            assert!(
                matches!(song.status.as_str(), "queued" | "running"),
                "{song:?}"
            );
            let active = state
                .runtime
                .progress()
                .is_some_and(|progress| progress.job_id == id);
            if active && recording_started(&state.db.root) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("the second job should start writing its capture");
}

fn recording_started(root: &Path) -> bool {
    root.read_dir().unwrap().flatten().any(|entry| {
        entry
            .file_name()
            .to_string_lossy()
            .starts_with("music-job-")
            && entry
                .path()
                .join("song.wav")
                .metadata()
                .is_ok_and(|file| file.len() > 44)
    })
}

async fn wait_for_song(state: &AppState, id: &str) {
    tokio::time::timeout(Duration::from_secs(120), async {
        loop {
            let song = state.db.song(id).unwrap();
            if !matches!(song.status.as_str(), "queued" | "running") {
                assert_eq!(song.status, "done", "{song:?}");
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("the queued song should complete");
}

fn check_song(state: &AppState, id: &str, duration: f64) -> Vec<u8> {
    let song = state.db.song(id).unwrap();
    assert_eq!(song.status, "done", "{song:?}");
    assert_eq!(song.engine.as_deref(), Some("magenta-realtime-2"));
    let meta = song.result_meta.unwrap();
    assert_eq!(
        song.params["generation_profile"]["provider"],
        "magenta-realtime-2"
    );
    assert_eq!(song.params["lyrics"], "");
    assert_eq!(meta["duration"].as_f64(), Some(duration));
    let stream = &meta["stream_metrics"];
    assert!(stream["first_audio_ms"].as_f64().unwrap() > 0.0);
    assert!(stream["peak_rss_bytes"].as_u64().unwrap() > 0);
    assert!(stream["underrun_blocks"].is_u64());
    assert!(stream["realtime"].is_boolean());
    assert!(stream["capture_seconds"].as_f64().unwrap() >= duration - 0.01);
    assert!(song.title.is_some_and(|title| !title.trim().is_empty()));
    let file = song.file.unwrap();
    assert!(file.ends_with(".wav"));
    let audio = std::fs::read(state.db.root.join("songs").join(&file)).unwrap();
    assert_eq!(&audio[0..4], b"RIFF");
    assert_eq!(u16::from_le_bytes(audio[22..24].try_into().unwrap()), 2);
    assert_eq!(
        u32::from_le_bytes(audio[24..28].try_into().unwrap()),
        48_000
    );
    eprintln!("{file}: {duration}s, {stream}");
    audio
}
