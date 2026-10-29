use super::*;
use crate::{catalog, db::Database, types::GenerateRequest};
use std::{path::Path, time::UNIX_EPOCH};

fn fixture() -> (tempfile::TempDir, Arc<AppState>) {
    let root = tempfile::tempdir().unwrap();
    let state = Arc::new(AppState::new(
        Database::open(root.path()).unwrap(),
        root.path().join("resources"),
    ));
    (root, state)
}

fn enqueue(state: &AppState, variants: u32) -> Vec<String> {
    state
        .db
        .enqueue(&GenerateRequest {
            prompt: "piano fixture".into(),
            title: "Kept title".into(),
            variants,
            ..Default::default()
        })
        .unwrap()
}

fn installed(state: &AppState) {
    let mut settings = state.db.settings().unwrap();
    settings.setup_complete = true;
    settings.expert_mode = true;
    settings.lm_model = "acestep-5Hz-lm-0.6B-Q8_0.gguf".into();
    state.db.save_settings(&settings).unwrap();
    state.restore_setup().unwrap();
    let root = Path::new(&settings.models_dir);
    std::fs::create_dir_all(root).unwrap();
    let mut entries = serde_json::Map::new();
    for model in catalog::required(&catalog::Selection::from_settings(&settings)).unwrap() {
        let path = root.join(model.file);
        std::fs::write(&path, b"verified model fixture").unwrap();
        let metadata = path.metadata().unwrap();
        entries.insert(
            path.canonicalize().unwrap().to_string_lossy().into_owned(),
            json!([
                model.sha256,
                metadata.len(),
                metadata
                    .modified()
                    .unwrap()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ]),
        );
    }
    std::fs::write(
        state.db.root.join("verified-models.json"),
        json!({"entries": entries}).to_string(),
    )
    .unwrap();
}

#[test]
fn cancel_never_deletes_completed_audio_and_prevents_late_completion() {
    let (_root, state) = fixture();
    let ids = enqueue(&state, 2);
    state.db.claim_next().unwrap();
    let directory = state.db.settings().unwrap().songs_dir;
    std::fs::create_dir_all(&directory).unwrap();
    let audio = Path::new(&directory).join("finished.wav");
    std::fs::write(&audio, b"retained audio").unwrap();
    state
        .db
        .finish(&ids[0], "finished.wav", &json!({}))
        .unwrap();
    assert!(!state.db.mcp_cancel_song(&ids[0]).unwrap());
    assert_eq!(std::fs::read(&audio).unwrap(), b"retained audio");
    assert_eq!(state.db.song(&ids[0]).unwrap().status, "done");
    state.db.claim_next().unwrap();
    assert!(state.db.mcp_cancel_song(&ids[1]).unwrap());
    assert!(!state.db.finish(&ids[1], "late.wav", &json!({})).unwrap());
    assert!(!state.db.mcp_cancel_song(&ids[1]).unwrap());
    assert_eq!(state.db.song(&ids[1]).unwrap().status, "cancelled");
    assert!(state.db.mcp_cancel_song("missing").is_err());
    state.db.mcp_delete_song(&ids[0]).unwrap();
    assert!(!audio.exists());
}

#[test]
fn deletion_rejects_pending_work_and_removes_only_explicit_terminal_song() {
    let (_root, state) = fixture();
    let id = enqueue(&state, 1).remove(0);
    assert!(state.db.mcp_delete_song(&id).is_err());
    state.db.claim_next().unwrap();
    assert!(state.db.mcp_delete_song(&id).is_err());
    state.db.mcp_cancel_song(&id).unwrap();
    state.db.mcp_delete_song(&id).unwrap();
    assert!(state.db.song(&id).is_err());
}

#[test]
fn pagination_reaches_beyond_the_ui_limit_and_combines_filters() {
    let (_root, state) = fixture();
    for _ in 0..11 {
        enqueue(&state, 50);
    }
    let first = state
        .db
        .mcp_song_page(&SongFilter::default(), "queued", 100, 0)
        .unwrap();
    let last = state
        .db
        .mcp_song_page(&SongFilter::default(), "queued", 100, 500)
        .unwrap();
    assert_eq!(first["total"], 550);
    assert_eq!(first["next_offset"], 100);
    assert_eq!(last["songs"].as_array().unwrap().len(), 50);
    assert!(last["next_offset"].is_null());
    let folder = state.db.folder_save(None, "Favorites").unwrap();
    let id = last["songs"][0]["id"].as_str().unwrap();
    state
        .db
        .patch(
            id,
            &json!({"title": "Search target", "favorite": true, "folder_id": folder["id"]}),
        )
        .unwrap();
    let filter = SongFilter {
        q: "target".into(),
        favorites: true,
        folder: folder["id"].as_str().unwrap().into(),
        ..Default::default()
    };
    let page = state.db.mcp_song_page(&filter, "queued", 25, 0).unwrap();
    assert_eq!(page["total"], 1);
    assert_eq!(page["songs"][0]["id"], id);
    assert_eq!(
        state.db.mcp_song_page(&filter, "done", 25, 0).unwrap()["total"],
        0
    );
}

