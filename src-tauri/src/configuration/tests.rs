use super::*;
use crate::{db::Database, error::Error, types::GenerateRequest};
use serde_json::json;
use std::{
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
    sync::Arc,
};

struct Library {
    root: tempfile::TempDir,
    db: Arc<Database>,
    state: Arc<AppState>,
    original: PathBuf,
    proposed: Settings,
}

impl Library {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let db = Database::open(root.path()).unwrap();
        let mut settings = db.settings().unwrap();
        settings.setup_complete = true;
        db.save_settings(&settings).unwrap();
        let id = db
            .enqueue(&GenerateRequest {
                title: "Saved song".into(),
                prompt: "rain".into(),
                variants: 1,
                ..Default::default()
            })
            .unwrap()[0]
            .clone();
        db.claim_next().unwrap();
        let original = PathBuf::from(&settings.songs_dir).join("saved.wav");
        std::fs::create_dir_all(original.parent().unwrap()).unwrap();
        std::fs::write(&original, b"original audio").unwrap();
        db.finish(&id, "saved.wav", &json!({})).unwrap();
        let state = Arc::new(AppState::new(db, root.path().join("resources")));
        state.restore_setup().unwrap();
        let db = state.db.clone();
        let mut proposed = settings;
        proposed.songs_dir = root.path().join("new songs").to_string_lossy().into();
        proposed.tested_fingerprint = "new hardware test".into();
        Self {
            root,
            db,
            state,
            original,
            proposed,
        }
    }

    fn assert_unchanged(&self) {
        assert_eq!(std::fs::read(&self.original).unwrap(), b"original audio");
        assert_eq!(
            Path::new(&self.db.settings().unwrap().songs_dir),
            self.original.parent().unwrap()
        );
        assert!(self.db.settings().unwrap().setup_complete);
        assert!(self.state.runtime.is_ready());
        assert_ne!(
            self.db.settings().unwrap().tested_fingerprint,
            self.proposed.tested_fingerprint
        );
        assert!(!Path::new(&self.proposed.songs_dir)
            .join("saved.wav")
            .exists());
    }
}

#[tokio::test]
async fn failed_or_cancelled_hardware_test_keeps_the_existing_library() {
    for error in [message("Hardware self-test failed"), Error::Cancelled] {
        let library = Library::new();
        let change = Change::begin(library.state.clone(), OperationKind::Setup).unwrap();
        let result = change
            .commit(
                async {
                    library.assert_unchanged();
                    Err(error)
                },
                |_| panic!("Failed setup must not grant new access"),
            )
            .await;
        assert!(result.is_err());
        library.assert_unchanged();
    }
}

#[tokio::test]
async fn cancellation_at_the_end_of_the_test_does_not_move_songs() {
    let library = Library::new();
    let change = Change::begin(library.state.clone(), OperationKind::Setup).unwrap();
    let cancel = change.cancellation();
    let result = change
        .commit(
            async {
                cancel.cancel();
                Ok(library.proposed.clone())
            },
            |_| panic!("Cancelled setup must not grant new access"),
        )
        .await;
    assert!(matches!(result, Err(Error::Cancelled)));
    library.assert_unchanged();
}

#[tokio::test]
async fn denied_playback_access_leaves_the_old_folder_and_settings_intact() {
    let library = Library::new();
    let change = Change::begin(library.state.clone(), OperationKind::Setup).unwrap();
    let result = change
        .commit(async { Ok(library.proposed.clone()) }, |_| {
            Err(message("Playback access denied"))
        })
        .await;
    assert!(result.is_err());
    library.assert_unchanged();
}

#[tokio::test]
async fn cancellation_after_playback_authorization_still_preserves_the_library() {
    let library = Library::new();
    let change = Change::begin(library.state.clone(), OperationKind::Setup).unwrap();
    let cancel = change.cancellation();
    let result = change
        .commit(async { Ok(library.proposed.clone()) }, |_| {
            cancel.cancel();
            Ok(())
        })
        .await;
    assert!(matches!(result, Err(Error::Cancelled)));
    library.assert_unchanged();
}

#[tokio::test]
async fn setup_without_a_folder_change_preserves_queued_jobs() {
    let library = Library::new();
    let id = library
        .db
        .enqueue(&GenerateRequest {
            prompt: "waiting song".into(),
            variants: 1,
            ..Default::default()
        })
        .unwrap()[0]
        .clone();
    let mut proposed = library.proposed.clone();
    proposed.songs_dir = library.db.settings().unwrap().songs_dir;
    Change::begin(library.state.clone(), OperationKind::Setup)
        .unwrap()
        .commit(async { Ok(proposed) }, |_| Ok(()))
        .await
        .unwrap();
    assert_eq!(library.db.song(&id).unwrap().status, "queued");
    assert_eq!(std::fs::read(&library.original).unwrap(), b"original audio");
}

