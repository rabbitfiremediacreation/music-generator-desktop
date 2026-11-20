use music_generator::{
    db::Database,
    types::{GenerateRequest, OutputKind, SongFilter},
};
use serde_json::json;

fn request() -> GenerateRequest {
    GenerateRequest {
        prompt: "rainy night".into(),
        seed: 42,
        variants: 2,
        ..Default::default()
    }
}

#[test]
fn visible_prompts_and_combined_captions_survive_restart_for_every_variant() {
    for (prompt, style, caption) in [
        (
            "A marching band in slow motion",
            "",
            "A marching band in slow motion",
        ),
        (
            "A marching band in slow motion",
            "trip hop, piano",
            "trip hop, piano, A marching band in slow motion",
        ),
        (
            "  Meine Idee: Regen über Berlin.  ",
            "ambient",
            "ambient, Meine Idee: Regen über Berlin.",
        ),
    ] {
        let root = tempfile::tempdir().unwrap();
        let db = Database::open(root.path()).unwrap();
        let ids = db
            .enqueue(&GenerateRequest {
                prompt: prompt.into(),
                style: style.into(),
                variants: 3,
                ..Default::default()
            })
            .unwrap();
        drop(db);
        let db = Database::open(root.path()).unwrap();
        assert_eq!(ids.len(), 3);
        for id in ids {
            let song = db.song(&id).unwrap();
            assert_eq!(song.caption, caption);
            assert_eq!(song.params["prompt"], prompt);
            assert_eq!(song.params["style"], style);
            assert_eq!(song.params["caption"], caption);
            let (claimed_id, params) = db.claim_next().unwrap().unwrap();
            assert_eq!(claimed_id, id);
            assert_eq!(params["prompt"], prompt);
            assert_eq!(params["caption"], caption);
            db.fail(&id, "fixture").unwrap();
        }
    }
}

#[test]
fn legacy_start_time_migration_preserves_saved_values_and_parameter_bytes() {
    let root = tempfile::tempdir().unwrap();
    let con = rusqlite::Connection::open(root.path().join("music.db")).unwrap();
    let old_schema = include_str!("../src/schema.sql")
        .replace(", started_at TEXT", "")
        .replace(
            ",\n    output_kind TEXT NOT NULL DEFAULT 'audio' CHECK (output_kind IN ('audio','midi'))",
            "",
        );
    con.execute_batch(&old_schema).unwrap();
    let params =
        "{ \"inference_steps\": 50, \"lm_temperature\": 1.0, \"seed\": 7, \"duration\": 90 }";
    con.execute("INSERT INTO songs(id,group_id,created_at,finished_at,status,title,caption,seed,params,favorite) VALUES('old','group','2000-01-01T00:00:00Z','2000-01-01T00:02:00Z','done','Original','saved song',7,?1,1)",[params]).unwrap();
    drop(con);
    for _ in 0..2 {
        let db = Database::open(root.path()).unwrap();
        let song = db.song("old").unwrap();
        assert!(song.started_at.is_none());
        assert_eq!(song.output_kind, OutputKind::Audio);
        assert_eq!(song.created_at, "2000-01-01T00:00:00Z");
        assert_eq!(song.finished_at.as_deref(), Some("2000-01-01T00:02:00Z"));
        assert_eq!(song.title.as_deref(), Some("Original"));
        assert!(song.favorite);
        assert_eq!(
            song.params,
            serde_json::from_str::<serde_json::Value>(params).unwrap()
        );
        let con = rusqlite::Connection::open(root.path().join("music.db")).unwrap();
        let stored: String = con
            .query_row("SELECT params FROM songs WHERE id='old'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(stored, params);
    }
}

#[test]
fn start_times_follow_claims_retries_and_resumed_jobs_without_changing_parameters() {
    let root = tempfile::tempdir().unwrap();
    let db = Database::open(root.path()).unwrap();
    let ids = db.enqueue(&request()).unwrap();
    let con = rusqlite::Connection::open(root.path().join("music.db")).unwrap();
    con.execute("UPDATE songs SET created_at='2000-01-01T00:00:00Z'", [])
        .unwrap();
    let original = db.song(&ids[1]).unwrap().params;
    assert!(db.song(&ids[0]).unwrap().started_at.is_none());
    db.claim_next().unwrap();
    let first_start = db.song(&ids[0]).unwrap().started_at.unwrap();
    assert_ne!(first_start, "2000-01-01T00:00:00Z");
    assert!(db.song(&ids[1]).unwrap().started_at.is_none());
    db.finish(&ids[0], "first.wav", &json!({})).unwrap();
    db.claim_next().unwrap();
    con.execute(
        "UPDATE songs SET started_at='2001-01-01T00:00:00Z' WHERE id=?1",
        [&ids[1]],
    )
    .unwrap();
    db.fail(&ids[1], "retry fixture").unwrap();
    db.retry(&ids[1]).unwrap();
    let (id, params) = db.claim_next().unwrap().unwrap();
    assert_eq!(id, ids[1]);
    assert_eq!(params, original);
    assert_ne!(
        db.song(&id).unwrap().started_at.as_deref(),
        Some("2001-01-01T00:00:00Z")
    );
    con.execute(
        "UPDATE songs SET started_at='2002-01-01T00:00:00Z' WHERE id=?1",
        [&id],
    )
    .unwrap();
    drop(db);
    let db = Database::open(root.path()).unwrap();
    assert_eq!(db.song(&id).unwrap().status, "queued");
    let (_, params) = db.claim_next().unwrap().unwrap();
    assert_eq!(params, original);
    assert_ne!(
        db.song(&id).unwrap().started_at.as_deref(),
        Some("2002-01-01T00:00:00Z")
    );
    assert_eq!(
        db.song(&ids[0]).unwrap().started_at.as_deref(),
        Some(first_start.as_str())
    );
    assert_eq!(db.song(&ids[0]).unwrap().created_at, "2000-01-01T00:00:00Z");
}

#[test]
fn queue_is_fifo_and_keeps_variant_seeds() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(dir.path()).unwrap();
    let ids = db.enqueue(&request()).unwrap();
    let (first, p) = db.claim_next().unwrap().unwrap();
    assert_eq!(first, ids[0]);
    assert_eq!(p["seed"], 42);
    assert_eq!(p["lyrics"], "[Instrumental]");
    db.finish(&first, "song.wav", &json!({"bpm":90})).unwrap();
    let (second, p) = db.claim_next().unwrap().unwrap();
    assert_eq!(second, ids[1]);
    assert_eq!(p["seed"], 43);
    assert!(db.claim_next().unwrap().is_none());
    assert_eq!(db.song(&ids[0]).unwrap().letter, "A");
    assert_eq!(db.song(&ids[1]).unwrap().letter, "B");
}