#[tokio::test(start_paused = true)]
async fn waiting_is_bounded_and_leaves_the_job_running() {
    let (_root, state) = fixture();
    let id = enqueue(&state, 1).remove(0);
    state.db.claim_next().unwrap();
    let start = tokio::time::Instant::now();
    let result = wait_song(&state, &id, 90).await.unwrap();
    assert_eq!(start.elapsed(), Duration::from_secs(30));
    assert_eq!(result["timed_out"], true);
    assert_eq!(result["song"]["status"], "running");
    state.db.fail(&id, "fixture error").unwrap();
    let result = wait_song(&state, &id, 30).await.unwrap();
    assert_eq!(result["completed"], true);
    assert_eq!(result["timed_out"], false);
}

#[tokio::test]
async fn generation_uses_studio_defaults_and_admission_then_variants_preserve_group() {
    let (_root, state) = fixture();
    assert!(
        generation::generate(state.clone(), json!({"prompt": "piano", "title": "Test"}))
            .await
            .is_err()
    );
    installed(&state);
    let result = generation::generate(state.clone(), json!({"prompt": "piano", "title": "Test"}))
        .await
        .unwrap();
    let ids = result["ids"].as_array().unwrap();
    assert_eq!(ids.len(), 2);
    let id = ids[0].as_str().unwrap();
    let song = state.db.song(id).unwrap();
    assert_eq!(song.params["duration"], 90.0);
    assert_eq!(song.params["lm_temperature"], 1.2);
    assert_eq!(song.params["inference_steps"], 30);
    let result = generation::variants(
        state.clone(),
        json!({"id": id, "overrides": {"title": "Variation", "inference_steps": 8}}),
    )
    .await
    .unwrap();
    let variant = state.db.song(result["ids"][0].as_str().unwrap()).unwrap();
    assert_eq!(variant.group_id, song.group_id);
    assert_eq!(variant.title.as_deref(), Some("Variation"));
    assert_eq!(variant.params["inference_steps"], 8);
    assert_eq!(state.db.song(id).unwrap().title.as_deref(), Some("Test"));
}

#[tokio::test]
async fn reduced_cpu_retry_preserves_original_request_and_creates_one_new_song() {
    let (_root, state) = fixture();
    installed(&state);
    let id = state
        .db
        .enqueue(&GenerateRequest {
            prompt: "piano".into(),
            title: "Retry fixture".into(),
            inference_steps: 80,
            ..Default::default()
        })
        .unwrap()
        .remove(0);
    state.db.claim_next().unwrap();
    state.db.fail(&id, "fixture failure").unwrap();
    let before = state.db.song(&id).unwrap();
    assert!(generation::retry(state.clone(), json!({"id": id}))
        .await
        .is_err());
    let result = generation::retry(
        state.clone(),
        json!({"id": id, "cpu_iteration_decision": "limit_30"}),
    )
    .await
    .unwrap();
    assert_eq!(result["created_new_song"], true);
    let replacement = state.db.song(result["ids"][0].as_str().unwrap()).unwrap();
    assert_ne!(replacement.group_id, before.group_id);
    assert_eq!(replacement.params["inference_steps"], 30);
    assert_eq!(state.db.song(&id).unwrap().params, before.params);
    assert_eq!(state.db.song(&id).unwrap().status, "error");
}