#[tokio::test]
async fn successful_setup_grants_playback_before_moving_and_saving() {
    let library = Library::new();
    let granted = AtomicBool::new(false);
    let change = Change::begin(library.state.clone(), OperationKind::Setup).unwrap();
    let settings = change
        .commit(
            async {
                library.assert_unchanged();
                assert!(!granted.load(Ordering::SeqCst));
                Ok(library.proposed.clone())
            },
            |songs| {
                library.assert_unchanged();
                assert_eq!(songs, library.root.path().join("new songs"));
                granted.store(true, Ordering::SeqCst);
                Ok(())
            },
        )
        .await
        .unwrap();
    assert!(granted.load(Ordering::SeqCst));
    assert!(!library.original.exists());
    assert_eq!(
        std::fs::read(Path::new(&settings.songs_dir).join("saved.wav")).unwrap(),
        b"original audio"
    );
    assert_eq!(
        library.db.settings().unwrap().tested_fingerprint,
        "new hardware test"
    );
    assert_eq!(library.db.settings().unwrap().songs_dir, settings.songs_dir);
}

#[tokio::test]
async fn settings_use_the_same_authorize_before_move_contract_as_setup() {
    let library = Library::new();
    let patch = SettingsPatch {
        songs_dir: Some(library.proposed.songs_dir.clone()),
        timeout_minutes: Some(45.0),
        lm_device: Some("cpu".into()),
        ..Default::default()
    };
    let settings = save(library.state.clone(), patch, |_| {
        library.assert_unchanged();
        assert!(library.state.runtime.enqueue(|| Ok(())).is_err());
        Ok(())
    })
    .await
    .unwrap();
    assert_eq!(settings.timeout_minutes, 45.0);
    assert_eq!(settings.lm_device, "cpu");
    assert_eq!(library.db.settings().unwrap().songs_dir, settings.songs_dir);
    assert!(!library.original.exists());
    assert_eq!(
        std::fs::read(Path::new(&settings.songs_dir).join("saved.wav")).unwrap(),
        b"original audio"
    );
    assert!(library.state.runtime.enqueue(|| Ok(())).is_ok());
}

#[tokio::test]
async fn settings_authorization_failure_changes_neither_files_nor_other_settings() {
    let library = Library::new();
    let before = serde_json::to_value(library.db.settings().unwrap()).unwrap();
    let patch = SettingsPatch {
        songs_dir: Some(library.proposed.songs_dir.clone()),
        timeout_minutes: Some(45.0),
        ..Default::default()
    };
    assert!(
        save(library.state.clone(), patch, |_| Err(message("denied")))
            .await
            .is_err()
    );
    library.assert_unchanged();
    assert_eq!(
        serde_json::to_value(library.db.settings().unwrap()).unwrap(),
        before
    );
    assert!(!library.state.runtime.is_busy());
}

#[tokio::test]
async fn sqlite_failure_rolls_back_copies_and_the_entire_settings_change() {
    let library = Library::new();
    let before = serde_json::to_value(library.db.settings().unwrap()).unwrap();
    library.db.lock().execute_batch("CREATE TRIGGER reject_settings BEFORE INSERT ON settings WHEN NEW.key='lm_device' BEGIN SELECT RAISE(ABORT,'injected failure'); END;").unwrap();
    let patch = SettingsPatch {
        songs_dir: Some(library.proposed.songs_dir.clone()),
        timeout_minutes: Some(45.0),
        ..Default::default()
    };
    assert!(save(library.state.clone(), patch, |_| Ok(()))
        .await
        .is_err());
    library.assert_unchanged();
    assert_eq!(
        serde_json::to_value(library.db.settings().unwrap()).unwrap(),
        before
    );
    assert_eq!(
        std::fs::read_dir(&library.proposed.songs_dir)
            .unwrap()
            .count(),
        0
    );
}

#[tokio::test]
async fn invalid_settings_fail_before_authorization_or_side_effects() {
    for patch in [
        SettingsPatch {
            songs_dir: Some("relative".into()),
            ..Default::default()
        },
        SettingsPatch {
            timeout_minutes: Some(0.0),
            ..Default::default()
        },
        SettingsPatch {
            lm_device: Some("unknown".into()),
            ..Default::default()
        },
        SettingsPatch {
            export_format: Some("mp3".into()),
            ..Default::default()
        },
    ] {
        let library = Library::new();
        assert!(save(library.state.clone(), patch, |_| panic!(
            "Invalid settings cannot authorize folders"
        ))
        .await
        .is_err());
        library.assert_unchanged();
        assert!(!library.state.runtime.is_busy());
    }
}

