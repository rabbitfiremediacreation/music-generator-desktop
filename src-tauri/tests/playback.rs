use music_generator::{db::Database, types::GenerateRequest};
use serde_json::json;
use std::path::PathBuf;

fn song(db: &Database, filename: Option<&str>) -> String {
    let id = db
        .enqueue(&GenerateRequest {
            prompt: "Playback fixture".into(),
            ..Default::default()
        })
        .unwrap()
        .remove(0);
    db.claim_next().unwrap().unwrap();
    if let Some(filename) = filename {
        db.finish(&id, filename, &json!({})).unwrap();
    }
    id
}

fn audio_path(db: &Database, filename: &str) -> PathBuf {
    let directory = PathBuf::from(db.settings().unwrap().songs_dir);
    std::fs::create_dir_all(&directory).unwrap();
    directory.join(filename)
}

#[test]
fn playback_reads_original_bytes_by_song_id_after_restart_with_special_paths() {
    let root = tempfile::tempdir().unwrap();
    let library = root.path().join("Music [library] #1 % 音楽");
    let db = Database::open(&library).unwrap();
    let mut settings = db.settings().unwrap();
    settings.songs_dir = root
        .path()
        .join("Songs & Grüße [mix] #100% 音楽")
        .to_string_lossy()
        .into();
    db.save_settings(&settings).unwrap();
    let mut fixtures = Vec::new();
    for filename in ["generated-id.wav", "Imported Grüße [夜] #100%.wav"] {
        let bytes = format!("original bytes for {filename}").into_bytes();
        std::fs::write(audio_path(&db, filename), &bytes).unwrap();
        let id = song(&db, Some(filename));
        assert_eq!(db.read_song_audio(&id).unwrap(), bytes);
        fixtures.push((id, bytes));
    }
    drop(db);
    let reopened = Database::open(&library).unwrap();
    for (id, bytes) in fixtures {
        assert_eq!(reopened.read_song_audio(&id).unwrap(), bytes);
    }
}

#[test]
fn playback_rejects_unknown_ids_unfinished_missing_and_empty_audio() {
    let root = tempfile::tempdir().unwrap();
    let db = Database::open(root.path()).unwrap();
    assert_eq!(
        db.read_song_audio("unknown").unwrap_err().to_string(),
        "Song not found"
    );
    let unfinished = song(&db, None);
    assert_eq!(
        db.read_song_audio(&unfinished).unwrap_err().to_string(),
        "Song audio is unavailable"
    );
    let missing = song(&db, Some("missing.wav"));
    assert!(db
        .read_song_audio(&missing)
        .unwrap_err()
        .to_string()
        .starts_with("Cannot read song audio:"));
    let empty = song(&db, Some("empty.wav"));
    std::fs::write(audio_path(&db, "empty.wav"), []).unwrap();
    assert_eq!(
        db.read_song_audio(&empty).unwrap_err().to_string(),
        "Song audio is unavailable"
    );
    std::fs::write(audio_path(&db, "unavailable.wav"), b"existing bytes").unwrap();
    let unavailable = song(&db, Some("unavailable.wav"));
    rusqlite::Connection::open(root.path().join("music.db"))
        .unwrap()
        .execute(
            "UPDATE songs SET audio_missing=1 WHERE id=?1",
            [&unavailable],
        )
        .unwrap();
    assert_eq!(
        db.read_song_audio(&unavailable).unwrap_err().to_string(),
        "Song audio is unavailable"
    );
}

#[test]
fn playback_cannot_be_used_as_an_arbitrary_path_reader() {
    let root = tempfile::tempdir().unwrap();
    let db = Database::open(root.path()).unwrap();
    let private = root.path().join("private.wav");
    std::fs::write(&private, b"outside the song folder").unwrap();
    assert!(db.read_song_audio(private.to_str().unwrap()).is_err());
    for filename in [
        "../private.wav",
        "..\\private.wav",
        "/private.wav",
        "C:\\private.wav",
    ] {
        let id = song(&db, Some(filename));
        assert_eq!(
            db.read_song_audio(&id).unwrap_err().to_string(),
            "Song audio is unavailable"
        );
    }
}

#[cfg(unix)]
#[test]
fn playback_rejects_symlinks_outside_the_song_folder() {
    let root = tempfile::tempdir().unwrap();
    let db = Database::open(root.path()).unwrap();
    let private = root.path().join("private.wav");
    std::fs::write(&private, b"outside the song folder").unwrap();
    std::os::unix::fs::symlink(&private, audio_path(&db, "escape.wav")).unwrap();
    let id = song(&db, Some("escape.wav"));
    assert_eq!(
        db.read_song_audio(&id).unwrap_err().to_string(),
        "Song audio is unavailable"
    );
}
