use super::*;
use crate::{
    catalog::{self, Selection},
    db::Database,
    types::{GenerateRequest, OutputKind},
};
use std::{path::Path, time::Duration};
use tauri::test::{mock_builder, mock_context, noop_assets};

#[tokio::test]
#[ignore = "requires the pinned model files, the installed Text2midi runtime and a debug supervisor"]
async fn text2midi_offline_queue_import_cancel_and_export() {
    let models = PathBuf::from(std::env::var_os("TEXT2MIDI_TEST_MODELS").unwrap());
    let runtime = PathBuf::from(std::env::var_os("TEXT2MIDI_TEST_RUNTIME").unwrap());
    let export = PathBuf::from(std::env::var_os("TEXT2MIDI_TEST_EXPORT").unwrap());
    let data = tempfile::tempdir().unwrap();
    let songs = data.path().join("songs");
    let db = Database::open(data.path()).unwrap();
    let mut settings = db.settings().unwrap();
    settings.setup_complete = true;
    settings.models_dir = models.to_str().unwrap().into();
    settings.songs_dir = songs.to_str().unwrap().into();
    db.save_settings(&settings).unwrap();
    let selection = Selection {
        provider: "text2midi".into(),
        synthesis: "text2midi".into(),
        language: "flan-t5-base".into(),
    };
    let catalog = catalog::catalog();
    let profile = catalog.profile(&selection).unwrap();
    let interpreter = profile.runtime.interpreter(data.path()).unwrap();
    let venv = interpreter.parent().unwrap().parent().unwrap();
    std::fs::create_dir_all(venv.parent().unwrap()).unwrap();
    std::os::unix::fs::symlink(runtime, venv).unwrap();

    // Verify and activate the actual locally staged files with the production ModelDownloader.
    catalog::install_profile(
        &catalog,
        &db,
        &selection,
        &CancellationToken::new(),
        |progress| {
            assert_eq!(progress.phase, "verifying");
        },
    )
    .await
    .unwrap();
    assert_eq!(Selection::from_settings(&db.settings().unwrap()), selection);

    let resources = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources");
    let state = Arc::new(AppState::new(db, resources));
    state.restore_setup().unwrap();
    let app = mock_builder().build(mock_context(noop_assets())).unwrap();
    let worker = tokio::spawn(worker(state.clone(), app.handle().clone()));
    let request = GenerateRequest {
        model_selection: Some(selection),
        prompt: "A melodic ambient piece with soft piano, acoustic guitar and electric bass in G minor, 4/4, at 115 beats per minute.".into(),
        seed: 337,
        ..Default::default()
    };

    let cancelled = crate::admission::generate(&state, request.clone())
        .unwrap()
        .remove(0);
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            if state
                .runtime
                .progress()
                .is_some_and(|update| update.progress.phase == "synth")
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("native generation must have started");
    assert!(state
        .runtime
        .cancel_song(&cancelled, || state.db.cancel_song(&cancelled))
        .unwrap());

    let completed = crate::admission::generate(&state, request)
        .unwrap()
        .remove(0);
    let song = tokio::time::timeout(Duration::from_secs(20 * 60 + 30), async {
        loop {
            let song = state.db.song(&completed).unwrap();
            if matches!(song.status.as_str(), "done" | "error") {
                break song;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    })
    .await
    .expect("generation must reach a terminal state");
    state.begin_shutdown();
    worker.await.unwrap();
    assert_eq!(
        song.status,
        "done",
        "{song:?}\n{}",
        std::fs::read_to_string(data.path().join("logs/text2midi.log")).unwrap_or_default()
    );
    assert_eq!(song.output_kind, OutputKind::Midi);
    let facts = song.result_meta.unwrap();
    assert_eq!(facts["backend"], "cpu");
    assert!(facts["midi"]["notes"].as_u64().unwrap() > 0);
    assert!(facts["midi"]["note_tracks"].as_u64().unwrap() > 0);
    assert!(facts["midi"]["tempo_events"].as_u64().unwrap() > 0);
    assert!(facts.get("title_model").is_none());
    println!("{facts}");
    let cancelled = state.db.song(&cancelled).unwrap();
    assert_eq!(cancelled.status, "cancelled");
    assert!(cancelled.path.is_none());
    assert_eq!(std::fs::read_dir(&songs).unwrap().count(), 1);
    state.db.export_midi(&completed, &export).unwrap();
    assert_eq!(
        std::fs::read(&export).unwrap(),
        std::fs::read(song.path.unwrap()).unwrap()
    );
}