#[tokio::test]
async fn an_aborted_setup_validation_releases_admission_without_losing_configuration() {
    let library = Library::new();
    let state = library.state.clone();
    let (sent, received) = tokio::sync::oneshot::channel();
    let task = tokio::spawn(async move {
        let change = Change::begin(state, OperationKind::Setup).unwrap();
        sent.send(change.cancellation()).unwrap();
        change.commit(std::future::pending(), |_| Ok(())).await
    });
    let cancel = received.await.unwrap();
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    assert!(cancel.is_cancelled());
    library.assert_unchanged();
    assert!(library.state.runtime.enqueue(|| Ok(())).is_ok());
}

#[tokio::test]
async fn an_aborted_settings_caller_does_not_release_an_inflight_commit() {
    let library = Library::new();
    let blocker = rusqlite::Connection::open(library.root.path().join("music.db")).unwrap();
    blocker.execute_batch("BEGIN IMMEDIATE").unwrap();
    let state = library.state.clone();
    let (authorized, ready) = tokio::sync::oneshot::channel();
    let task = tokio::spawn(async move {
        save(
            state,
            SettingsPatch {
                timeout_minutes: Some(45.0),
                ..Default::default()
            },
            |_| {
                authorized.send(()).unwrap();
                Ok(())
            },
        )
        .await
    });
    ready.await.unwrap();
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    assert!(library
        .state
        .runtime
        .try_begin(OperationKind::Setup)
        .is_err());
    blocker.execute_batch("ROLLBACK").unwrap();
    let _next = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        library.state.runtime.begin(OperationKind::Analysis),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(library.db.settings().unwrap().timeout_minutes, 45.0);
    assert_eq!(std::fs::read(&library.original).unwrap(), b"original audio");
}

#[tokio::test]
async fn expert_preference_can_change_during_engine_work_but_not_exclusive_operations() {
    for kind in [
        OperationKind::Generation,
        OperationKind::Analysis,
        OperationKind::Setup,
        OperationKind::Models,
        OperationKind::Settings,
        OperationKind::Startup,
        OperationKind::Import,
    ] {
        let library = Library::new();
        let operation = library.state.runtime.try_begin(kind).unwrap();
        let token = operation.cancellation();
        let result = save(
            library.state.clone(),
            SettingsPatch {
                expert_mode: Some(true),
                ..Default::default()
            },
            |_| panic!("No folder authorization"),
        )
        .await;
        let allowed = matches!(kind, OperationKind::Generation | OperationKind::Analysis);
        assert_eq!(result.is_ok(), allowed, "{kind:?}");
        assert_eq!(library.db.settings().unwrap().expert_mode, allowed);
        assert!(!token.is_cancelled());
        assert!(library.state.runtime.is_busy());
        library.assert_unchanged();
    }
}

#[tokio::test]
async fn mixed_settings_and_preference_write_failures_are_atomic() {
    let library = Library::new();
    let operation = library
        .state
        .runtime
        .try_begin(OperationKind::Generation)
        .unwrap();
    let before = serde_json::to_value(library.db.settings().unwrap()).unwrap();
    assert!(save(
        library.state.clone(),
        SettingsPatch {
            expert_mode: Some(true),
            timeout_minutes: Some(45.0),
            ..Default::default()
        },
        |_| Ok(())
    )
    .await
    .is_err());
    library.db.lock().execute_batch("CREATE TRIGGER reject_expert BEFORE INSERT ON settings WHEN NEW.key='expert_mode' BEGIN SELECT RAISE(ABORT,'injected failure'); END;").unwrap();
    assert!(save(
        library.state.clone(),
        SettingsPatch {
            expert_mode: Some(true),
            ..Default::default()
        },
        |_| Ok(())
    )
    .await
    .is_err());
    assert_eq!(
        serde_json::to_value(library.db.settings().unwrap()).unwrap(),
        before
    );
    assert!(!operation.cancellation().is_cancelled());
}