#[tokio::test]
async fn legacy_variants_preserve_vocals_and_caption_policy_without_overriding_explicit_flags() {
    let (_root, state) = fixture();
    installed(&state);
    let id = state
        .db
        .enqueue(&GenerateRequest {
            prompt: "Vocal piano".into(),
            title: "Legacy song".into(),
            lyrics: "Keep these sung words".into(),
            instrumental: false,
            keep_caption: false,
            inference_steps: 8,
            ..Default::default()
        })
        .unwrap()
        .remove(0);
    let mut legacy = state.db.song(&id).unwrap().params;
    legacy.as_object_mut().unwrap().remove("instrumental");
    legacy.as_object_mut().unwrap().remove("keep_caption");
    legacy.as_object_mut().unwrap().remove("lyrics");
    state
        .db
        .lock()
        .execute(
            "UPDATE songs SET params=?1 WHERE id=?2",
            rusqlite::params![legacy.to_string(), id],
        )
        .unwrap();
    let result = generation::variants(state.clone(), json!({"id": id}))
        .await
        .unwrap();
    let variant = state.db.song(result["ids"][0].as_str().unwrap()).unwrap();
    assert_eq!(variant.params["lyrics"], "Keep these sung words");
    assert_eq!(variant.params["instrumental"], false);
    assert_eq!(variant.params["keep_caption"], false);
    assert_eq!(variant.params["use_cot_caption"], true);

    legacy["instrumental"] = json!(true);
    legacy["keep_caption"] = json!(true);
    state
        .db
        .lock()
        .execute(
            "UPDATE songs SET params=?1 WHERE id=?2",
            rusqlite::params![legacy.to_string(), id],
        )
        .unwrap();
    let result = generation::variants(state.clone(), json!({"id": id}))
        .await
        .unwrap();
    let variant = state.db.song(result["ids"][0].as_str().unwrap()).unwrap();
    assert_eq!(variant.params["lyrics"], "[Instrumental]");
    assert_eq!(variant.params["instrumental"], true);
    assert_eq!(variant.params["keep_caption"], true);
    assert_eq!(variant.params["use_cot_caption"], false);
}

#[cfg(unix)]
#[tokio::test]
async fn dispatch_requires_delete_confirmation_and_folder_removal_preserves_songs() {
    let (_root, state) = fixture();
    let app = tauri::test::mock_app();
    let id = enqueue(&state, 1).remove(0);
    state.db.mcp_cancel_song(&id).unwrap();
    assert!(call(
        "delete_song",
        json!({"id": id}),
        state.clone(),
        app.handle()
    )
    .await
    .unwrap()
    .is_err());
    assert!(state.db.song(&id).is_ok());
    let folder = call(
        "save_folder",
        json!({"name": "Original"}),
        state.clone(),
        app.handle(),
    )
    .await
    .unwrap()
    .unwrap();
    let fid = folder["id"].as_str().unwrap();
    call(
        "save_folder",
        json!({"id": fid, "name": "Renamed"}),
        state.clone(),
        app.handle(),
    )
    .await
    .unwrap()
    .unwrap();
    call(
        "update_song",
        json!({"id": id, "favorite": true, "folder_id": fid}),
        state.clone(),
        app.handle(),
    )
    .await
    .unwrap()
    .unwrap();
    call(
        "delete_folder",
        json!({"id": fid, "confirm": true}),
        state.clone(),
        app.handle(),
    )
    .await
    .unwrap()
    .unwrap();
    let song = state.db.song(&id).unwrap();
    assert!(song.folder_id.is_none());
    assert!(song.favorite);
    assert!(call("unrelated", json!({}), state, app.handle())
        .await
        .is_none());
}

#[cfg(unix)]
#[tokio::test]
async fn mutations_respect_configuration_and_cancellation_reaches_the_running_job() {
    let (_root, state) = fixture();
    let app = tauri::test::mock_app();
    let id = enqueue(&state, 1).remove(0);
    let configuration = state
        .runtime
        .try_begin(crate::runtime::OperationKind::Settings)
        .unwrap();
    assert!(call(
        "cancel_song",
        json!({"id": id}),
        state.clone(),
        app.handle()
    )
    .await
    .unwrap()
    .is_err());
    assert!(call(
        "update_song",
        json!({"id": id, "title": "blocked"}),
        state.clone(),
        app.handle()
    )
    .await
    .unwrap()
    .is_err());
    assert!(call(
        "save_folder",
        json!({"name": "blocked"}),
        state.clone(),
        app.handle()
    )
    .await
    .unwrap()
    .is_err());
    assert_eq!(state.db.song(&id).unwrap().status, "queued");
    assert_eq!(
        state.db.song(&id).unwrap().title.as_deref(),
        Some("Kept title")
    );
    drop(configuration);
    let generation = state
        .runtime
        .try_begin(crate::runtime::OperationKind::Generation)
        .unwrap();
    state.db.claim_next().unwrap();
    generation.start_song(&id);
    let result = call(
        "cancel_song",
        json!({"id": id}),
        state.clone(),
        app.handle(),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(result["cancelled"], true);
    assert!(generation.cancellation().is_cancelled());
}