#[test]
fn fresh_sampling_defaults_do_not_rewrite_stored_songs_on_restart_or_retry() {
    let root = tempfile::tempdir().unwrap();
    let db = Database::open(root.path()).unwrap();
    let mut saved = Vec::new();
    for (steps, temperature) in [(50, Some(1.0)), (75, Some(0.65)), (0, None)] {
        let req = GenerateRequest {
            inference_steps: steps,
            lm_temperature: temperature,
            ..request()
        };
        for id in db.enqueue(&req).unwrap() {
            saved.push((id.clone(), db.song(&id).unwrap().params));
        }
    }
    let fresh = GenerateRequest {
        inference_steps: 80,
        lm_temperature: Some(1.2),
        ..request()
    };
    let fresh_id = db.enqueue(&fresh).unwrap()[0].clone();
    drop(db);
    let db = Database::open(root.path()).unwrap();
    for (id, params) in saved {
        assert_eq!(db.song(&id).unwrap().params, params);
        assert_eq!(db.claim_next().unwrap().unwrap().0, id);
        db.fail(&id, "retry fixture").unwrap();
        assert_eq!(db.song(&id).unwrap().status, "error");
        db.retry(&id).unwrap();
        assert_eq!(db.song(&id).unwrap().status, "queued");
        let (retried, queued_params) = db.claim_next().unwrap().unwrap();
        assert_eq!(retried, id);
        assert_eq!(queued_params, params);
        assert!(db.finish(&id, "fixture.wav", &json!({})).unwrap());
        assert_eq!(db.song(&id).unwrap().params, params);
    }
    let fresh_params = db.song(&fresh_id).unwrap().params;
    assert_eq!(fresh_params["inference_steps"], 80);
    assert_eq!(fresh_params["lm_temperature"], 1.2);
}

#[test]
fn a_late_cancellation_keeps_the_completed_song_and_its_wav() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(dir.path()).unwrap();
    let id = db.enqueue(&request()).unwrap().remove(0);
    assert_eq!(db.claim_next().unwrap().unwrap().0, id);
    assert_eq!(db.song(&id).unwrap().status, "running");

    let songs = dir.path().join("songs");
    std::fs::create_dir(&songs).unwrap();
    let audio = songs.join("finished.wav");
    std::fs::write(&audio, b"finished audio").unwrap();
    assert!(db.finish(&id, "finished.wav", &json!({})).unwrap());

    assert!(!db.cancel_song(&id).unwrap());
    let song = db.song(&id).unwrap();
    assert_eq!(song.status, "done");
    assert_eq!(song.file.as_deref(), Some("finished.wav"));
    assert_eq!(std::fs::read(&audio).unwrap(), b"finished audio");
}

#[test]
fn deletion_rejects_active_songs_and_removes_completed_audio() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(dir.path()).unwrap();
    let id = db.enqueue(&request()).unwrap().remove(0);
    assert!(db.delete_song(&id).is_err());
    assert_eq!(db.claim_next().unwrap().unwrap().0, id);
    assert!(db.delete_song(&id).is_err());

    let songs = dir.path().join("songs");
    std::fs::create_dir(&songs).unwrap();
    let audio = songs.join("finished.wav");
    std::fs::write(&audio, b"finished audio").unwrap();
    assert!(db.finish(&id, "finished.wav", &json!({})).unwrap());
    db.delete_song(&id).unwrap();
    assert!(db.song(&id).is_err());
    assert!(!audio.exists());
}

