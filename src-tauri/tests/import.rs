use music_generator::{
    db::Database,
    import::import_legacy,
    types::{GenerateRequest, SongFilter},
};
use serde_json::json;

#[test]
fn import_copies_audio_metadata_and_wal_without_touching_the_source() {
    let old = tempfile::tempdir().unwrap();
    let source = Database::open(&old.path().join("data")).unwrap();
    let ids = source
        .enqueue(&GenerateRequest {
            prompt: "old song".into(),
            ..Default::default()
        })
        .unwrap();
    source.claim_next().unwrap();
    source
        .finish(&ids[0], "old.wav", &json!({"lyrics":"hello"}))
        .unwrap();
    let songdir = old.path().join("data/songs");
    std::fs::create_dir_all(&songdir).unwrap();
    std::fs::write(songdir.join("old.wav"), b"old audio").unwrap();
    source
        .patch(&ids[0], &json!({"favorite":true,"title":"Original"}))
        .unwrap();
    let original = source.song(&ids[0]).unwrap();
    let new = tempfile::tempdir().unwrap();
    let db = Database::open(new.path()).unwrap();
    assert_eq!(import_legacy(&db, old.path()).unwrap()["songs"], 1);
    assert_eq!(db.song(&ids[0]).unwrap().title.as_deref(), Some("Original"));
    assert!(db.song(&ids[0]).unwrap().favorite);
    assert_eq!(db.song(&ids[0]).unwrap().started_at, original.started_at);
    assert_eq!(db.song(&ids[0]).unwrap().params, original.params);
    assert_eq!(
        std::fs::read(new.path().join("songs/old.wav")).unwrap(),
        b"old audio"
    );
    assert_eq!(
        std::fs::read(songdir.join("old.wav")).unwrap(),
        b"old audio"
    );
    assert!(import_legacy(&db, old.path()).is_err());
}

#[test]
fn import_old_library_adds_start_time_only_to_the_copy() {
    let old = tempfile::tempdir().unwrap();
    let source = Database::open(old.path()).unwrap();
    let id = source
        .enqueue(&GenerateRequest {
            prompt: "old library".into(),
            inference_steps: 50,
            lm_temperature: Some(1.0),
            ..Default::default()
        })
        .unwrap()[0]
        .clone();
    source.claim_next().unwrap();
    source.finish(&id, "old.wav", &json!({})).unwrap();
    let original = source.song(&id).unwrap().params;
    drop(source);
    std::fs::create_dir_all(old.path().join("songs")).unwrap();
    std::fs::write(old.path().join("songs/old.wav"), b"old audio").unwrap();
    let con = rusqlite::Connection::open(old.path().join("music.db")).unwrap();
    con.execute("ALTER TABLE songs DROP COLUMN started_at", [])
        .unwrap();
    let target = tempfile::tempdir().unwrap();
    let db = Database::open(target.path()).unwrap();
    import_legacy(&db, old.path()).unwrap();
    assert!(db.song(&id).unwrap().started_at.is_none());
    assert_eq!(db.song(&id).unwrap().params, original);
    let columns = con
        .prepare("PRAGMA table_info(songs)")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(1))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert!(!columns.iter().any(|c| c == "started_at"));
    let params: String = con
        .query_row("SELECT params FROM songs WHERE id=?1", [&id], |r| r.get(0))
        .unwrap();
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&params).unwrap(),
        original
    );
    assert_eq!(
        std::fs::read(old.path().join("songs/old.wav")).unwrap(),
        b"old audio"
    );
}

#[test]
fn failed_import_leaves_the_destination_empty() {
    let old = tempfile::tempdir().unwrap();
    let source = Database::open(&old.path().join("data")).unwrap();
    let ids = source
        .enqueue(&GenerateRequest {
            prompt: "missing audio".into(),
            ..Default::default()
        })
        .unwrap();
    source.claim_next().unwrap();
    source.finish(&ids[0], "missing.wav", &json!({})).unwrap();
    let new = tempfile::tempdir().unwrap();
    let db = Database::open(new.path()).unwrap();
    assert!(import_legacy(&db, old.path()).is_err());
    assert!(db.songs(&SongFilter::default()).unwrap().is_empty());
}