#[test]
fn preference_writes_and_queue_admission_have_a_single_order() {
    use std::sync::mpsc;
    for preference_first in [false, true] {
        let library = Library::new();
        library.db.set_expert_mode(true).unwrap();
        let state = library.state.clone();
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let first = std::thread::spawn(move || {
            if preference_first {
                state
                    .runtime
                    .update_preferences(|| {
                        state.db.set_expert_mode(false)?;
                        entered_tx.send(()).unwrap();
                        release_rx.recv().unwrap();
                        Ok(false)
                    })
                    .unwrap()
            } else {
                state
                    .runtime
                    .enqueue(|| {
                        let enabled = state.db.settings()?.expert_mode;
                        entered_tx.send(()).unwrap();
                        release_rx.recv().unwrap();
                        Ok(enabled)
                    })
                    .unwrap()
            }
        });
        entered_rx.recv().unwrap();
        let state = library.state.clone();
        let second = std::thread::spawn(move || {
            if preference_first {
                state
                    .runtime
                    .enqueue(|| Ok(state.db.settings()?.expert_mode))
                    .unwrap()
            } else {
                state
                    .runtime
                    .update_preferences(|| {
                        state.db.set_expert_mode(false)?;
                        Ok(false)
                    })
                    .unwrap()
            }
        });
        release_tx.send(()).unwrap();
        assert_eq!(first.join().unwrap(), !preference_first);
        assert!(!second.join().unwrap());
        assert!(!library.db.settings().unwrap().expert_mode);
    }
}

#[tokio::test]
async fn legacy_dit_patch_cannot_activate_an_advanced_profile_without_expert_mode() {
    let library = Library::new();
    let mut settings = library.db.settings().unwrap();
    settings.expert_mode = true;
    settings.lm_model = "acestep-5Hz-lm-0.6B-BF16.gguf".into();
    library.db.save_settings(&settings).unwrap();
    let before = serde_json::to_value(&settings).unwrap();
    let result = save(
        library.state.clone(),
        SettingsPatch {
            expert_mode: Some(false),
            dit: Some("standard".into()),
            ..Default::default()
        },
        |_| panic!("A restricted profile cannot authorize folders"),
    )
    .await;
    assert_eq!(result.unwrap_err().to_string(), "expert_mode_required");
    assert_eq!(
        serde_json::to_value(library.db.settings().unwrap()).unwrap(),
        before
    );
}

#[tokio::test]
async fn move_preserves_partial_import_metadata_and_moves_only_available_audio() {
    let library = Library::new();
    let missing = library
        .db
        .enqueue(&GenerateRequest {
            prompt: "Missing audio".into(),
            ..Default::default()
        })
        .unwrap()[0]
        .clone();
    library.db.claim_next().unwrap();
    library
        .db
        .finish(&missing, "missing.wav", &json!({"lyrics":"Keep lyrics"}))
        .unwrap();
    library
        .db
        .lock()
        .execute("UPDATE songs SET audio_missing=1 WHERE id=?1", [&missing])
        .unwrap();
    let saved = save(
        library.state.clone(),
        SettingsPatch {
            songs_dir: Some(library.proposed.songs_dir.clone()),
            ..Default::default()
        },
        |_| Ok(()),
    )
    .await
    .unwrap();
    assert_eq!(saved.songs_dir, library.proposed.songs_dir);
    assert!(!library.original.exists());
    assert_eq!(
        std::fs::read(Path::new(&saved.songs_dir).join("saved.wav")).unwrap(),
        b"original audio"
    );
    assert!(!Path::new(&saved.songs_dir).join("missing.wav").exists());
    let song = library.db.song(&missing).unwrap();
    assert!(song.audio_missing);
    assert_eq!(song.result_meta.unwrap()["lyrics"], "Keep lyrics");
    assert!(song.path.is_none());
}

#[tokio::test]
async fn move_reports_byte_progress_and_can_cancel_inside_a_file() {
    let library = Library::new();
    let events = Arc::new(std::sync::Mutex::new(Vec::new()));
    let recorded = events.clone();
    let runtime = library.state.runtime.clone();
    let result = save_with_progress(
        library.state.clone(),
        SettingsPatch {
            songs_dir: Some(library.proposed.songs_dir.clone()),
            ..Default::default()
        },
        |_| Ok(()),
        move |progress| {
            if progress.copied_bytes > 0 {
                runtime.cancel_configuration();
            }
            recorded.lock().unwrap().push(progress);
        },
    )
    .await;
    assert!(matches!(result, Err(Error::Cancelled)));
    library.assert_unchanged();
    let events = events.lock().unwrap();
    assert_eq!(events[0].phase, "copying");
    assert_eq!(events[0].total_bytes, 14);
    assert!(events.iter().any(|p| p.copied_bytes > 0));
}