#[test]
fn cancellation_cannot_be_overwritten_by_a_late_result() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(dir.path()).unwrap();
    let ids = db.enqueue(&request()).unwrap();
    db.claim_next().unwrap();
    assert!(db.cancel_song(&ids[0]).unwrap());
    assert!(!db.finish(&ids[0], "late.wav", &json!({})).unwrap());
    db.fail(&ids[0], "late error").unwrap();
    assert_eq!(db.song(&ids[0]).unwrap().status, "cancelled");
    db.retry(&ids[0]).unwrap();
    assert_eq!(db.song(&ids[0]).unwrap().status, "queued");
    assert_eq!(db.claim_next().unwrap().unwrap().0, ids[0]);
}

#[test]
fn interrupted_generation_is_resumed_after_reopening() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(dir.path()).unwrap();
    let ids = db.enqueue(&request()).unwrap();
    db.claim_next().unwrap();
    drop(db);
    let db = Database::open(dir.path()).unwrap();
    assert_eq!(db.claim_next().unwrap().unwrap().0, ids[0]);
}

#[test]
fn folders_favorites_and_deletion_preserve_songs() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(dir.path()).unwrap();
    let folder = db.folder_save(None, " Ambient ").unwrap();
    let mut req = request();
    req.folder_id = Some(folder["id"].as_str().unwrap().into());
    let ids = db.enqueue(&req).unwrap();
    db.patch(&ids[0], &json!({"favorite":true,"title":"Evening"}))
        .unwrap();
    assert_eq!(
        db.songs(&SongFilter {
            favorites: true,
            ..Default::default()
        })
        .unwrap()
        .len(),
        1
    );
    assert_eq!(
        db.songs(&SongFilter {
            q: "Evening".into(),
            ..Default::default()
        })
        .unwrap()
        .len(),
        1
    );
    db.folder_delete(folder["id"].as_str().unwrap()).unwrap();
    assert_eq!(db.folders().unwrap()["none"], 2);
    assert_eq!(db.songs(&SongFilter::default()).unwrap().len(), 2);
}

#[test]
fn empty_prompt_and_invalid_variants_are_rejected_atomically() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(dir.path()).unwrap();
    assert!(db.enqueue(&GenerateRequest::default()).is_err());
    let mut req = request();
    req.variants = 51;
    assert!(db.enqueue(&req).is_err());
    assert!(db.songs(&SongFilter::default()).unwrap().is_empty());
}

#[test]
fn direct_lookup_and_export_work_beyond_the_display_limit() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(dir.path()).unwrap();
    let mut req = request();
    req.variants = 50;
    let first = db.enqueue(&req).unwrap()[0].clone();
    for _ in 0..10 {
        db.enqueue(&req).unwrap();
    }
    assert_eq!(db.songs(&SongFilter::default()).unwrap().len(), 500);
    assert_eq!(db.song(&first).unwrap().id, first);
}

#[tokio::test]
async fn folder_move_rolls_back_on_collision() {
    let root = tempfile::tempdir().unwrap();
    let db = Database::open(root.path()).unwrap();
    let sid = db.enqueue(&request()).unwrap()[0].clone();
    db.claim_next().unwrap();
    db.finish(&sid, "one.wav", &json!({})).unwrap();
    let old = std::path::PathBuf::from(db.settings().unwrap().songs_dir);
    std::fs::create_dir_all(&old).unwrap();
    std::fs::write(old.join("one.wav"), b"audio").unwrap();
    let new = root.path().join("new");
    std::fs::create_dir_all(&new).unwrap();
    std::fs::write(new.join("one.wav"), b"other").unwrap();
    // Complete/cancel other queued variants before a move.
    let next = db.claim_next().unwrap().unwrap().0;
    db.cancel_song(&next).unwrap();
    let state = std::sync::Arc::new(music_generator::state::AppState::new(
        db,
        root.path().join("resources"),
    ));
    let patch = music_generator::configuration::SettingsPatch {
        songs_dir: Some(new.to_string_lossy().into()),
        ..Default::default()
    };
    assert!(
        music_generator::configuration::save(state.clone(), patch, |_| Ok(()))
            .await
            .is_err()
    );
    let db = &state.db;
    assert_eq!(db.settings().unwrap().songs_dir, old.to_string_lossy());
    assert_eq!(std::fs::read(new.join("one.wav")).unwrap(), b"other");
}

#[test]
fn imported_paths_cannot_escape_the_song_directory() {
    let root = tempfile::tempdir().unwrap();
    for name in [
        "../song.wav",
        "/etc/passwd",
        "C:\\song.wav",
        ".",
        "foo/bar.wav",
    ] {
        assert!(music_generator::db::safe_song_path(root.path(), name).is_err());
    }
}