#[test]
fn import_unsandboxed_desktop_profile_preserves_source_and_reuses_model_location() {
    let old = tempfile::tempdir().unwrap();
    let source = Database::open(old.path()).unwrap();
    let mut settings = source.settings().unwrap();
    settings.models_dir = old.path().join("existing models").to_string_lossy().into();
    source.save_settings(&settings).unwrap();
    let ids = source
        .enqueue(&GenerateRequest {
            prompt: "desktop song".into(),
            ..Default::default()
        })
        .unwrap();
    source.claim_next().unwrap();
    source.finish(&ids[0], "desktop.wav", &json!({})).unwrap();
    std::fs::create_dir_all(old.path().join("songs")).unwrap();
    std::fs::write(old.path().join("songs/desktop.wav"), b"desktop audio").unwrap();
    let target = tempfile::tempdir().unwrap();
    let db = Database::open(target.path()).unwrap();
    let result = import_legacy(&db, old.path()).unwrap();
    assert_eq!(result["models_dir"], settings.models_dir);
    assert_eq!(result["songs"], 1);
    assert_eq!(
        std::fs::read(target.path().join("songs/desktop.wav")).unwrap(),
        b"desktop audio"
    );
    assert_eq!(
        std::fs::read(old.path().join("songs/desktop.wav")).unwrap(),
        b"desktop audio"
    );
    assert_eq!(source.song(&ids[0]).unwrap().status, "done");
}

fn request(
    root: &std::path::Path,
    target: &std::path::Path,
) -> music_generator::import::ImportRequest {
    music_generator::import::ImportRequest {
        root: root.to_string_lossy().into(),
        songs_source: None,
        songs_dir: target.to_string_lossy().into(),
        allow_partial: false,
    }
}

fn finished(db: &Database, name: &str) -> String {
    let id = db
        .enqueue(&GenerateRequest {
            prompt: name.into(),
            ..Default::default()
        })
        .unwrap()[0]
        .clone();
    db.claim_next().unwrap();
    db.finish(&id, name, &json!({"lyrics":"keep these lyrics"}))
        .unwrap();
    id
}

#[test]
fn selected_target_is_used_before_setup_and_survives_restart() {
    use music_generator::import::{import_library, preview};
    let old = tempfile::tempdir().unwrap();
    let source = Database::open(&old.path().join("data")).unwrap();
    let id = finished(&source, "original.wav");
    std::fs::create_dir_all(old.path().join("data/songs")).unwrap();
    std::fs::write(old.path().join("data/songs/original.wav"), b"old audio").unwrap();
    let data = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    let db = Database::open(data.path()).unwrap();
    let req = request(old.path(), target.path());
    let check = preview(&db, &req).unwrap();
    assert!(check.can_import);
    assert_eq!(check.files, 1);
    assert_eq!(check.bytes, 9);
    assert!(db.songs(&SongFilter::default()).unwrap().is_empty());
    assert!(!target.path().join("original.wav").exists());
    import_library(&db, &req, &Default::default(), |_| {}).unwrap();
    assert!(!db.settings().unwrap().setup_complete);
    assert!(!data.path().join("songs/original.wav").exists());
    drop(db);
    let db = Database::open(data.path()).unwrap();
    assert_eq!(
        db.settings().unwrap().songs_dir,
        target.path().to_string_lossy()
    );
    assert_eq!(
        db.song(&id).unwrap().path.unwrap(),
        target.path().join("original.wav").to_string_lossy()
    );
    assert_eq!(
        std::fs::read(old.path().join("data/songs/original.wav")).unwrap(),
        b"old audio"
    );
}

#[test]
fn data_folder_and_corrected_external_audio_folder_are_supported() {
    use music_generator::import::{import_library, preview};
    let old = tempfile::tempdir().unwrap();
    let audio = tempfile::tempdir().unwrap();
    let source = Database::open(&old.path().join("data")).unwrap();
    let id = finished(&source, "external.wav");
    let mut settings = source.settings().unwrap();
    settings.songs_dir = audio.path().to_string_lossy().into();
    source.save_settings(&settings).unwrap();
    std::fs::write(audio.path().join("external.wav"), b"external").unwrap();
    let data = tempfile::tempdir().unwrap();
    let db = Database::open(data.path()).unwrap();
    let mut req = request(&old.path().join("data"), &data.path().join("songs"));
    let check = preview(&db, &req).unwrap();
    assert!(check.can_import);
    assert_eq!(check.songs_source, settings.songs_dir);
    let moved_audio = tempfile::tempdir().unwrap();
    std::fs::rename(
        audio.path().join("external.wav"),
        moved_audio.path().join("external.wav"),
    )
    .unwrap();
    assert!(!preview(&db, &req).unwrap().can_import);
    req.songs_source = Some(moved_audio.path().to_string_lossy().into());
    import_library(&db, &req, &Default::default(), |_| {}).unwrap();
    assert_eq!(
        db.song(&id).unwrap().params,
        source.song(&id).unwrap().params
    );
}

