use super::*;
use crate::{catalog, db::Database, types::GenerateRequest};
use sha2::{Digest, Sha256};
use std::{path::Path, time::Duration};

const POLL: Duration = Duration::from_millis(100);

async fn until_song(
    state: &AppState,
    id: &str,
    ready: impl Fn(&crate::types::Song) -> bool,
) -> crate::types::Song {
    tokio::time::timeout(Duration::from_secs(600), async {
        loop {
            let song = state.db.song(id).unwrap();
            assert_ne!(song.status, "error", "{:?}", song.message);
            if ready(&song) {
                return song;
            }
            tokio::time::sleep(POLL).await;
        }
    })
    .await
    .expect("HeartMuLa job timed out")
}

// Run the copied lib test executable beside the native music-engine-supervisor binary.
#[tokio::test]
#[ignore = "requires the pinned checkpoints, native launcher and Apple Silicon Metal"]
async fn offline_queue_library_export_and_cancel() {
    let models = PathBuf::from(std::env::var_os("MUSIC_HEARTMULA_QA_MODELS").unwrap());
    let resources = PathBuf::from(std::env::var_os("MUSIC_HEARTMULA_QA_RESOURCES").unwrap());
    let root = PathBuf::from(std::env::var_os("MUSIC_HEARTMULA_QA_OUTPUT").unwrap());
    std::fs::create_dir(&root).unwrap();
    let data = root.join("data");
    let db = Database::open(&data).unwrap();
    let mut settings = db.settings().unwrap();
    settings.setup_complete = true;
    settings.models_dir = models.to_str().unwrap().into();
    settings.lm_model = crate::manifest::lm_file("0.6B");
    db.save_settings(&settings).unwrap();

    let title_name = crate::titles::manifest().model.file;
    assert!(
        !models.join(&title_name).exists(),
        "QA requires a model folder without the title model"
    );
    let selection = catalog::Selection {
        provider: "heartmula".into(),
        synthesis: "heartmula-oss-3b-hny".into(),
        language: String::new(),
    };
    catalog::ensure_runtime(&selection, &resources).unwrap();
    let cancel = CancellationToken::new();
    catalog::install_profile(&catalog::catalog(), &db, &selection, &cancel, |_| {})
        .await
        .unwrap();
    let state = Arc::new(AppState::new(db, resources.clone()));
    assert!(state.restore_setup().unwrap());
    let app = tauri::test::mock_app();
    let worker = tokio::spawn(worker(state.clone(), app.handle().clone()));

    let request = GenerateRequest {
        style: "indie pop, soft drums, warm vocals, acoustic guitar".into(),
        lyrics: "[Verse]\nThe paper kite follows the river\nI keep the bright string by my side\n[Chorus]\nCarry me home, carry me home\nOver the silver tide".into(),
        instrumental: false,
        seed: 42,
        ..Default::default()
    };
    let mut results = Vec::new();
    for duration in [5.0, 30.0, 5.0] {
        let id = crate::admission::generate(
            &state,
            GenerateRequest {
                duration,
                ..request.clone()
            },
        )
        .unwrap()
        .remove(0);
        let song = until_song(&state, &id, |song| song.status == "done").await;
        assert_eq!(song.engine.as_deref(), Some("heartmula"));
        assert!(song.title.as_ref().is_some_and(|title| !title.is_empty()));
        assert_eq!(song.seed, 42);
        let file = Path::new(&settings.songs_dir).join(song.file.unwrap());
        let audio = std::fs::read(&file).unwrap();
        let measured = crate::audio_facts::duration(&audio).unwrap();
        let meta = song.result_meta.unwrap();
        assert_eq!(meta["duration"], serde_json::json!(measured));
        assert_eq!(meta["duration_source"], "wav");
        let hash = format!("{:x}", Sha256::digest(&audio));
        println!(
            "HeartMuLa: {duration}s cap, {measured}s WAV, {}s native runtime, {hash}, {}",
            meta["runtime_seconds"],
            file.display()
        );
        results.push((id, audio));
    }

    let id = crate::admission::generate(
        &state,
        GenerateRequest {
            duration: 30.0,
            ..request
        },
    )
    .unwrap()
    .remove(0);
    until_song(&state, &id, |_| {
        state
            .runtime
            .progress()
            .is_some_and(|update| update.job_id == id && update.progress.phase == "generation")
    })
    .await;
    assert!(state
        .runtime
        .cancel_song(&id, || state.db.cancel_song(&id))
        .unwrap());
    let song = until_song(&state, &id, |song| song.status == "cancelled").await;
    assert!(song.file.is_none());
    assert!(!Path::new(&settings.songs_dir)
        .join(format!("{id}.wav"))
        .exists());
    state.begin_shutdown();
    tokio::time::timeout(Duration::from_secs(10), worker)
        .await
        .unwrap()
        .unwrap();

    let export = root.join("export.wav");
    crate::exports::export(
        state.db.clone(),
        resources,
        "audio".into(),
        Some(results[0].0.clone()),
        None,
        export.clone(),
        cancel,
    )
    .await
    .unwrap();
    assert_eq!(std::fs::read(export).unwrap(), results[0].1);
    assert!(!models.join(title_name).exists());
    assert!(std::fs::read_dir(&data).unwrap().all(|entry| {
        !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("music-job-")
    }));
}
