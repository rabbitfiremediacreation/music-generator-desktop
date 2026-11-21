use super::{jobs, state};
use crate::{state::AppState, stems::removal, types::id};
use rusqlite::params;
use serde_json::json;
use std::path::PathBuf;

fn insert_source(state: &AppState, song_id: &str) -> String {
    let id = id();
    let data = json!({"id": id, "song_id": song_id, "name": "Song", "hash": "hash",
        "extension": "wav", "decoded": false,
        "audio": {"rate": 44100, "frames": 1, "channels": 2, "peaks": []}});
    state
        .db
        .lock()
        .execute(
            "INSERT INTO stem_sources(id,song_id,data) VALUES (?1,?2,?3)",
            params![id, song_id, data.to_string()],
        )
        .unwrap();
    id
}

fn insert_job(
    state: &AppState,
    source_id: &str,
    status: &str,
    preview: bool,
    created: &str,
) -> String {
    let id = id();
    let request = json!({"source_id": source_id, "pin": {"model": "htdemucs", "repository": "test", "revision": "test"},
        "name": "Project", "start": 0, "end": null, "quality": "standard", "overlap": 0.25, "outputs": ["vocals"], "preview": preview});
    let result = (status == "done").then(|| json!({"rate": 44100, "channels": 2, "frames": 1, "source_start_frame": 0,
        "source_frames": 1, "roles": ["vocals"], "engine": "Demucs", "engine_version": "4.0.1", "architecture": "test",
        "backend": "cpu", "weights_sha256": "", "expected_roles": ["vocals"], "original_peak": 0, "track_peaks": []}).to_string());
    state.db.lock().execute(
        "INSERT INTO stem_jobs(id,source_id,request,status,phase,created_at,result) VALUES (?1,?2,?3,?4,?4,?5,?6)",
        params![id, source_id, request.to_string(), status, created, result],
    ).unwrap();
    id
}

#[test]
fn opens_the_latest_completed_non_preview_project_for_the_song() {
    let root = tempfile::tempdir().unwrap();
    let state = state(root.path(), PathBuf::new());
    let source = insert_source(&state, "song");
    let other = insert_source(&state, "other");
    let earlier = insert_job(&state, &source, "done", false, "2026-01-01");
    let latest = insert_job(&state, &source, "done", false, "2026-01-01");
    insert_job(&state, &source, "done", true, "2026-01-02");
    insert_job(&state, &source, "queued", false, "2026-01-03");
    insert_job(&state, &other, "done", false, "2026-01-04");
    assert_eq!(jobs::latest_for_song(&state, "song").unwrap().id, latest);
    assert!(jobs::latest_for_song(&state, "missing").is_err());
    removal::remove_project(&state, &latest).unwrap();
    assert_eq!(jobs::latest_for_song(&state, "song").unwrap().id, earlier);
}

#[test]
fn removes_only_project_owned_assets_and_rejects_removal_during_exports() {
    let root = tempfile::tempdir().unwrap();
    let state = state(root.path(), PathBuf::new());
    let source = insert_source(&state, "song");
    let project = insert_job(&state, &source, "done", false, "2026-01-01");
    let sibling = insert_job(&state, &source, "done", false, "2026-01-02");
    let layer = id();
    let export = id();
    let version = id();
    let assets = root.path().join("stems");
    for (role, id) in [
        ("projects", &project),
        ("projects", &sibling),
        ("sources", &source),
        ("layers", &layer),
        ("exports", &export),
    ] {
        std::fs::create_dir_all(assets.join(role).join(id)).unwrap();
        std::fs::write(assets.join(role).join(id).join("track.wav"), b"test").unwrap();
    }
    let external = root.path().join("external export.wav");
    std::fs::write(&external, b"copy").unwrap();
    {
        let con = state.db.lock();
        con.execute(
            "INSERT INTO stem_layers VALUES (?1,?2,?3,'2026')",
            params![layer, project, source],
        )
        .unwrap();
        con.execute(
            "INSERT INTO stem_mixes VALUES (?1,?2,'Mix','{}','2026')",
            params![version, project],
        )
        .unwrap();
        con.execute("INSERT INTO stem_exports (id,project_id,request,status,created_at) VALUES (?1,?2,'{}','queued','2026')", params![export, project]).unwrap();
    }
    assert_eq!(
        removal::remove_project(&state, &project)
            .unwrap_err()
            .to_string(),
        "stem_project_export_busy"
    );
    assert!(assets.join("projects").join(&project).is_dir());
    state
        .db
        .lock()
        .execute(
            "UPDATE stem_exports SET status='done' WHERE id=?1",
            [&export],
        )
        .unwrap();

    removal::remove_project(&state, &project).unwrap();
    assert!(jobs::get(&state, &project).is_err());
    for (table, role, id) in [
        ("stem_exports", "exports", &export),
        ("stem_layers", "layers", &layer),
        ("stem_mixes", "projects", &project),
    ] {
        let count: u32 = state
            .db
            .lock()
            .query_row(
                &format!("SELECT COUNT(*) FROM {table} WHERE project_id=?1"),
                [&project],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0, "{table}");
        assert!(!assets.join(role).join(id).exists(), "{role}");
    }
    assert!(external.is_file());
    assert!(assets.join("sources").join(source).is_dir());
    assert!(assets.join("projects").join(&sibling).is_dir());
    assert!(jobs::get(&state, &sibling).is_ok());
}

#[test]
fn removing_inactive_jobs_reclaims_only_unreferenced_sources_on_restart() {
    let root = tempfile::tempdir().unwrap();
    let state = state(root.path(), PathBuf::new());
    let orphan = insert_source(&state, "removed");
    let shared = insert_source(&state, "kept");
    let cancelled = insert_job(&state, &orphan, "cancelled", false, "2026-01-01");
    let failed = insert_job(&state, &shared, "error", false, "2026-01-02");
    let queued = insert_job(&state, &shared, "queued", false, "2026-01-03");
    let assets = root.path().join("stems/sources");
    for id in [&orphan, &shared] {
        std::fs::create_dir_all(assets.join(id)).unwrap();
    }
    assert!(removal::remove_project(&state, &queued).is_err());
    removal::remove_project(&state, &failed).unwrap();
    removal::remove_project(&state, &cancelled).unwrap();
    assert!(jobs::get(&state, &failed).is_err());
    assert!(jobs::get(&state, &cancelled).is_err());
    drop(state);
    let _reopened = crate::db::Database::open(root.path()).unwrap();
    assert!(!assets.join(orphan).exists());
    assert!(assets.join(shared).is_dir());
}