#[test]
fn partial_import_retains_missing_metadata_without_playback_or_exports() {
    use music_generator::import::{import_library, preview, preview_move};
    let old = tempfile::tempdir().unwrap();
    let source = Database::open(old.path()).unwrap();
    let present = finished(&source, "present.wav");
    let missing = finished(&source, "missing.wav");
    source
        .patch(&missing, &json!({"favorite":true,"title":"Keep my title"}))
        .unwrap();
    let folder = source.folder_save(None, "Keep my folder").unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    source
        .patch(&missing, &json!({"folder_id":folder}))
        .unwrap();
    std::fs::create_dir_all(old.path().join("songs")).unwrap();
    std::fs::write(old.path().join("songs/present.wav"), b"present").unwrap();
    let data = tempfile::tempdir().unwrap();
    let db = Database::open(data.path()).unwrap();
    let mut req = request(old.path(), &data.path().join("songs"));
    let check = preview(&db, &req).unwrap();
    assert!(!check.can_import);
    assert_eq!(check.missing.len(), 1);
    assert!(import_library(&db, &req, &Default::default(), |_| {}).is_err());
    req.allow_partial = true;
    assert!(preview(&db, &req).unwrap().can_import);
    let result = import_library(&db, &req, &Default::default(), |_| {}).unwrap();
    assert_eq!(result.songs, 2);
    assert_eq!(result.files, 1);
    let song = db.song(&missing).unwrap();
    assert!(song.audio_missing);
    assert!(song.path.is_none());
    assert_eq!(song.status, "done");
    assert_eq!(song.file.as_deref(), Some("missing.wav"));
    assert_eq!(song.title.as_deref(), Some("Keep my title"));
    assert!(song.favorite);
    assert_eq!(song.folder_id, Some(folder));
    assert_eq!(song.params, source.song(&missing).unwrap().params);
    assert_eq!(song.result_meta, source.song(&missing).unwrap().result_meta);
    assert!(!db.song(&present).unwrap().audio_missing);
    assert_eq!(db.queue().unwrap()["library"]["count"], 1);
    assert!(db
        .export_audio(&missing, &data.path().join("missing.wav"))
        .is_err());
    db.export_lyrics(&missing, &data.path().join("lyrics.txt"))
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(data.path().join("lyrics.txt")).unwrap(),
        "keep these lyrics"
    );
    db.export_zip("", &data.path().join("songs.zip")).unwrap();
    let archive =
        zip::ZipArchive::new(std::fs::File::open(data.path().join("songs.zip")).unwrap()).unwrap();
    assert_eq!(archive.len(), 1);
    assert_eq!(db.queue().unwrap()["queued"], 0);
    let new_target = tempfile::tempdir().unwrap();
    let check = preview_move(&db, &new_target.path().to_string_lossy()).unwrap();
    assert!(check.can_import);
    assert_eq!(check.files, 1);
    assert_eq!(check.missing.len(), 1);
}

#[test]
fn wrong_song_folder_gets_actionable_issue_without_parent_search() {
    let old = tempfile::tempdir().unwrap();
    Database::open(&old.path().join("data")).unwrap();
    std::fs::create_dir_all(old.path().join("data/songs")).unwrap();
    let data = tempfile::tempdir().unwrap();
    let db = Database::open(data.path()).unwrap();
    let check = music_generator::import::preview(
        &db,
        &request(&old.path().join("data/songs"), &data.path().join("songs")),
    )
    .unwrap();
    assert!(!check.can_import);
    assert_eq!(check.issues[0].code, "select_project");
}

#[test]
fn collision_same_folder_and_cancellation_preserve_existing_files_and_settings() {
    use music_generator::import::{import_library, preview};
    let old = tempfile::tempdir().unwrap();
    let source = Database::open(old.path()).unwrap();
    finished(&source, "a.wav");
    finished(&source, "b.wav");
    std::fs::create_dir_all(old.path().join("songs")).unwrap();
    std::fs::write(old.path().join("songs/a.wav"), vec![1u8; 2 * 1024 * 1024]).unwrap();
    std::fs::write(old.path().join("songs/b.wav"), b"song b").unwrap();
    let data = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    let db = Database::open(data.path()).unwrap();
    let before = db.settings().unwrap().songs_dir;
    let req = request(old.path(), target.path());
    std::fs::write(target.path().join("b.wav"), b"unrelated").unwrap();
    assert_eq!(preview(&db, &req).unwrap().issues[0].code, "collision");
    assert!(import_library(&db, &req, &Default::default(), |_| {}).is_err());
    assert_eq!(
        std::fs::read(target.path().join("b.wav")).unwrap(),
        b"unrelated"
    );
    assert!(!target.path().join("a.wav").exists());
    std::fs::remove_file(target.path().join("b.wav")).unwrap();
    let same = request(old.path(), &old.path().join("songs"));
    assert_eq!(preview(&db, &same).unwrap().issues[0].code, "same_folder");
    let cancel = tokio_util::sync::CancellationToken::new();
    assert!(import_library(&db, &req, &cancel, |progress| {
        if progress.copied_bytes > 0 {
            cancel.cancel();
        }
    })
    .is_err());
    assert!(std::fs::read_dir(target.path()).unwrap().next().is_none());
    assert_eq!(db.settings().unwrap().songs_dir, before);
    assert!(db.songs(&SongFilter::default()).unwrap().is_empty());
    assert!(!std::fs::read_dir(data.path()).unwrap().any(|p| p
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with("import-")));
}

#[cfg(unix)]
#[test]
fn invalid_source_filename_and_target_symlinks_are_rejected() {
    use music_generator::import::{import_library, preview};
    let old = tempfile::tempdir().unwrap();
    let source = Database::open(old.path()).unwrap();
    finished(&source, "../escape.wav");
    std::fs::create_dir_all(old.path().join("songs")).unwrap();
    let data = tempfile::tempdir().unwrap();
    let db = Database::open(data.path()).unwrap();
    let req = request(old.path(), &data.path().join("songs"));
    assert_eq!(preview(&db, &req).unwrap().issues[0].code, "invalid_data");
    assert!(import_library(&db, &req, &Default::default(), |_| {}).is_err());
}

#[test]
fn sqlite_commit_failure_removes_only_imported_copies() {
    let old = tempfile::tempdir().unwrap();
    let source = Database::open(old.path()).unwrap();
    finished(&source, "original.wav");
    std::fs::create_dir_all(old.path().join("songs")).unwrap();
    std::fs::write(old.path().join("songs/original.wav"), b"original").unwrap();
    let data = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    let db = Database::open(data.path()).unwrap();
    let before = db.settings().unwrap().songs_dir;
    std::fs::write(target.path().join("unrelated.wav"), b"keep").unwrap();
    let con = rusqlite::Connection::open(data.path().join("music.db")).unwrap();
    con.execute_batch("CREATE TRIGGER fail_import BEFORE INSERT ON songs BEGIN SELECT RAISE(ABORT, 'fixture write failure'); END;").unwrap();
    assert!(music_generator::import::import_library(
        &db,
        &request(old.path(), target.path()),
        &Default::default(),
        |_| {}
    )
    .is_err());
    assert!(!target.path().join("original.wav").exists());
    assert_eq!(
        std::fs::read(target.path().join("unrelated.wav")).unwrap(),
        b"keep"
    );
    assert_eq!(
        std::fs::read(old.path().join("songs/original.wav")).unwrap(),
        b"original"
    );
    assert_eq!(db.settings().unwrap().songs_dir, before);
    assert!(db.songs(&SongFilter::default()).unwrap().is_empty());
}

#[cfg(unix)]
#[test]
fn sparse_audio_larger_than_free_space_is_rejected_before_copying() {
    let old = tempfile::tempdir().unwrap();
    let source = Database::open(old.path()).unwrap();
    finished(&source, "large.wav");
    std::fs::create_dir_all(old.path().join("songs")).unwrap();
    let data = tempfile::tempdir().unwrap();
    let db = Database::open(data.path()).unwrap();
    let file = std::fs::File::create(old.path().join("songs/large.wav")).unwrap();
    file.set_len(fs2::available_space(data.path()).unwrap() + 1)
        .unwrap();
    let req = request(old.path(), &data.path().join("songs"));
    let check = music_generator::import::preview(&db, &req).unwrap();
    assert!(check.issues.iter().any(|issue| issue.code == "space"));
    assert!(!check.can_import);
    assert!(
        music_generator::import::import_library(&db, &req, &Default::default(), |progress| {
            assert_ne!(progress.phase, "copying", "Must not copy");
        })
        .is_err()
    );
    assert!(!data.path().join("songs/large.wav").exists());
}

#[cfg(unix)]
#[test]
fn denied_audio_access_cannot_be_bypassed_with_partial_import() {
    use std::os::unix::fs::PermissionsExt;
    let old = tempfile::tempdir().unwrap();
    let source = Database::open(old.path()).unwrap();
    finished(&source, "denied.wav");
    let songs = old.path().join("songs");
    std::fs::create_dir_all(&songs).unwrap();
    std::fs::write(songs.join("denied.wav"), b"private").unwrap();
    std::fs::set_permissions(&songs, std::fs::Permissions::from_mode(0o000)).unwrap();
    let data = tempfile::tempdir().unwrap();
    let db = Database::open(data.path()).unwrap();
    let mut req = request(old.path(), &data.path().join("songs"));
    req.allow_partial = true;
    let check = music_generator::import::preview(&db, &req).unwrap();
    std::fs::set_permissions(&songs, std::fs::Permissions::from_mode(0o700)).unwrap();
    assert!(!check.can_import);
    assert!(check
        .issues
        .iter()
        .any(|issue| issue.code == "songs_access"));
    assert!(check.missing.is_empty());
}

#[test]
fn unrelated_database_is_not_silently_migrated_into_an_empty_library() {
    let old = tempfile::tempdir().unwrap();
    let con = rusqlite::Connection::open(old.path().join("music.db")).unwrap();
    con.execute_batch("CREATE TABLE unrelated(value TEXT)")
        .unwrap();
    let data = tempfile::tempdir().unwrap();
    let db = Database::open(data.path()).unwrap();
    let check =
        music_generator::import::preview(&db, &request(old.path(), &data.path().join("songs")))
            .unwrap();
    assert_eq!(check.issues[0].code, "invalid_data");
    assert!(!check.can_import);
}

#[cfg(unix)]
#[test]
fn source_and_target_symlinks_cannot_escape_or_overwrite_files() {
    use music_generator::import::{import_library, preview};
    use std::os::unix::fs::symlink;
    let old = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let source = Database::open(old.path()).unwrap();
    finished(&source, "song.wav");
    std::fs::create_dir_all(old.path().join("songs")).unwrap();
    std::fs::write(outside.path().join("private.wav"), b"private").unwrap();
    symlink(
        outside.path().join("private.wav"),
        old.path().join("songs/song.wav"),
    )
    .unwrap();
    let data = tempfile::tempdir().unwrap();
    let target = tempfile::tempdir().unwrap();
    let db = Database::open(data.path()).unwrap();
    let req = request(old.path(), target.path());
    assert!(preview(&db, &req)
        .unwrap()
        .issues
        .iter()
        .any(|i| i.code == "invalid_data"));
    std::fs::remove_file(old.path().join("songs/song.wav")).unwrap();
    std::fs::write(old.path().join("songs/song.wav"), b"audio").unwrap();
    symlink(
        target.path().join("does-not-exist.wav"),
        target.path().join("song.wav"),
    )
    .unwrap();
    assert!(preview(&db, &req)
        .unwrap()
        .issues
        .iter()
        .any(|i| i.code == "collision"));
    assert!(import_library(&db, &req, &Default::default(), |_| {}).is_err());
    assert!(std::fs::symlink_metadata(target.path().join("song.wav"))
        .unwrap()
        .file_type()
        .is_symlink());
    assert_eq!(
        std::fs::read(outside.path().join("private.wav")).unwrap(),
        b"private"
    );
}
